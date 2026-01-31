import fs from "node:fs/promises";
import path from "node:path";
import { Scenario } from "@thecourt/shared";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveScenarioDir(): Promise<string> {
  const fromRepoRoot = path.resolve(process.cwd(), "apps/server/data/scenarios");
  if (await pathExists(fromRepoRoot)) return fromRepoRoot;
  return path.resolve(process.cwd(), "data/scenarios");
}

async function main(): Promise<void> {
  const scenarioDir = await resolveScenarioDir();
  const entries = await fs.readdir(scenarioDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);

  if (files.length === 0) {
    console.error(`No scenario JSON files found in ${scenarioDir}`);
    process.exit(1);
  }

  let hasErrors = false;

  for (const file of files) {
    const fullPath = path.join(scenarioDir, file);
    try {
      const raw = await fs.readFile(fullPath, "utf8");
      const json = JSON.parse(raw);
      const parsed = Scenario.safeParse(json);
      if (!parsed.success) {
        console.error(`Scenario validation failed for ${file}: ${parsed.error.message}`);
        hasErrors = true;
      } else {
        console.log(`Scenario OK: ${file}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Scenario validation failed for ${file}: ${message}`);
      hasErrors = true;
    }
  }

  if (hasErrors) process.exit(1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Scenario validation error: ${message}`);
  process.exit(1);
});
