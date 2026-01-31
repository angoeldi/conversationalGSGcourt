import fs from "node:fs/promises";
import path from "node:path";
import { Scenario } from "@thecourt/shared";
import { normalizeScenarioGeoRegions } from "./geoRegion";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveScenarioPath(): Promise<string> {
  const envPath = process.env.DEFAULT_SCENARIO_PATH?.trim();
  if (envPath) return envPath;

  const fromRepoRoot = path.resolve(process.cwd(), "apps/server/data/scenarios/default.england_1492.json");
  if (await pathExists(fromRepoRoot)) return fromRepoRoot;

  return path.resolve(process.cwd(), "data/scenarios/default.england_1492.json");
}

export async function loadScenario(): Promise<Scenario> {
  const scenarioPath = await resolveScenarioPath();
  const raw = await fs.readFile(scenarioPath, "utf8");
  const json = JSON.parse(raw);
  const normalized = normalizeScenarioGeoRegions(json);
  const parsed = Scenario.safeParse(normalized.scenario);
  if (!parsed.success) {
    throw new Error(`Scenario invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
