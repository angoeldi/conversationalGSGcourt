import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Action, TaskContext as TaskContextSchema } from "@thecourt/shared";
import type { TaskContext } from "@thecourt/shared";
import { Scenario } from "@thecourt/shared";
import { buildAutoDecision } from "./autoDecision";

describe("buildAutoDecision", () => {
  it("returns a valid decision using allowed action types", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../data/scenarios/default.england_1492.json");
    const raw = fs.readFileSync(scenarioPath, "utf8");
    const scenario = Scenario.parse(JSON.parse(raw));
    const task = scenario.initial_tasks[0];

    const context: TaskContext = TaskContextSchema.parse({
      task_id: "00000000-0000-4000-8000-000000000001",
      task_type: task.task_type,
      owner_character_id: task.owner_character_id,
      nation_id: scenario.player_nation_id,
      created_turn: 0,
      urgency: task.urgency ?? "medium",
      prompt: task.prompt,
      perceived_facts: [],
      entities: [],
      constraints: {
        allowed_action_types: ["adjust_tax_rate", "issue_debt"],
        forbidden_action_types: [],
        notes: []
      },
      chat_summary: "",
      last_messages: []
    });

    const result = buildAutoDecision(context, scenario, 1234, 2);

    expect(result.decision.proposed_bundles).toHaveLength(2);
    expect(result.chosen_actions).toHaveLength(1);
    expect(["adjust_tax_rate", "issue_debt"]).toContain(result.chosen_actions[0].type);
    Action.parse(result.chosen_actions[0]);
  });
});
