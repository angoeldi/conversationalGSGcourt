import { describe, expect, it } from "vitest";
import { DecisionParseOutput, TaskContext } from "@thecourt/shared";
import { normalizeDecisionParseOutput } from "./decision";

const baseContext = TaskContext.parse({
  task_id: "11111111-1111-1111-8111-111111111111",
  task_type: "petition",
  nation_id: "22222222-2222-2222-8222-222222222222",
  created_turn: 0,
  urgency: "medium",
  prompt: "A petition arrives.",
  sources: [],
  perceived_facts: [],
  entities: [],
  constraints: { allowed_action_types: [], forbidden_action_types: [], notes: [] },
  chat_summary: "",
  last_messages: []
});

describe("normalizeDecisionParseOutput", () => {
  it("duplicates a single bundle to satisfy schema", () => {
    const normalized = normalizeDecisionParseOutput(
      {
        task_id: baseContext.task_id,
        intent_summary: "Test",
        proposed_bundles: [
          {
            label: "A",
            actions: [
              {
                type: "create_committee",
                params: { topic: "Test", duration_weeks: 4, budget: 0 }
              }
            ]
          }
        ]
      },
      baseContext,
      "Test"
    );

    const parsed = DecisionParseOutput.parse(normalized);
    expect(parsed.proposed_bundles).toHaveLength(2);
    expect(parsed.proposed_bundles[1].label).toContain("Alternative");
  });

  it("builds fallback bundles when none are provided", () => {
    const normalized = normalizeDecisionParseOutput(
      {
        task_id: baseContext.task_id,
        intent_summary: "Test",
        proposed_bundles: []
      },
      baseContext,
      "Test"
    );

    const parsed = DecisionParseOutput.parse(normalized);
    expect(parsed.proposed_bundles).toHaveLength(2);
    expect(parsed.proposed_bundles[0].actions[0].type).toBe("create_committee");
  });

  it("normalizes bundle labels and action params wrappers", () => {
    const normalized = normalizeDecisionParseOutput(
      {
        task_id: baseContext.task_id,
        intent_summary: "Test",
        proposed_bundles: [
          {
            name: "Plan A",
            actions: [
              {
                type: "send_envoy",
                target: "33333333-3333-3333-8333-333333333333",
                tone: "firm",
                topic: "Trade access"
              },
              {
                type: "fund_project",
                project: {
                  project_type: "fortifications",
                  province_id: "44444444-4444-4444-8444-444444444444",
                  budget: 500,
                  duration_weeks: 8
                }
              }
            ],
            tradeoff: ["Costly in the short term."]
          },
          {
            name: "Plan B",
            actions: [
              {
                type: "deploy_force",
                force: {
                  from: "55555555-5555-5555-8555-555555555555",
                  destination: "66666666-6666-4666-8666-666666666666",
                  units: 1200
                }
              },
              {
                type: "create_committee",
                committee: {
                  topic: "Inquiry into unrest",
                  duration_weeks: 4,
                  budget: 0
                }
              }
            ]
          }
        ]
      },
      baseContext,
      "Test"
    );

    const parsed = DecisionParseOutput.parse(normalized);
    expect(parsed.proposed_bundles[0].label).toBe("Plan A");
    expect(parsed.proposed_bundles[0].actions[0].type).toBe("send_envoy");
    expect(parsed.proposed_bundles[0].actions[0].params).toMatchObject({
      target_nation_id: "33333333-3333-3333-8333-333333333333",
      message_tone: "firm",
      topic: "Trade access"
    });
    expect(parsed.proposed_bundles[1].actions[0].type).toBe("deploy_force");
    expect(parsed.proposed_bundles[1].actions[0].params).toMatchObject({
      from_province_id: "55555555-5555-5555-8555-555555555555",
      to_province_id: "66666666-6666-4666-8666-666666666666",
      units: 1200
    });
  });
});
