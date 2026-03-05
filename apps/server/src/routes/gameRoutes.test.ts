import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { Scenario } from "@thecourt/shared";
import { generateTasksForTurn } from "../lib/taskGeneration";
import { buildStorySeeds } from "./storySeeds";

describe("buildStorySeeds", () => {
  it("ignores queued/superseded decisions and only carries resolved outcomes into continuations", async () => {
    const taskId = "11111111-1111-1111-1111-111111111111";
    const gameId = "22222222-2222-2222-2222-222222222222";

    const fakeClient = {
      query: async (sql: string) => {
        if (sql.includes("FROM tasks")) {
          return {
            rows: [
              {
                task_id: taskId,
                task_type: "petition",
                closed_turn: 5,
                context: {
                  task_id: taskId,
                  task_type: "petition",
                  nation_id: "33333333-3333-3333-3333-333333333333",
                  created_turn: 5,
                  urgency: "medium",
                  prompt: "A harbor levy dispute returns to court.",
                  sources: [],
                  perceived_facts: [],
                  entities: [],
                  constraints: { allowed_action_types: [], forbidden_action_types: [], suggested_action_types: ["policy_change"], notes: [] },
                  chat_summary: "",
                  last_messages: [],
                  story: {
                    story_id: "44444444-4444-4444-4444-444444444444",
                    title: "Harbor Levy Dispute",
                    summary: "A harbor levy dispute returns to court",
                    history: ["Week 4: A harbor levy dispute returns to court."],
                    last_turn: 4,
                    transcripts: []
                  }
                }
              }
            ]
          };
        }

        if (sql.includes("FROM decision_queue")) {
          return {
            rows: [
              {
                task_id: taskId,
                processed_turn: 5,
                decision_json: {
                  task_id: taskId,
                  intent_summary: "Grant a temporary levy exemption for one season.",
                  proposed_bundles: [
                    {
                      label: "Temporary exemption",
                      actions: [{ type: "adjust_tax_rate", params: { new_tax_rate: 0.18 } }],
                      tradeoffs: []
                    },
                    {
                      label: "Status quo",
                      actions: [{ type: "adjust_tax_rate", params: { new_tax_rate: 0.22 } }],
                      tradeoffs: []
                    }
                  ],
                  clarifying_questions: [],
                  assumptions: []
                }
              }
            ]
          };
        }

        if (sql.includes("FROM chat_messages")) {
          return {
            rows: [
              {
                task_id: taskId,
                sender_type: "player",
                sender_character_id: null,
                content: "I will exempt the levy this season.",
                created_at: "2024-01-01T00:00:00.000Z"
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    } as unknown as pg.PoolClient;

    const seeds = await buildStorySeeds(fakeClient, gameId, 6);

    expect(seeds).toHaveLength(1);
    expect(seeds[0].history[seeds[0].history.length - 1]).toContain("Decision: Grant a temporary levy exemption for one season.");
    expect(seeds[0].history[seeds[0].history.length - 1]).not.toContain("Increase tariffs");

    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../data/scenarios/default.england_1492.json");
    const scenario = Scenario.parse(JSON.parse(fs.readFileSync(scenarioPath, "utf8")));

    const tasks = generateTasksForTurn(scenario, 6, 9999, 1, [], seeds, undefined, 1, { minContinuations: 1 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].context.prompt).toContain("Decision was Grant a temporary levy exemption for one season");
    expect(tasks[0].context.prompt).not.toContain("Increase tariffs");
    expect(tasks[0].context.story?.history.some((entry) => entry.includes("Decision: Grant a temporary levy exemption for one season."))).toBe(true);
  });
});
