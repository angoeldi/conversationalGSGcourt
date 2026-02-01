import type {
  DecisionParseOutput as DecisionParseOutputType,
  TaskContext,
  Action as ActionType,
  ActionBundle as ActionBundleType
} from "@thecourt/shared";
import { DecisionParseOutput as DecisionParseOutputSchema, Action as ActionSchema, ActionTypes } from "@thecourt/shared";
import type { LLMProvider } from "../providers/types";
import { getLlmProvider } from "../providers";
import { env } from "../config";
import { geoRegionKeyToUuid, isUuid } from "./geoRegion";

// Prompt: docs/prompts.md#2-decision-parser
const DECISION_SYSTEM = `You translate the player's intent into EXACTLY TWO actionable bundles.

Rules:
- Output JSON matching the schema.
- Use the key "proposed_bundles" (never "bundles").
- Each bundle must contain 1+ actions.
- Each bundle must use "label" (never "name").
- Action shape is { "type": "...", "params": { ... } }. Never put params at the action top level.
- Only use the canonical parameter names from the action schema.
- Prefer actions allowed by constraints.allowed_action_types when provided.
- Prefer constraints.suggested_action_types when available.
- Never use constraints.forbidden_action_types.
- If no canonical action fits, use "freeform_effect" with explicit deltas.
- Deltas are additive (relative), not absolute values; keep them modest and scenario-consistent.
- Never invent new action types.
- If the player asked for something impossible, put a clarifying question and make bundle B a minimal safe alternative.`;

type ActionKind = ActionType["type"];

const ACTION_PARAM_KEYS: Record<ActionKind, Set<string>> = {
  send_spy: new Set(["target_nation_id", "objective", "budget", "duration_weeks", "risk_tolerance"]),
  counterintelligence: new Set(["budget", "focus", "duration_weeks"]),
  send_envoy: new Set(["target_nation_id", "message_tone", "topic", "offer"]),
  improve_relations: new Set(["target_nation_id", "budget", "message_tone", "duration_weeks"]),
  sign_treaty: new Set(["target_nation_id", "treaty_type", "concessions"]),
  issue_ultimatum: new Set(["target_nation_id", "demand", "deadline_weeks", "backdown_cost_legitimacy"]),
  sanction: new Set(["target_nation_id", "scope", "severity", "duration_weeks"]),
  recognize_claim: new Set(["target_nation_id", "claim", "public"]),
  adjust_tax_rate: new Set(["new_tax_rate", "rationale"]),
  issue_debt: new Set(["amount", "interest_rate_annual", "maturity_weeks"]),
  cut_spending: new Set(["category", "weekly_amount", "duration_weeks"]),
  fund_project: new Set(["project_type", "province_id", "budget", "duration_weeks"]),
  subsidize_sector: new Set(["sector", "weekly_amount", "duration_weeks"]),
  appoint_official: new Set(["office_id", "character_id"]),
  reform_law: new Set(["law_key", "change", "political_capital_cost"]),
  crackdown: new Set(["province_id", "intensity", "duration_weeks", "budget"]),
  mobilize: new Set(["scope", "target_readiness"]),
  raise_levies: new Set(["province_id", "manpower"]),
  fortify: new Set(["province_id", "level_increase", "budget", "duration_weeks"]),
  deploy_force: new Set(["from_province_id", "to_province_id", "units"]),
  reorganize_army: new Set(["focus", "budget", "duration_weeks"]),
  fund_faction: new Set(["target_nation_id", "faction", "weekly_amount", "duration_weeks", "secrecy"]),
  leak_story: new Set(["target", "narrative", "plausibility"]),
  freeform_effect: new Set(["summary", "target_nation_id", "nation_deltas", "province_id", "province_deltas", "relation_deltas", "limit_deltas", "note"]),
  create_committee: new Set(["topic", "chair_character_id", "duration_weeks", "budget"]),
  apply_trajectory_modifier: new Set(["target_nation_id", "metric", "delta", "duration_weeks", "note"])
};

const PARAM_ALIASES: Array<{ from: string; to: string }> = [
  { from: "target", to: "target_nation_id" },
  { from: "target_id", to: "target_nation_id" },
  { from: "nation_id", to: "target_nation_id" },
  { from: "nation", to: "target_nation_id" },
  { from: "destination", to: "to_province_id" },
  { from: "to", to: "to_province_id" },
  { from: "origin", to: "from_province_id" },
  { from: "from", to: "from_province_id" },
  { from: "tone", to: "message_tone" },
  { from: "offer_text", to: "offer" },
  { from: "deadline", to: "deadline_weeks" },
  { from: "backdown_cost", to: "backdown_cost_legitimacy" },
  { from: "interest_rate", to: "interest_rate_annual" },
  { from: "rate", to: "interest_rate_annual" },
  { from: "maturity", to: "maturity_weeks" },
  { from: "duration", to: "duration_weeks" },
  { from: "weeks", to: "duration_weeks" },
  { from: "chair", to: "chair_character_id" },
  { from: "chair_id", to: "chair_character_id" },
  { from: "office", to: "office_id" },
  { from: "appointee", to: "character_id" },
  { from: "person", to: "character_id" },
  { from: "law", to: "law_key" },
  { from: "province", to: "province_id" },
  { from: "location", to: "province_id" },
  { from: "project", to: "project_type" },
  { from: "sector_name", to: "sector" },
  { from: "readiness", to: "target_readiness" },
  { from: "amount", to: "weekly_amount" },
  { from: "spending", to: "weekly_amount" }
];

const ACTION_PARAM_WRAPPERS = ["params", "force", "project", "committee", "details", "payload", "spec", "data"];
const ACTION_TYPE_KEYS = ["type", "action", "kind", "action_type"];

export async function parseDecision(
  taskContext: TaskContext,
  playerText: string,
  options: { provider?: LLMProvider; model?: string } = {}
): Promise<DecisionParseOutputType> {
  const allowed = taskContext.constraints.allowed_action_types;
  const suggested = taskContext.constraints.suggested_action_types ?? [];
  const forbidden = taskContext.constraints.forbidden_action_types ?? [];
  const notes = taskContext.constraints.notes ?? [];
  const allowedText = allowed.length ? `Allowed action types: ${allowed.join(", ")}` : "Allowed action types: (none specified; use the canonical catalog).";
  const suggestedText = suggested.length ? `Suggested action types: ${suggested.join(", ")}` : "Suggested action types: (none specified).";
  const forbiddenText = forbidden.length ? `Forbidden action types: ${forbidden.join(", ")}` : "Forbidden action types: (none specified).";
  const notesText = notes.length ? `Constraint notes: ${notes.join(" | ")}` : "Constraint notes: (none).";
  const sourcesText = formatSources(taskContext.sources);
  const sourcesBlock = sourcesText ? `Sources:\n${sourcesText}\n\n` : "";

  const user = `Task prompt:\n${taskContext.prompt}\n\n${sourcesBlock}${allowedText}\n${suggestedText}\n${forbiddenText}\n${notesText}\n\nPerceived facts:\n${taskContext.perceived_facts
    .slice(0, 24)
    .map((f) => `- [${f.fact_id}] (${f.domain}, conf=${f.confidence}): ${f.statement} = ${String(f.value)}`)
    .join("\n")}\n\nPlayer decision text:\n${playerText}\n\nReturn two bundles: A = faithful, B = conservative alternative.`;

  const llm = options.provider ?? getLlmProvider();
  const openRouterModel = env.OPENROUTER_MODEL?.trim();
  const model = options.model ?? (env.LLM_PROVIDER === "openrouter"
    ? openRouterModel || env.LLM_MODEL
    : env.LLM_PROVIDER === "groq"
      ? env.GROQ_MODEL
      : env.LLM_MODEL);

  try {
    const parsed = await llm.parseWithSchema({
      model,
      schema: DecisionParseOutputSchema,
      schemaName: "decision_parse",
      messages: [
        { role: "system", content: DECISION_SYSTEM },
        { role: "user", content: user }
      ],
      temperature: 0.2
    });
    const normalized = normalizeDecisionParseOutput(parsed.rawJson ?? parsed.parsed, taskContext, playerText);
    const validated = DecisionParseOutputSchema.safeParse(normalized);
    if (validated.success) return validated.data;
  } catch {
    // fall through to JSON-only retry
  }

  const rawText = await llm.completeText({
    model,
    messages: [
      {
        role: "system",
        content: "Return ONLY a single JSON object that matches the schema. Do not wrap in markdown or add extra text."
      },
      { role: "system", content: DECISION_SYSTEM },
      { role: "user", content: user }
    ],
    temperature: 0.2
  });
  const rawJson = parseLooseJson(rawText);
  const normalized = normalizeDecisionParseOutput(rawJson, taskContext, playerText);
  const validated = DecisionParseOutputSchema.safeParse(normalized);
  if (!validated.success) {
    throw new Error(validated.error.message);
  }
  return validated.data;
}

function formatSources(sources: TaskContext["sources"] | undefined): string {
  if (!sources || sources.length === 0) return "";
  return sources
    .slice(0, 4)
    .map((source) => {
      const excerpt = source.excerpt?.trim();
      const summary = excerpt ? `: ${excerpt}` : "";
      return `- ${source.title}${summary}`;
    })
    .join("\n");
}

function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error("Response was not JSON parseable");
  }
}

export function normalizeDecisionParseOutput(
  value: unknown,
  taskContext: TaskContext,
  playerText: string
): DecisionParseOutputType | Record<string, unknown> {
  if (!value || typeof value !== "object") return value as Record<string, unknown>;
  const payload = value as Record<string, any>;
  const taskId = typeof payload.task_id === "string" && payload.task_id.trim() ? payload.task_id : taskContext.task_id;
  const intentSummary = typeof payload.intent_summary === "string" && payload.intent_summary.trim()
    ? payload.intent_summary
    : playerText.trim();
  let bundles = payload.proposed_bundles;
  if (!Array.isArray(bundles)) bundles = payload.bundles;
  if (!Array.isArray(bundles)) {
    const bundleA = payload.bundle_a ?? payload.bundleA ?? payload.option_a ?? payload.optionA;
    const bundleB = payload.bundle_b ?? payload.bundleB ?? payload.option_b ?? payload.optionB;
    if (bundleA && bundleB) bundles = [bundleA, bundleB];
  }
  const clarifying = Array.isArray(payload.clarifying_questions) ? payload.clarifying_questions : [];
  const assumptions = Array.isArray(payload.assumptions) ? payload.assumptions : [];

  let proposedBundles = Array.isArray(bundles) ? bundles : [];
  proposedBundles = proposedBundles
    .map((bundle, index) => normalizeBundle(bundle, index, taskContext))
    .filter((bundle): bundle is ActionBundleType => Boolean(bundle));
  if (proposedBundles.length === 1) {
    const first = proposedBundles[0];
    proposedBundles = [
      first,
      {
        ...first,
        label: "B: Alternative"
      }
    ];
  } else if (proposedBundles.length > 2) {
    proposedBundles = proposedBundles.slice(0, 2);
  } else if (proposedBundles.length === 0) {
    proposedBundles = buildFallbackBundles(taskContext);
  }

  return {
    task_id: taskId,
    intent_summary: intentSummary,
    proposed_bundles: proposedBundles,
    clarifying_questions: clarifying,
    assumptions
  };
}

function buildFallbackBundles(taskContext: TaskContext) {
  const fallbackAction = buildFallbackAction(taskContext);
  return [
    {
      label: "A: Convene inquiry",
      actions: [fallbackAction],
      tradeoffs: ["Slower response while gathering findings."]
    },
    {
      label: "B: Convene inquiry",
      actions: [fallbackAction],
      tradeoffs: ["Minimal action; may be seen as evasive."]
    }
  ];
}

function buildFallbackAction(taskContext: TaskContext): ActionType {
  return {
    type: "create_committee",
    params: {
      topic: taskContext.prompt,
      duration_weeks: 4,
      budget: 0
    }
  };
}

function normalizeBundle(value: unknown, index: number, taskContext: TaskContext): ActionBundleType {
  const bundle = typeof value === "object" && value ? (value as Record<string, any>) : {};
  const labelCandidate = bundle.label ?? bundle.name ?? bundle.title ?? bundle.option ?? bundle.option_label;
  const label =
    typeof labelCandidate === "string" && labelCandidate.trim()
      ? labelCandidate.trim()
      : index === 0
        ? "A"
        : "B: Alternative";
  const rawActions = Array.isArray(bundle.actions)
    ? bundle.actions
    : Array.isArray(bundle.steps)
      ? bundle.steps
      : [];
  const actions = rawActions
    .map((action) => normalizeAction(action))
    .filter((action): action is ActionType => Boolean(action));
  if (actions.length === 0) {
    actions.push(buildFallbackAction(taskContext));
  }
  const tradeoffsRaw = Array.isArray(bundle.tradeoffs)
    ? bundle.tradeoffs
    : Array.isArray(bundle.tradeoff)
      ? bundle.tradeoff
      : [];
  const tradeoffs = tradeoffsRaw.map((entry) => String(entry));
  return {
    label,
    actions,
    tradeoffs
  };
}

function normalizeAction(value: unknown): ActionType | null {
  const action = typeof value === "object" && value ? (value as Record<string, any>) : {};
  const type = extractActionType(action);
  if (!type) return null;
  const params = normalizeParams(type, extractParamsCandidate(action));
  const candidate = { type, params };
  const parsed = ActionSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return null;
}

function extractActionType(action: Record<string, any>): ActionKind | null {
  for (const key of ACTION_TYPE_KEYS) {
    const candidate = action[key];
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (ActionTypes.includes(trimmed as ActionKind)) return trimmed as ActionKind;
    }
  }
  return null;
}

function extractParamsCandidate(action: Record<string, any>): Record<string, any> {
  const explicit = action.params;
  if (explicit && typeof explicit === "object") return explicit as Record<string, any>;
  let base: Record<string, any> = {};
  let wrapperKey: string | undefined;
  for (const key of ACTION_PARAM_WRAPPERS) {
    const candidate = action[key];
    if (candidate && typeof candidate === "object") {
      base = candidate as Record<string, any>;
      wrapperKey = key;
      break;
    }
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(action)) {
    if (ACTION_TYPE_KEYS.includes(key)) continue;
    if (key === "params" || key === wrapperKey) continue;
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

function normalizeParams(type: ActionKind, params: Record<string, any>): Record<string, any> {
  const allowed = ACTION_PARAM_KEYS[type];
  if (!allowed) return params;
  const normalized: Record<string, any> = { ...params };
  for (const { from, to } of PARAM_ALIASES) {
    if (!allowed.has(to)) continue;
    if (normalized[to] !== undefined) continue;
    if (normalized[from] === undefined) continue;
    normalized[to] = normalized[from];
    delete normalized[from];
  }
  const geoKeys = ["province_id", "from_province_id", "to_province_id"];
  for (const key of geoKeys) {
    if (!allowed.has(key)) continue;
    const value = normalized[key];
    if (typeof value === "string" && value.trim() && !isUuid(value)) {
      normalized[key] = geoRegionKeyToUuid(value);
    }
  }

  const filtered: Record<string, any> = {};
  for (const key of allowed) {
    if (normalized[key] !== undefined) filtered[key] = normalized[key];
  }
  return filtered;
}
