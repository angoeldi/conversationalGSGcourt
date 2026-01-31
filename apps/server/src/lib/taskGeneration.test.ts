import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Scenario } from "@thecourt/shared";
import { generateTasksForTurn, type StorySeed } from "./taskGeneration";

describe("generateTasksForTurn", () => {
  it("creates deterministic tasks for a turn", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../data/scenarios/default.england_1492.json");
    const raw = fs.readFileSync(scenarioPath, "utf8");
    const scenario = Scenario.parse(JSON.parse(raw));

    const wikiContext = [
      {
        title: "Test Chronicle",
        url: "https://en.wikipedia.org/wiki/Test_Chronicle",
        extract: "A brief account of the realm and its political tensions."
      }
    ];
    const first = generateTasksForTurn(scenario, 1, 1234, 2, wikiContext);
    const second = generateTasksForTurn(scenario, 1, 1234, 2, wikiContext);

    expect(first).toHaveLength(2);
    expect(first[0].task_id).toBe(second[0].task_id);
    expect(first[0].context.prompt).not.toContain("Context (Wikipedia:");
    expect(first[0].context.sources).toEqual([
      {
        source_type: "wikipedia",
        title: "Test Chronicle",
        url: "https://en.wikipedia.org/wiki/Test_Chronicle",
        excerpt: "A brief account of the realm and its political tensions."
      }
    ]);
    expect(first[0].context.created_turn).toBe(1);
  });

  it("can continue a story seed into a new task", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../data/scenarios/default.england_1492.json");
    const raw = fs.readFileSync(scenarioPath, "utf8");
    const scenario = Scenario.parse(JSON.parse(raw));

    const seed: StorySeed = {
      story_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      title: "Succession Petition",
      summary: "A succession dispute brews.",
      history: ["Week 1: A succession dispute brews."],
      last_turn: 1,
      task_type: "petition"
    };

    const tasks = generateTasksForTurn(scenario, 2, 5678, 1, [], [seed], undefined, 1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].context.story?.story_id).toBe(seed.story_id);
    expect(tasks[0].context.story?.history.length).toBeGreaterThan(seed.history.length);
  });
});
