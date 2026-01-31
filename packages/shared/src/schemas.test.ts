import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DecisionParseOutput } from "./schemas/decision";
import { TaskContext } from "./schemas/taskContext";
import { Scenario } from "./schemas/scenario";
import { ActionEffect } from "./schemas/actionEffect";
import { WorldState } from "./schemas/worldState";

describe("schemas", () => {
  it("decision parser output is strict and requires 2 bundles", () => {
    const out = {
      task_id: "11111111-1111-1111-1111-111111111111",
      intent_summary: "Test",
      proposed_bundles: [
        {
          label: "A",
          actions: [
            {
              type: "adjust_tax_rate",
              params: { new_tax_rate: 0.4 }
            }
          ],
          tradeoffs: []
        },
        {
          label: "B",
          actions: [
            {
              type: "issue_debt",
              params: { amount: 1000, interest_rate_annual: 0.08, maturity_weeks: 52 }
            }
          ],
          tradeoffs: []
        }
      ],
      clarifying_questions: [],
      assumptions: []
    };

    expect(DecisionParseOutput.parse(out).proposed_bundles).toHaveLength(2);
  });

  it("default scenario JSON validates against Scenario schema", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../..", "apps/server/data/scenarios/default.england_1492.json");
    const raw = fs.readFileSync(scenarioPath, "utf8");
    const json = JSON.parse(raw);
    const result = Scenario.safeParse(json);
    if (!result.success) throw new Error(result.error.message);
    expect(result.success).toBe(true);
  });

  it("task context accepts optional story metadata", () => {
    const ctx = {
      task_id: "11111111-1111-1111-1111-111111111111",
      task_type: "petition",
      nation_id: "22222222-2222-2222-2222-222222222222",
      created_turn: 3,
      urgency: "medium",
      prompt: "A petition arrives.",
      sources: [],
      story: {
        story_id: "33333333-3333-3333-3333-333333333333",
        title: "Succession Petition",
        summary: "A petition arrives.",
        history: ["Week 3: A petition arrives."],
        last_turn: 3,
        transcripts: [
          {
            task_id: "44444444-4444-4444-4444-444444444444",
            turn_index: 2,
            messages: [
              { role: "courtier", content: "Remember we did X." },
              { role: "player", content: "Proceed." }
            ]
          }
        ]
      }
    };

    expect(TaskContext.parse(ctx).story?.title).toBe("Succession Petition");
  });

  it("action effects accept arbitrary delta/audit payloads", () => {
    const effect = {
      effect_type: "diplomacy.envoy_sent",
      delta: { relation_delta: 2, target_nation_id: "22222222-2222-2222-2222-222222222222" },
      audit: { note: "test" }
    };
    expect(ActionEffect.parse(effect).effect_type).toBe("diplomacy.envoy_sent");
  });

  it("world state validates with required snapshots", () => {
    const state = {
      turn_index: 0,
      turn_seed: 123,
      player_nation_id: "11111111-1111-1111-1111-111111111111",
      nations: {
        "11111111-1111-1111-1111-111111111111": {
          nation_id: "11111111-1111-1111-1111-111111111111",
          gdp: 1000000,
          tax_rate: 0.3,
          tax_capacity: 0.6,
          compliance: 0.7,
          treasury: 5000,
          debt: 1000,
          stability: 60,
          legitimacy: 55,
          population: 100000,
          literacy: 0.2,
          admin_capacity: 25,
          corruption: 0.2,
          manpower_pool: 5000,
          force_size: 2000,
          readiness: 0.4,
          supply: 0.5,
          war_exhaustion: 5,
          tech_level_mil: 20,
          laws: [],
          institutions: {},
          culture_mix: {},
          religion_mix: {}
        }
      },
      provinces: {
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": {
          geo_region_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          nation_id: "11111111-1111-1111-1111-111111111111",
          population: 10000,
          productivity: 1,
          infrastructure: 1,
          unrest: 3,
          compliance_local: 0.8,
          garrison: 200,
          resources: [],
          culture_mix: {},
          religion_mix: {}
        }
      },
      relations: [],
      operations: [],
      nation_trajectories: {},
      trajectory_modifiers: [],
      appointments: [],
      debt_instruments: []
    };
    expect(WorldState.parse(state).turn_index).toBe(0);
  });
});
