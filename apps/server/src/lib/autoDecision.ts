import type { Action, DecisionParseOutput, Scenario, TaskContext } from "@thecourt/shared";
import { DecisionParseOutput as DecisionParseOutputSchema } from "@thecourt/shared";
import { mulberry32 } from "@thecourt/engine";

const KNOWN_ACTIONS: Action["type"][] = [
  "send_spy",
  "counterintelligence",
  "send_envoy",
  "improve_relations",
  "sign_treaty",
  "issue_ultimatum",
  "sanction",
  "recognize_claim",
  "adjust_tax_rate",
  "issue_debt",
  "cut_spending",
  "fund_project",
  "subsidize_sector",
  "appoint_official",
  "reform_law",
  "crackdown",
  "mobilize",
  "raise_levies",
  "fortify",
  "deploy_force",
  "reorganize_army",
  "fund_faction",
  "leak_story",
  "create_committee",
  "apply_trajectory_modifier",
  "freeform_effect"
];

const DEFAULT_ACTIONS: Action["type"][] = [
  "send_envoy",
  "improve_relations",
  "adjust_tax_rate",
  "issue_debt",
  "fund_project"
];

type AutoDecisionResult = {
  decision: DecisionParseOutput;
  chosen_actions: Action[];
};

export function buildAutoDecision(taskContext: TaskContext, scenario: Scenario, seed: number, turnIndex: number): AutoDecisionResult {
  const hash = hashString(taskContext.task_id);
  const rng = mulberry32(seed ^ turnIndex ^ hash);
  const allowed = taskContext.constraints.allowed_action_types ?? [];
  const suggested = taskContext.constraints.suggested_action_types ?? [];
  const forbidden = new Set(taskContext.constraints.forbidden_action_types ?? []);
  const filterKnown = (list: string[]) =>
    list.filter((type): type is Action["type"] => KNOWN_ACTIONS.includes(type as Action["type"]) && !forbidden.has(type));

  let candidates = filterKnown(suggested.length ? suggested : allowed);
  if (candidates.length === 0) candidates = filterKnown(allowed);
  if (candidates.length === 0) candidates = filterKnown(DEFAULT_ACTIONS);

  const primaryType = pickOne(candidates, rng);
  const primaryAction = buildAction(primaryType, scenario, taskContext, rng) ?? buildAction("improve_relations", scenario, taskContext, rng)!;

  const secondaryCandidates = candidates.filter((type) => type !== primaryType);
  const secondaryType = secondaryCandidates.length > 0 ? pickOne(secondaryCandidates, rng) : primaryType;
  const secondaryAction = buildAction(secondaryType, scenario, taskContext, rng) ?? primaryAction;

  const decision: DecisionParseOutput = {
    task_id: taskContext.task_id,
    intent_summary: "Auto-resolved at end of week.",
    proposed_bundles: [
      { label: "A", actions: [primaryAction], tradeoffs: [] },
      { label: "B", actions: [secondaryAction], tradeoffs: [] }
    ],
    clarifying_questions: [],
    assumptions: []
  };

  return { decision: DecisionParseOutputSchema.parse(decision), chosen_actions: [primaryAction] };
}

function buildAction(type: Action["type"], scenario: Scenario, taskContext: TaskContext, rng: () => number): Action | null {
  const targetNation = pickTargetNation(scenario, taskContext.nation_id, rng);
  const provinceId = pickProvince(scenario, rng);
  const officeId = pickOffice(scenario, rng);
  const characterId = pickCharacter(scenario, rng);
  const topic = summarizePrompt(taskContext.prompt);

  switch (type) {
    case "send_spy":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          objective: pickOne(["naval_intel", "army_intel", "economic_intel", "political_intel", "sabotage", "influence"], rng),
          budget: randInt(rng, 200, 1500),
          duration_weeks: randInt(rng, 4, 16),
          risk_tolerance: pickOne(["low", "medium", "high"], rng)
        }
      };
    case "counterintelligence":
      return {
        type,
        params: {
          budget: randInt(rng, 200, 1200),
          focus: pickOne(["ports", "court", "frontier", "finance"], rng),
          duration_weeks: randInt(rng, 4, 12)
        }
      };
    case "send_envoy":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          message_tone: pickOne(["conciliatory", "neutral", "firm", "hostile"], rng),
          topic: topic,
          offer: randBool(rng) ? "Limited concessions" : undefined
        }
      };
    case "improve_relations":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          budget: randInt(rng, 200, 1200),
          message_tone: pickOne(["conciliatory", "neutral", "firm"], rng),
          duration_weeks: randInt(rng, 4, 12)
        }
      };
    case "sign_treaty":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          treaty_type: pickOne(["trade", "non_aggression", "alliance", "research", "access"], rng),
          concessions: []
        }
      };
    case "issue_ultimatum":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          demand: `Concessions on ${topic}`,
          deadline_weeks: randInt(rng, 2, 8),
          backdown_cost_legitimacy: randFloat(rng, 2, 10)
        }
      };
    case "sanction":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          scope: pickOne(["trade", "finance", "naval"], rng),
          severity: randInt(rng, 1, 3),
          duration_weeks: randInt(rng, 4, 12)
        }
      };
    case "recognize_claim":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          claim: `Claim concerning ${topic}`,
          public: randBool(rng)
        }
      };
    case "adjust_tax_rate":
      return {
        type,
        params: {
          new_tax_rate: randFloat(rng, 0.15, 0.45),
          rationale: randBool(rng) ? "Balance the treasury." : undefined
        }
      };
    case "issue_debt":
      return {
        type,
        params: {
          amount: randInt(rng, 500, 5000),
          interest_rate_annual: randFloat(rng, 0.03, 0.12),
          maturity_weeks: randInt(rng, 12, 104)
        }
      };
    case "cut_spending":
      return {
        type,
        params: {
          category: pickOne(["military", "administration", "court", "infrastructure", "subsidies"], rng),
          weekly_amount: randInt(rng, 100, 800),
          duration_weeks: randInt(rng, 4, 16)
        }
      };
    case "fund_project":
      return {
        type,
        params: {
          project_type: pickOne(["infrastructure", "fortifications", "bureaucracy", "schools", "shipyards"], rng),
          province_id: provinceId,
          budget: randInt(rng, 400, 2000),
          duration_weeks: randInt(rng, 8, 24)
        }
      };
    case "subsidize_sector":
      return {
        type,
        params: {
          sector: pickOne(["grain", "textiles", "arms", "shipping", "mining"], rng),
          weekly_amount: randInt(rng, 200, 1200),
          duration_weeks: randInt(rng, 4, 16)
        }
      };
    case "appoint_official":
      return {
        type,
        params: {
          office_id: officeId,
          character_id: characterId
        }
      };
    case "reform_law":
      return {
        type,
        params: {
          law_key: `law_${topic.replace(/\s+/g, "_")}`,
          change: pickOne(["enact", "repeal", "amend"], rng),
          political_capital_cost: randInt(rng, 5, 25)
        }
      };
    case "crackdown":
      return {
        type,
        params: {
          province_id: randBool(rng) ? provinceId : undefined,
          intensity: randInt(rng, 1, 3),
          duration_weeks: randInt(rng, 4, 12),
          budget: randInt(rng, 200, 1200)
        }
      };
    case "mobilize":
      return {
        type,
        params: {
          scope: pickOne(["partial", "general"], rng),
          target_readiness: randFloat(rng, 0.6, 0.9)
        }
      };
    case "raise_levies":
      return {
        type,
        params: {
          province_id: randBool(rng) ? provinceId : undefined,
          manpower: randInt(rng, 500, 5000)
        }
      };
    case "fortify":
      return {
        type,
        params: {
          province_id: provinceId,
          level_increase: randInt(rng, 1, 2),
          budget: randInt(rng, 400, 2000),
          duration_weeks: randInt(rng, 8, 24)
        }
      };
    case "deploy_force": {
      const toProvince = pickProvince(scenario, rng);
      return {
        type,
        params: {
          from_province_id: provinceId,
          to_province_id: toProvince,
          units: randInt(rng, 1, 6)
        }
      };
    }
    case "reorganize_army":
      return {
        type,
        params: {
          focus: pickOne(["training", "logistics", "officer_corps", "standardization"], rng),
          budget: randInt(rng, 300, 1500),
          duration_weeks: randInt(rng, 6, 20)
        }
      };
    case "fund_faction":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          faction: `Faction of ${topic}`,
          weekly_amount: randInt(rng, 200, 1200),
          duration_weeks: randInt(rng, 4, 12),
          secrecy: pickOne(["low", "medium", "high"], rng)
        }
      };
    case "leak_story":
      return {
        type,
        params: {
          target: targetNation,
          narrative: `Reports concerning ${topic}`,
          plausibility: randFloat(rng, 0.4, 0.8)
        }
      };
    case "create_committee":
      return {
        type,
        params: {
          topic: topic,
          chair_character_id: randBool(rng) ? characterId : undefined,
          duration_weeks: randInt(rng, 4, 12),
          budget: randInt(rng, 200, 800)
        }
      };
    case "apply_trajectory_modifier":
      return {
        type,
        params: {
          target_nation_id: targetNation,
          metric: pickOne(
            ["gdp_growth_decade", "population_growth_decade", "stability_drift_decade", "literacy_growth_decade"],
            rng
          ),
          delta: randFloat(rng, -0.2, 0.3),
          duration_weeks: randInt(rng, 8, 24),
          note: "Auto-adjusted trajectory"
        }
      };
    case "freeform_effect":
      return {
        type,
        params: {
          summary: `Auto-response to ${topic}`,
          target_nation_id: randBool(rng) ? targetNation : undefined,
          nation_deltas: {
            stability: randInt(rng, -2, 2),
            treasury: randInt(rng, -1500, 1500)
          },
          province_id: randBool(rng) ? provinceId : undefined,
          province_deltas: {
            unrest: randInt(rng, -5, 5)
          },
          relation_deltas: randBool(rng)
            ? [
                {
                  target_nation_id: targetNation,
                  delta: randInt(rng, -6, 4),
                  add_treaties: [],
                  remove_treaties: []
                }
              ]
            : [],
          limit_deltas: true,
          note: "Auto-generated freeform"
        }
      };
    default:
      return null;
  }
}

function pickTargetNation(scenario: Scenario, playerNationId: string, rng: () => number): string {
  const candidates = scenario.nations.filter((nation) => nation.nation_id !== playerNationId).map((n) => n.nation_id);
  if (candidates.length === 0) return scenario.nations[0]?.nation_id ?? playerNationId;
  return pickOne(candidates, rng);
}

function pickProvince(scenario: Scenario, rng: () => number): string {
  const provinces = scenario.province_snapshots.map((province) => province.geo_region_id);
  if (provinces.length === 0) return scenario.region_assignments[0]?.geo_region_id ?? scenario.scenario_id;
  return pickOne(provinces, rng);
}

function pickOffice(scenario: Scenario, rng: () => number): string {
  const offices = scenario.offices.map((office) => office.office_id);
  if (offices.length === 0) return scenario.offices[0]?.office_id ?? scenario.scenario_id;
  return pickOne(offices, rng);
}

function pickCharacter(scenario: Scenario, rng: () => number): string {
  const characters = scenario.characters.map((character) => character.character_id);
  if (characters.length === 0) return scenario.characters[0]?.character_id ?? scenario.scenario_id;
  return pickOne(characters, rng);
}

function summarizePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "the matter at hand";
  return trimmed.split(/\s+/).slice(0, 6).join(" ");
}

function pickOne<T>(values: T[], rng: () => number): T {
  if (values.length === 0) throw new Error("Cannot pick from empty list.");
  const index = Math.floor(rng() * values.length);
  return values[Math.min(values.length - 1, Math.max(0, index))];
}

function randInt(rng: () => number, min: number, max: number): number {
  const span = Math.max(0, Math.floor(max) - Math.ceil(min));
  return Math.floor(min + rng() * (span + 1));
}

function randFloat(rng: () => number, min: number, max: number): number {
  const clamped = min + rng() * (max - min);
  return Number(clamped.toFixed(2));
}

function randBool(rng: () => number): boolean {
  return rng() < 0.5;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}
