import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Scenario, ScenarioDraft, TaskContext, CourtChatRequest, CourtChatOutput, ActionTypes } from "@thecourt/shared";
import { getBuilderProviderWithOverride, getLlmProviderWithOverride } from "../providers";
import { env } from "../config";
import { retrieveWikipediaContext } from "../wiki/wikipedia";
import { parseDecision } from "../lib/decision";
import type { Message } from "../providers/types";
import { readLlmRequestHeaders } from "../lib/llmRequest";
import { readGameOptionHeaders } from "../lib/gameOptions";
import { normalizeScenarioGeoRegions } from "../lib/geoRegion";

const BUILDER_SYSTEM = `You are a scenario builder for a turn-based historical grand strategy game called "The Court".

Rules:
- You must output JSON that matches the provided schema.
- Keep numbers plausible and internally consistent.
- Use the provided Wikipedia extracts (enwiki) as grounding for polity names, institutions, and historical context.
- If a detail is uncertain or invented, mention it in uncertainty_notes.
- province ids are UUIDs; include geo_region_key with the geo pack feature id (e.g., "england-london") and keep them stable.
`;

// Prompt: docs/prompts.md#3-court-chat
const COURT_CHAT_SYSTEM = `You are a court advisor circle responding to the ruler in a turn-based grand strategy game.

Rules:
- Output JSON matching the schema.
- Return 1 to N messages, where N <= max_messages.
- Each message must be spoken by an active courtier (use their character_id).
- Stay grounded in the task prompt, perceived facts, and recent chat.
- Keep each response concise and in-character.
- Use the in-world date implied by the task prompt; avoid anachronisms or modern pop-culture references.
- If a source or topic is anachronistic, flag it briefly and refocus on period-appropriate advice.
`;

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/builder/init-scenario", async (req, reply) => {
    if (!env.SCENARIO_BUILDER_ENABLED) {
      return reply.status(403).send({
        error: "Scenario creation is experimental and disabled on this server. Set SCENARIO_BUILDER_ENABLED=true to enable."
      });
    }
    const body = z
      .object({
        name: z.string().min(1),
        start_date: z.string().min(4),
        player_polity: z.string().min(1),
        region_focus: z.string().min(1),
        geo_pack_id: z.string().min(1).default("ne_admin1_v1"),
        geo_pack_version: z.string().min(1).default("1"),
        extra_wiki_queries: z.array(z.string()).default([])
      })
      .parse(req.body);

    const queries = [
      `${body.player_polity} ${body.start_date}`,
      `${body.player_polity} government`,
      `${body.player_polity} economy`,
      `${body.region_focus} history ${body.start_date}`,
      ...body.extra_wiki_queries
    ];

    const referenceYear = Number.parseInt(body.start_date.slice(0, 4), 10);
    const yearFilter = Number.isFinite(referenceYear) ? referenceYear : undefined;
    const wiki = await retrieveWikipediaContext(queries, 1, { referenceYear: yearFilter });
    const wikiBrief = wiki
      .slice(0, 8)
      .map((p) => `TITLE: ${p.title}\nURL: ${p.url}\nEXTRACT: ${p.extract}`)
      .join("\n\n");

    const user = `Build a scenario JSON for The Court.

Scenario parameters:
- name: ${body.name}
- start_date: ${body.start_date}
- player_polity: ${body.player_polity}
- region_focus: ${body.region_focus}
- geo_pack: {id: ${body.geo_pack_id}, version: ${body.geo_pack_version}}

Wikipedia extracts (grounding):
${wikiBrief}

Hard requirements:
- Include at least 2 nations (player + one rival/neighbor).
- Create 6 offices: foreign, interior, finance, war, intelligence, chancellery.
- Create at least 5 characters and fill the offices with appointments.
- Provide initial_tasks (3-6) that create immediate court pressure.
- Add wiki_sources entries for the pages used (title, url, short excerpt).
`;

    let requestLlm;
    try {
      requestLlm = readLlmRequestHeaders(req.headers as Record<string, unknown>, env.LLM_BUILDER_PROVIDER);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    let builderLlm;
    try {
      builderLlm = getBuilderProviderWithOverride(requestLlm.provider, {
        apiKey: requestLlm.apiKey,
        baseUrl: requestLlm.baseUrl
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    const builderModel = resolveModel(requestLlm.provider, "builder", requestLlm.model);
    const parsed = await builderLlm.parseWithSchema({
      model: builderModel,
      schema: ScenarioDraft,
      schemaName: "scenario_draft",
      messages: [
        { role: "system", content: BUILDER_SYSTEM },
        { role: "user", content: user }
      ],
      temperature: 0.4
    });
    const normalized = normalizeScenarioGeoRegions(parsed.parsed);
    const canonical = Scenario.parse(normalized.scenario);
    return reply.send(canonical);
  });

  app.post("/api/llm/decision-parse", async (req, reply) => {
    const body = z
      .object({
        task_context: TaskContext,
        player_text: z.string().min(1)
      })
      .parse(req.body);
    const options = readGameOptionHeaders(req.headers as Record<string, unknown>);
    const allowed = body.task_context.constraints.allowed_action_types ?? [];
    if (options.strictActionsOnly) {
      body.task_context.constraints.allowed_action_types = allowed.length > 0
        ? allowed.filter((type) => type !== "freeform_effect")
        : ActionTypes.filter((type) => type !== "freeform_effect");
    }
    let requestLlm;
    try {
      requestLlm = readLlmRequestHeaders(req.headers as Record<string, unknown>, env.LLM_PROVIDER);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    let provider;
    try {
      provider = getLlmProviderWithOverride(requestLlm.provider, {
        apiKey: requestLlm.apiKey,
        baseUrl: requestLlm.baseUrl
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    const model = resolveModel(requestLlm.provider, "game", requestLlm.model);
    const parsed = await parseDecision(body.task_context, body.player_text, { provider, model });
    return reply.send(parsed);
  });

  app.post("/api/llm/court-chat", async (req, reply) => {
    const body = CourtChatRequest.parse(req.body);
    const activeIds = new Set(body.active_character_ids);
    const activeCharacters = body.characters.filter((character) => activeIds.has(character.character_id));

    if (activeCharacters.length === 0) {
      return reply.status(400).send({ error: "No active courtiers available for chat." });
    }

    const maxMessages = Math.min(body.max_messages ?? 2, activeCharacters.length, 4);
    const allowed = body.task_context.constraints.allowed_action_types;
    const suggested = body.task_context.constraints.suggested_action_types ?? [];
    const forbidden = body.task_context.constraints.forbidden_action_types ?? [];
    const notes = body.task_context.constraints.notes ?? [];
    const allowedText = allowed.length ? `Allowed action types: ${allowed.join(", ")}` : "Allowed action types: (none specified; use the canonical catalog).";
    const suggestedText = suggested.length ? `Suggested action types: ${suggested.join(", ")}` : "Suggested action types: (none specified).";
    const forbiddenText = forbidden.length ? `Forbidden action types: ${forbidden.join(", ")}` : "Forbidden action types: (none specified).";
    const notesText = notes.length ? `Constraint notes: ${notes.join(" | ")}` : "Constraint notes: (none).";
    const sourcesText = formatSources(body.task_context.sources);
    const sourcesBlock = sourcesText ? `Sources:\n${sourcesText}\n\n` : "";

    const activeText = activeCharacters
      .map((c) => {
        const skillText = c.skills ? JSON.stringify(c.skills) : "{}";
        const traitsText = c.traits?.length ? c.traits.join(", ") : "none";
        const accuracy = c.advisor_model?.accuracy ?? "unknown";
        const reliability = c.advisor_model?.reliability ?? "unknown";
        return `- ${c.name} (${c.character_id}) ${c.title ?? ""} ${c.office ?? ""} domain=${c.domain ?? "unknown"} traits=${traitsText} skills=${skillText} accuracy=${accuracy} reliability=${reliability}`.trim();
      })
      .join("\n");

    const recentMessages = body.task_context.last_messages
      .slice(-12)
      .map((m) => `${m.role}${m.sender_character_id ? `(${m.sender_character_id})` : ""}: ${m.content}`)
      .join("\n");

    const user = `Task prompt:\n${body.task_context.prompt}\nUrgency: ${body.task_context.urgency}\n\n${sourcesBlock}${allowedText}\n${suggestedText}\n${forbiddenText}\n${notesText}\n\nPerceived facts:\n${body.task_context.perceived_facts
      .slice(0, 16)
      .map((f) => `- [${f.fact_id}] (${f.domain}, conf=${f.confidence}): ${f.statement} = ${String(f.value)}`)
      .join("\n")}\n\nRecent chat:\n${recentMessages || "(none)"}\n\nPlayer text:\n${body.player_text}\n\nActive courtiers:\n${activeText}\n\nReturn 1 to ${maxMessages} messages.`;

    let requestLlm;
    try {
      requestLlm = readLlmRequestHeaders(req.headers as Record<string, unknown>, env.LLM_PROVIDER);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    let llm;
    try {
      llm = getLlmProviderWithOverride(requestLlm.provider, {
        apiKey: requestLlm.apiKey,
        baseUrl: requestLlm.baseUrl
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    const model = resolveModel(requestLlm.provider, "game", requestLlm.model);
    const fallbackSpeaker = activeCharacters[0].character_id;
    let parsedOutput: CourtChatOutput;
    try {
      const parsed = await llm.parseWithSchema({
        model,
        schema: CourtChatOutput,
        schemaName: "court_chat",
        messages: [
          { role: "system", content: COURT_CHAT_SYSTEM },
          { role: "user", content: user }
        ],
        temperature: 0.4
      });
      parsedOutput = parsed.parsed;
    } catch (err) {
      const fallbackMessages: Message[] = [
        {
          role: "system",
          content: `${COURT_CHAT_SYSTEM}\nReturn ONLY a JSON object with keys: task_id, messages (array of {speaker_character_id, content}). No extra keys or text.`
        },
        { role: "user", content: user }
      ];
      const rawText = await llm.completeText({
        model,
        messages: fallbackMessages,
        temperature: 0.2
      });
      const rawJson = parseLooseJson(rawText);
      const normalized = normalizeCourtChatOutput(rawJson, body.task_context.task_id, activeIds, fallbackSpeaker, maxMessages);
      parsedOutput = CourtChatOutput.parse(normalized);
    }

    const messages = parsedOutput.messages
      .slice(0, maxMessages)
      .map((msg) => ({
        ...msg,
        speaker_character_id: activeIds.has(msg.speaker_character_id) ? msg.speaker_character_id : fallbackSpeaker
      }));

    return reply.send({ task_id: body.task_context.task_id, messages });
  });
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

function normalizeCourtChatOutput(
  raw: unknown,
  fallbackTaskId: string,
  activeIds: Set<string>,
  fallbackSpeaker: string,
  maxMessages: number
): CourtChatOutput {
  const root = typeof raw === "object" && raw ? (raw as Record<string, any>) : {};
  const taskId = typeof root.task_id === "string" ? root.task_id : fallbackTaskId;
  const rawMessages = Array.isArray(root.messages) ? root.messages : [];
  const messages = rawMessages
    .map((msg) => {
      const entry = typeof msg === "object" && msg ? (msg as Record<string, any>) : {};
      const speakerCandidate = entry.speaker_character_id ?? entry.character_id ?? entry.speaker;
      const contentCandidate = entry.content ?? entry.text ?? entry.action ?? entry.message;
      if (!contentCandidate) return null;
      const content = String(contentCandidate);
      const speaker = typeof speakerCandidate === "string" ? speakerCandidate : fallbackSpeaker;
      return {
        speaker_character_id: activeIds.has(speaker) ? speaker : fallbackSpeaker,
        content
      };
    })
    .filter((msg): msg is { speaker_character_id: string; content: string } => Boolean(msg))
    .slice(0, maxMessages);

  if (messages.length === 0) {
    messages.push({
      speaker_character_id: fallbackSpeaker,
      content: "No clear response was produced. Please ask again."
    });
  }

  return { task_id: taskId, messages };
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

function resolveModel(provider: "openai" | "openrouter" | "groq", kind: "builder" | "game", override?: string): string {
  if (override?.trim()) return override.trim();
  const openRouterModel = env.OPENROUTER_MODEL?.trim();
  if (kind === "builder") {
    if (provider === "openrouter") return openRouterModel || env.LLM_BUILDER_MODEL;
    if (provider === "groq") return env.GROQ_MODEL;
    return env.LLM_BUILDER_MODEL;
  }
  if (provider === "openrouter") return openRouterModel || env.LLM_MODEL;
  if (provider === "groq") return env.GROQ_MODEL;
  return env.LLM_MODEL;
}
