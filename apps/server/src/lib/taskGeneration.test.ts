import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Scenario } from "@thecourt/shared";
import { deriveTaskGenerationTuning, generateTasksForTurn, type StorySeed } from "./taskGeneration";

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


describe("deriveTaskGenerationTuning", () => {
  it("keeps early turns more diverse and lower continuity than later turns", () => {
    const early = deriveTaskGenerationTuning({
      turnIndex: 2,
      openTaskPressure: 0.25,
      playerNationId: "england",
      recentTaskTypeCounts: { petition: 2, diplomacy: 2 }
    });
    const late = deriveTaskGenerationTuning({
      turnIndex: 30,
      openTaskPressure: 0.7,
      playerNationId: "england",
      recentTaskTypeCounts: { petition: 8, diplomacy: 1, intrigue: 1 }
    });

    expect(early.options.requireQuirk).toBe(true);
    expect(early.options.minPetitions).toBeGreaterThanOrEqual(1);
    expect(late.options.continuationShare).toBeGreaterThan(early.options.continuationShare);
    expect(late.options.minContinuations).toBeGreaterThanOrEqual(early.options.minContinuations);
    expect(late.storyChance).toBeGreaterThan(early.storyChance);
  });

  it("increases continuity when nation stress rises", () => {
    const lowStress = deriveTaskGenerationTuning({
      turnIndex: 14,
      openTaskPressure: 0.4,
      playerNationId: "england",
      recentTaskTypeCounts: { petition: 3, diplomacy: 2 },
      worldState: {
        nations: {
          england: {
            nation_id: "england",
            treasury: 400,
            stability: 75,
            gdp: 2000,
            legitimacy: 72,
            war_exhaustion: 8
          }
        }
      } as any
    });

    const highStress = deriveTaskGenerationTuning({
      turnIndex: 14,
      openTaskPressure: 0.4,
      playerNationId: "england",
      recentTaskTypeCounts: { petition: 3, diplomacy: 2 },
      worldState: {
        nations: {
          england: {
            nation_id: "england",
            treasury: 40,
            stability: 28,
            gdp: 2400,
            legitimacy: 32,
            war_exhaustion: 82
          }
        }
      } as any
    });

    expect(highStress.options.continuationShare).toBeGreaterThan(lowStress.options.continuationShare);
    expect(highStress.options.minContinuations).toBeGreaterThanOrEqual(lowStress.options.minContinuations);
    expect(highStress.storyChance).toBeGreaterThan(lowStress.storyChance);
  });
});
