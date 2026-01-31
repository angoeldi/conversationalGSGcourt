import type { Scenario } from "@thecourt/shared";
import { loadCountryCatalog, normalizeCountryKey, type CountryCatalogEntry } from "./countryCatalog";
import { loadWorld1492Polities } from "./geoPackSeeds";

export type NationDirectoryEntry = {
  nation_id: string;
  name: string;
  tag: string;
  map_aliases: string[];
  summary: string;
  trajectory: {
    gdp_growth_decade?: number;
    population_growth_decade?: number;
    stability_drift_decade?: number;
    literacy_growth_decade?: number;
  };
};

export function buildNationDirectory(scenario: Scenario): NationDirectoryEntry[] {
  const catalog = loadCountryCatalog();
  const catalogIndex = buildCatalogIndex(catalog);
  const catalogById = new Map(catalog.map((entry) => [entry.nation_id, entry]));
  const scenarioProfiles = new Map(scenario.nation_profiles?.map((profile) => [profile.nation_id, profile]) ?? []);
  const scenarioNationIds = new Set(scenario.nations.map((nation) => nation.nation_id));

  const scenarioKeys = new Set<string>();
  for (const nation of scenario.nations) {
    const key = normalizeCountryKey(nation.name);
    if (key) scenarioKeys.add(key);
  }
  for (const profile of scenario.nation_profiles ?? []) {
    for (const alias of profile.map_aliases ?? []) {
      const key = normalizeCountryKey(alias);
      if (key) scenarioKeys.add(key);
    }
  }

  const entries: NationDirectoryEntry[] = [];
  const seenIds = new Set<string>();

  for (const nation of scenario.nations) {
    const profile = scenarioProfiles.get(nation.nation_id);
    const matchedCatalog = catalogIndex.get(normalizeCountryKey(nation.name));
    const mapAliases = new Set<string>([nation.name]);
    for (const alias of profile?.map_aliases ?? []) mapAliases.add(alias);
    for (const alias of matchedCatalog?.map_aliases ?? []) mapAliases.add(alias);

    entries.push({
      nation_id: nation.nation_id,
      name: nation.name,
      tag: nation.tag,
      map_aliases: Array.from(mapAliases),
      summary: profile?.summary ?? matchedCatalog?.summary ?? `${nation.name} is a sovereign state.`,
      trajectory: {
        gdp_growth_decade: profile?.trajectory?.gdp_growth_decade ?? matchedCatalog?.trajectory.gdp_growth_decade,
        population_growth_decade: profile?.trajectory?.population_growth_decade ?? matchedCatalog?.trajectory.population_growth_decade,
        stability_drift_decade: profile?.trajectory?.stability_drift_decade ?? matchedCatalog?.trajectory.stability_drift_decade,
        literacy_growth_decade: profile?.trajectory?.literacy_growth_decade ?? matchedCatalog?.trajectory.literacy_growth_decade,
      },
    });
    seenIds.add(nation.nation_id);
  }

  for (const profile of scenario.nation_profiles ?? []) {
    if (scenarioNationIds.has(profile.nation_id)) continue;
    if (seenIds.has(profile.nation_id)) continue;
    const matchedCatalog = catalogById.get(profile.nation_id);
    if (!matchedCatalog) continue;
    const mapAliases = new Set<string>([matchedCatalog.name]);
    for (const alias of matchedCatalog.map_aliases ?? []) mapAliases.add(alias);
    for (const alias of profile.map_aliases ?? []) mapAliases.add(alias);

    entries.push({
      nation_id: matchedCatalog.nation_id,
      name: matchedCatalog.name,
      tag: matchedCatalog.tag,
      map_aliases: Array.from(mapAliases),
      summary: profile.summary ?? matchedCatalog.summary,
      trajectory: {
        gdp_growth_decade: profile.trajectory?.gdp_growth_decade ?? matchedCatalog.trajectory.gdp_growth_decade,
        population_growth_decade: profile.trajectory?.population_growth_decade ?? matchedCatalog.trajectory.population_growth_decade,
        stability_drift_decade: profile.trajectory?.stability_drift_decade ?? matchedCatalog.trajectory.stability_drift_decade,
        literacy_growth_decade: profile.trajectory?.literacy_growth_decade ?? matchedCatalog.trajectory.literacy_growth_decade,
      },
    });
    seenIds.add(profile.nation_id);
  }

  for (const entry of catalog) {
    if (seenIds.has(entry.nation_id)) continue;
    if (catalogMatchesScenario(entry, scenarioKeys)) continue;
    entries.push({
      nation_id: entry.nation_id,
      name: entry.name,
      tag: entry.tag,
      map_aliases: entry.map_aliases ?? [],
      summary: entry.summary,
      trajectory: entry.trajectory ?? {},
    });
  }

  if (scenario.geo_pack?.id === "world_1492") {
    const polities = loadWorld1492Polities();
    for (const polity of polities) {
      if (seenIds.has(polity.nation_id)) continue;
      const mapAliases = new Set<string>([polity.name, ...polity.map_aliases]);
      entries.push({
        nation_id: polity.nation_id,
        name: polity.name,
        tag: buildTagFromName(polity.name),
        map_aliases: Array.from(mapAliases),
        summary: `${polity.name} is a 1492 polity.`,
        trajectory: {},
      });
      seenIds.add(polity.nation_id);
    }
  }

  return entries;
}

function buildCatalogIndex(entries: CountryCatalogEntry[]): Map<string, CountryCatalogEntry> {
  const map = new Map<string, CountryCatalogEntry>();
  for (const entry of entries) {
    const keys = [entry.name, ...entry.map_aliases];
    for (const key of keys) {
      const normalized = normalizeCountryKey(key);
      if (!normalized || map.has(normalized)) continue;
      map.set(normalized, entry);
    }
  }
  return map;
}

function catalogMatchesScenario(entry: CountryCatalogEntry, scenarioKeys: Set<string>): boolean {
  const keys = [entry.name, ...entry.map_aliases];
  return keys.some((key) => {
    const normalized = normalizeCountryKey(key);
    return normalized ? scenarioKeys.has(normalized) : false;
  });
}

function buildTagFromName(name: string): string {
  const parts = name.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "UNK";
  let tag = parts.map((part) => part[0]).join("").slice(0, 3);
  if (tag.length < 3) {
    tag = (parts[0] ?? "UNK").slice(0, 3);
  }
  return tag.toUpperCase();
}
