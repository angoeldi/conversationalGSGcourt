import type { DecisionParseOutput } from "@thecourt/shared";
import type { ScenarioViewModel } from "../lib/api";

export function buildScenarioViewModel(): ScenarioViewModel {
  return {
    gameId: "game-1",
    scenarioId: "scenario-1",
    court: {
      ruler: {
        characterId: "char-queen",
        name: "Ada",
        title: "Queen",
        legitimacy: 78,
        talents: {
          diplomacy: 4,
          finance: 3,
          war: 2,
          admin: 3
        },
        health: "Well"
      },
      realm: {
        name: "Ada",
        gdp: "120k",
        treasury: "45k",
        taxRate: "12%",
        stability: "80",
        population: "1.2M",
        literacy: "35%",
        culture: "Ada 70%",
        religion: "Ada 80%"
      },
      council: [
        {
          characterId: "char-1",
          name: "Lord Byron",
          office: "Chancellor",
          domain: "foreign",
          lit: true,
          stats: "Diplomacy 4, Reliability 0.80, Accuracy 0.70"
        }
      ]
    },
    courtiers: [
      {
        characterId: "char-1",
        name: "Lord Byron",
        title: "Lord",
        office: "Chancellor",
        domain: "foreign",
        traits: ["righteous"],
        skills: {
          diplomacy: 4,
          finance: 1,
          war: 0,
          admin: 2,
          interior: 1,
          intrigue: 1
        },
        advisorModel: {
          accuracy: 0.7,
          reliability: 0.8,
          bias: {},
          scope: {}
        }
      }
    ],
    tasks: [
      {
        taskId: "task-1",
        taskType: "diplomacy",
        ownerCharacterId: "char-1",
        urgency: "high",
        prompt: "A petition about alliances.",
        sources: [],
        allowedActionTypes: ["send_envoy"],
        state: "open"
      }
    ],
    playerNationId: "nation-1",
    playerNationName: "Ada",
    rivalNationNames: ["Byronia"],
    geoPack: { id: "ne_admin1_v1", version: "1" },
    nations: [
      { nationId: "nation-1", name: "Ada" },
      { nationId: "nation-2", name: "Byronia" }
    ],
    relations: [
      {
        from_nation_id: "nation-1",
        to_nation_id: "nation-2",
        value: 10,
        treaties: ["alliance"],
        at_war: false
      }
    ],
    nationProfiles: {
      "nation-1": {
        summary: "Ada is stabilizing the realm.",
        trajectory: { gdp_growth_decade: 0.04 },
        mapAliases: ["Ada"]
      },
      "nation-2": {
        summary: "Byronia is expanding its influence.",
        trajectory: { gdp_growth_decade: 0.05 },
        mapAliases: ["Byronia"]
      }
    },
    worldState: {
      turn_index: 0,
      player_nation_id: "nation-1",
      nation_trajectories: {
        "nation-2": { gdp_growth_decade: 0.05 }
      },
      trajectory_modifiers: [],
      nations: {
        "nation-1": {
          nation_id: "nation-1",
          gdp: 120000,
          treasury: 45000,
          tax_rate: 0.12,
          stability: 80,
          population: 1200000,
          literacy: 0.35,
          legitimacy: 78,
          tax_capacity: 0.5,
          compliance: 0.6,
          debt: 0,
          admin_capacity: 40,
          corruption: 0.1,
          manpower_pool: 10000,
          force_size: 5000,
          readiness: 0.4,
          supply: 0.7,
          war_exhaustion: 0,
          tech_level_mil: 20,
          laws: [],
          institutions: {},
          culture_mix: {},
          religion_mix: {}
        },
        "nation-2": {
          nation_id: "nation-2",
          gdp: 90000,
          treasury: 30000,
          tax_rate: 0.15,
          stability: 70,
          population: 900000,
          literacy: 0.3,
          legitimacy: 70,
          tax_capacity: 0.5,
          compliance: 0.6,
          debt: 0,
          admin_capacity: 35,
          corruption: 0.1,
          manpower_pool: 8000,
          force_size: 4000,
          readiness: 0.4,
          supply: 0.7,
          war_exhaustion: 0,
          tech_level_mil: 20,
          laws: [],
          institutions: {},
          culture_mix: {},
          religion_mix: {}
        }
      },
      relations: [
        {
          from_nation_id: "nation-1",
          to_nation_id: "nation-2",
          value: 10,
          treaties: ["alliance"],
          at_war: false
        }
      ]
    },
    characterIndex: {
      "char-1": { name: "Byron", title: "Lord" },
      "char-queen": { name: "Ada", title: "Queen" }
    },
    regionAssignments: [
      { geoRegionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", geoRegionKey: "region-1", nationId: "nation-1" }
    ],
    turnIndex: 0,
    realmStats: {
      gdp: 120_000,
      treasury: 45_000,
      taxRate: 0.12,
      stability: 80,
      population: 1_200_000,
      literacy: 0.35,
      legitimacy: 78
    }
  };
}

export function buildDecisionOutput(taskId: string): DecisionParseOutput {
  return {
    task_id: taskId,
    intent_summary: "Test decision",
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
}
