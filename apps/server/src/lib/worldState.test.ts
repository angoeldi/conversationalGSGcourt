import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Scenario } from "@thecourt/shared";
import { buildWorldState, hydrateWorldState } from "./worldState";
import { loadWorld1492Polities } from "./geoPackSeeds";

describe("buildWorldState", () => {
  it("hydrates snapshot maps and seeds turn metadata", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../data/scenarios/default.england_1492.json");
    const raw = fs.readFileSync(scenarioPath, "utf8");
    const scenario = Scenario.parse(JSON.parse(raw));

    const world = buildWorldState(scenario, 12345, 7);

    expect(world.turn_seed).toBe(12345);
    expect(world.turn_index).toBe(7);
    expect(world.player_nation_id).toBe(scenario.player_nation_id);
    expect(Object.keys(world.nations).length).toBeGreaterThanOrEqual(scenario.nation_snapshots.length);
    expect(Object.keys(world.provinces)).toHaveLength(scenario.province_snapshots.length);

    const sampleNation = scenario.nation_snapshots[0];
    const sampleProvince = scenario.province_snapshots[0];

    expect(world.nations[sampleNation.nation_id]?.nation_id).toBe(sampleNation.nation_id);
    expect(world.provinces[sampleProvince.geo_region_id]?.geo_region_id).toBe(sampleProvince.geo_region_id);

    if (scenario.relations) {
      expect(world.relations).toEqual(scenario.relations);
    } else {
      expect(world.relations).toEqual([]);
    }

    expect(world.operations).toEqual([]);
    expect(world.nation_trajectories).toBeDefined();
    expect(world.trajectory_modifiers).toEqual([]);
  });

  it("seeds 1492 polities with varied stability", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../data/scenarios/default.england_1492.json");
    const raw = fs.readFileSync(scenarioPath, "utf8");
    const scenario = Scenario.parse(JSON.parse(raw));

    const polities = loadWorld1492Polities();
    expect(polities.length).toBeGreaterThan(0);

    const world = buildWorldState(scenario, 456, 0);
    const seeded = polities
      .map((entry) => world.nations[entry.nation_id])
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    expect(seeded.length).toBeGreaterThan(0);

    const stabilities = seeded.map((entry) => entry.stability);
    const min = Math.min(...stabilities);
    const max = Math.max(...stabilities);
    expect(max - min).toBeGreaterThan(0);
  });

  it("rescales outdated 1492 stats when GDPs look modern", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scenarioPath = path.resolve(here, "../../data/scenarios/default.england_1492.json");
    const raw = fs.readFileSync(scenarioPath, "utf8");
    const scenario = Scenario.parse(JSON.parse(raw));
    const world = buildWorldState(scenario, 2222, 4);

    const polities = loadWorld1492Polities();
    const target = polities.find((entry) => entry.nation_id !== scenario.player_nation_id);
    expect(target).toBeTruthy();

    if (target) {
      world.nations[target.nation_id] = {
        ...world.nations[target.nation_id],
        gdp: 14_000_000_000_000,
        population: 1_400_000_000
      };
    }

    const hydrated = hydrateWorldState(scenario, world);
    expect(hydrated.changed).toBe(true);
    if (target) {
      expect(hydrated.state.nations[target.nation_id].gdp).toBeLessThan(1_000_000_000_000);
    }
  });
});
