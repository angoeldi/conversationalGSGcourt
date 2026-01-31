import type { WorldState } from "@thecourt/engine";
import type { Scenario } from "@thecourt/shared";
import { loadCountryCatalog, normalizeCountryKey } from "./countryCatalog";
import { loadWorld1492Polities } from "./geoPackSeeds";

export function buildWorldState(scenario: Scenario, seed: number, turnIndex = 0): WorldState {
  const nations = scenario.nation_snapshots.reduce<Record<string, WorldState["nations"][string]>>((acc, n) => {
    acc[n.nation_id] = { ...n };
    return acc;
  }, {});

  const provinces = scenario.province_snapshots.reduce<Record<string, WorldState["provinces"][string]>>((acc, p) => {
    acc[p.geo_region_id] = { ...p };
    return acc;
  }, {});

  const base: WorldState = {
    turn_index: turnIndex,
    turn_seed: seed,
    player_nation_id: scenario.player_nation_id,
    nations,
    provinces,
    relations: scenario.relations ?? [],
    operations: [],
    nation_trajectories: {},
    trajectory_modifiers: [],
    appointments: scenario.appointments.map((entry) => ({
      office_id: entry.office_id,
      character_id: entry.character_id,
      start_turn: entry.start_turn ?? 0
    })),
    debt_instruments: []
  };
  return hydrateWorldState(scenario, base).state;
}

export function hydrateWorldState(scenario: Scenario, state: WorldState): { state: WorldState; changed: boolean } {
  const next = structuredClone(state) as WorldState;
  let changed = false;

  if (!next.player_nation_id) {
    next.player_nation_id = scenario.player_nation_id;
    changed = true;
  }

  if (!next.nation_trajectories) {
    next.nation_trajectories = {};
    changed = true;
  }

  if (!next.trajectory_modifiers) {
    next.trajectory_modifiers = [];
    changed = true;
  }

  if (!next.appointments || next.appointments.length === 0) {
    next.appointments = scenario.appointments.map((entry) => ({
      office_id: entry.office_id,
      character_id: entry.character_id,
      start_turn: entry.start_turn ?? 0
    }));
    changed = true;
  }

  if (!next.debt_instruments) {
    next.debt_instruments = [];
    changed = true;
  }

  const catalog = loadCountryCatalog();
  const scenarioNationByKey = buildScenarioNationKeyMap(scenario);

  for (const entry of catalog) {
    const key = normalizeCountryKey(entry.name);
    const matchedNationId = key ? scenarioNationByKey.get(key) : undefined;
    const nationId = matchedNationId ?? entry.nation_id;
    if (!next.nations[nationId]) {
      next.nations[nationId] = buildNationStateFromCatalog(entry, nationId);
      changed = true;
    }
  }

  if (scenario.geo_pack?.id === "world_1492") {
    const polities = loadWorld1492Polities();
    const seedScale = buildSeedScaling(polities);
    const seedOverrides = buildSeedOverrides(polities, seedScale);
    const scenarioNationIds = new Set(scenario.nation_snapshots.map((n) => n.nation_id));
    const rescaleOutdated = shouldRescaleWorld1492(next, polities);
    const shouldOverride = next.turn_index <= 1 || rescaleOutdated;
    for (const polity of polities) {
      const exists = next.nations[polity.nation_id];
      const isPlayer = polity.nation_id === scenario.player_nation_id;
      if (exists && (!shouldOverride || isPlayer)) continue;
      if (exists && !rescaleOutdated && scenarioNationIds.has(polity.nation_id) && next.turn_index > 1) continue;
      const overrides = seedOverrides.get(polity.nation_id);
      next.nations[polity.nation_id] = buildNationStateFromSeed(polity, overrides, seedScale);
      changed = true;
    }
  }

  for (const profile of scenario.nation_profiles ?? []) {
    if (profile.nation_id === scenario.player_nation_id) continue;
    if (!next.nation_trajectories[profile.nation_id]) {
      next.nation_trajectories[profile.nation_id] = {
        gdp_growth_decade: profile.trajectory?.gdp_growth_decade ?? 0,
        population_growth_decade: profile.trajectory?.population_growth_decade ?? 0,
        stability_drift_decade: profile.trajectory?.stability_drift_decade ?? 0,
        literacy_growth_decade: profile.trajectory?.literacy_growth_decade ?? 0,
      };
      changed = true;
    }
  }

  for (const entry of catalog) {
    const key = normalizeCountryKey(entry.name);
    const matchedNationId = key ? scenarioNationByKey.get(key) : undefined;
    const nationId = matchedNationId ?? entry.nation_id;
    if (nationId === scenario.player_nation_id) continue;
    if (!next.nation_trajectories[nationId]) {
      next.nation_trajectories[nationId] = {
        gdp_growth_decade: entry.trajectory.gdp_growth_decade ?? 0,
        population_growth_decade: entry.trajectory.population_growth_decade ?? 0,
        stability_drift_decade: entry.trajectory.stability_drift_decade ?? 0,
        literacy_growth_decade: entry.trajectory.literacy_growth_decade ?? 0,
      };
      changed = true;
    }
  }

  if (scenario.geo_pack?.id === "world_1492") {
    const polities = loadWorld1492Polities();
    const seedScale = buildSeedScaling(polities);
    const seedTrajectories = buildSeedTrajectories(polities, seedScale);
    const rescaleOutdated = shouldRescaleWorld1492(next, polities);
    const shouldOverride = next.turn_index <= 1 || rescaleOutdated;
    for (const polity of polities) {
      if (polity.nation_id === scenario.player_nation_id) continue;
      if (next.nation_trajectories[polity.nation_id] && !shouldOverride) continue;
      const trajectory = seedTrajectories.get(polity.nation_id);
      if (!trajectory) continue;
      next.nation_trajectories[polity.nation_id] = trajectory;
      changed = true;
    }
  }

  return { state: next, changed };
}

function buildScenarioNationKeyMap(scenario: Scenario): Map<string, string> {
  const map = new Map<string, string>();
  for (const nation of scenario.nations) {
    const key = normalizeCountryKey(nation.name);
    if (key) map.set(key, nation.nation_id);
  }
  for (const profile of scenario.nation_profiles ?? []) {
    for (const alias of profile.map_aliases ?? []) {
      const key = normalizeCountryKey(alias);
      if (key && !map.has(key)) map.set(key, profile.nation_id);
    }
  }
  return map;
}

function buildNationStateFromCatalog(entry: ReturnType<typeof loadCountryCatalog>[number], nationId: string): WorldState["nations"][string] {
  const population = Math.max(10_000, Number(entry.population_est || 0));
  const gdpBase = Number(entry.gdp_md_est || 0);
  const gdp = Math.max(1_000_000, gdpBase > 0 ? gdpBase * 1_000_000 : population * 500);
  const literacy = incomeToLiteracy(entry.income_group);
  const manpower = Math.round(population * 0.02);

  return {
    nation_id: nationId,
    gdp,
    tax_rate: 0.28,
    tax_capacity: 0.6,
    compliance: 0.7,
    treasury: Math.round(gdp / 1000),
    debt: Math.round(gdp / 2000),
    stability: 55,
    legitimacy: 50,
    population,
    literacy,
    admin_capacity: 30,
    corruption: 0.25,
    manpower_pool: manpower,
    force_size: Math.round(manpower * 0.2),
    readiness: 0.4,
    supply: 0.5,
    war_exhaustion: 0,
    tech_level_mil: 30,
    laws: [],
    institutions: {},
    culture_mix: {},
    religion_mix: {},
  };
}

type SeedOverrides = {
  stability?: number;
  legitimacy?: number;
  literacy?: number;
  tax_capacity?: number;
  admin_capacity?: number;
  tech_level_mil?: number;
  compliance?: number;
  tax_rate?: number;
};

function buildNationStateFromSeed(
  entry: { gdp_md?: number; pop_est?: number; gdp_1492?: number; pop_1492?: number; nation_id: string },
  overrides: SeedOverrides | undefined,
  scale?: SeedScale
): WorldState["nations"][string] {
  const { population, gdp } = deriveSeedEconomy(entry, scale);
  const manpower = Math.round(population * 0.02);

  return {
    nation_id: entry.nation_id,
    gdp,
    tax_rate: overrides?.tax_rate ?? 0.24,
    tax_capacity: overrides?.tax_capacity ?? 0.52,
    compliance: overrides?.compliance ?? 0.62,
    treasury: Math.round(gdp / 1200),
    debt: Math.round(gdp / 2400),
    stability: overrides?.stability ?? 52,
    legitimacy: overrides?.legitimacy ?? 48,
    population,
    literacy: overrides?.literacy ?? 0.12,
    admin_capacity: overrides?.admin_capacity ?? 26,
    corruption: 0.27,
    manpower_pool: manpower,
    force_size: Math.round(manpower * 0.18),
    readiness: 0.35,
    supply: 0.45,
    war_exhaustion: 6,
    tech_level_mil: overrides?.tech_level_mil ?? 24,
    laws: [],
    institutions: {},
    culture_mix: {},
    religion_mix: {},
  };
}

function buildSeedOverrides(
  polities: Array<{ nation_id: string; gdp_md?: number; pop_est?: number }>,
  scale: SeedScale
): Map<string, SeedOverrides> {
  if (polities.length === 0) return new Map();
  const stats = polities.map((entry) => {
    const { gdp, population } = deriveSeedEconomy(entry, scale);
    const perCap = population > 0 ? gdp / population : 0;
    return { nation_id: entry.nation_id, gdp, population, perCap };
  });
  const perCapValues = stats.map((entry) => entry.perCap);
  const minPerCap = Math.min(...perCapValues);
  const maxPerCap = Math.max(...perCapValues);
  const denom = maxPerCap > minPerCap ? maxPerCap - minPerCap : 1;

  const overrides = new Map<string, SeedOverrides>();
  for (const entry of stats) {
    const ratio = Math.max(0, Math.min(1, (entry.perCap - minPerCap) / denom));
    const stability = Math.round(38 + ratio * 32);
    const legitimacy = Math.round(34 + ratio * 40);
    const literacy = Number((0.04 + ratio * 0.22).toFixed(2));
    const tax_capacity = Number((0.38 + ratio * 0.22).toFixed(2));
    const admin_capacity = Math.round(14 + ratio * 20);
    const tech_level_mil = Math.round(14 + ratio * 18);
    const compliance = Number((0.52 + ratio * 0.18).toFixed(2));
    overrides.set(entry.nation_id, {
      stability,
      legitimacy,
      literacy,
      tax_capacity,
      admin_capacity,
      tech_level_mil,
      compliance
    });
  }
  return overrides;
}

function buildSeedTrajectories(
  polities: Array<{ nation_id: string; gdp_md?: number; pop_est?: number; gdp_1492?: number; pop_1492?: number }>,
  scale: SeedScale
): Map<string, { gdp_growth_decade?: number; population_growth_decade?: number; stability_drift_decade?: number; literacy_growth_decade?: number }> {
  if (polities.length === 0) return new Map();
  const stats = polities.map((entry) => {
    const { gdp, population } = deriveSeedEconomy(entry, scale);
    const perCap = population > 0 ? gdp / population : 0;
    return { nation_id: entry.nation_id, perCap };
  });
  const perCapValues = stats.map((entry) => entry.perCap);
  const minPerCap = Math.min(...perCapValues);
  const maxPerCap = Math.max(...perCapValues);
  const denom = maxPerCap > minPerCap ? maxPerCap - minPerCap : 1;

  const trajectories = new Map<string, { gdp_growth_decade?: number; population_growth_decade?: number; stability_drift_decade?: number; literacy_growth_decade?: number }>();
  for (const entry of stats) {
    const ratio = Math.max(0, Math.min(1, (entry.perCap - minPerCap) / denom));
    const gdpGrowthDecade = Number((0.01 + ratio * 0.02).toFixed(3));
    const populationGrowthDecade = Number((0.02 - ratio * 0.006).toFixed(3));
    const stabilityDriftDecade = Number(((ratio - 0.5) * 0.6).toFixed(2));
    const literacyGrowthDecade = Number((0.005 + ratio * 0.01).toFixed(3));
    trajectories.set(entry.nation_id, {
      gdp_growth_decade: gdpGrowthDecade,
      population_growth_decade: populationGrowthDecade,
      stability_drift_decade: stabilityDriftDecade,
      literacy_growth_decade: literacyGrowthDecade
    });
  }
  return trajectories;
}

function shouldRescaleWorld1492(state: WorldState, polities: Array<{ nation_id: string }>): boolean {
  const samples: Array<{ perCap: number; gdp: number }> = [];
  const appendSample = (nation: WorldState["nations"][string] | undefined) => {
    if (!nation) return;
    const population = nation.population ?? 0;
    const gdp = nation.gdp ?? 0;
    if (!Number.isFinite(population) || population <= 0 || !Number.isFinite(gdp) || gdp <= 0) return;
    samples.push({ perCap: gdp / population, gdp });
  };

  for (const polity of polities) {
    appendSample(state.nations[polity.nation_id]);
  }

  if (samples.length < 10) {
    for (const nation of Object.values(state.nations)) {
      appendSample(nation);
    }
  }

  if (samples.length < 10) return false;
  const perCaps = samples.map((s) => s.perCap).sort((a, b) => a - b);
  const median = perCaps[Math.floor(perCaps.length / 2)] ?? 0;
  const maxGdp = Math.max(...samples.map((s) => s.gdp));
  return median > 2500 || maxGdp > 1_000_000_000_000;
}

type SeedScale = {
  pop_scale: number;
  gdp_scale: number;
};

function buildSeedScaling(polities: Array<{ gdp_md?: number; pop_est?: number }>): SeedScale {
  const totals = polities.reduce(
    (acc, entry) => {
      const pop = Number(entry.pop_est || 0);
      const gdpMd = Number(entry.gdp_md || 0);
      acc.pop += Number.isFinite(pop) ? pop : 0;
      acc.gdp += Number.isFinite(gdpMd) ? gdpMd * 1_000_000 : 0;
      return acc;
    },
    { pop: 0, gdp: 0 }
  );
  const targetPop = 450_000_000;
  const targetGdpPerCap = 900;
  const popScale = totals.pop > 0 ? targetPop / totals.pop : 1;
  const modernPerCap = totals.pop > 0 ? totals.gdp / totals.pop : targetGdpPerCap;
  const gdpScale = totals.pop > 0 ? popScale * (targetGdpPerCap / Math.max(1, modernPerCap)) : popScale;
  return {
    pop_scale: clampNumber(popScale, 0.02, 0.2),
    gdp_scale: clampNumber(gdpScale, 0.001, 0.2)
  };
}

function deriveSeedEconomy(
  entry: { gdp_md?: number; pop_est?: number; gdp_1492?: number; pop_1492?: number },
  scale?: SeedScale
): { population: number; gdp: number } {
  const popRaw = Number(entry.pop_1492 ?? entry.pop_est ?? 0);
  const population = Math.max(10_000, popRaw * (scale?.pop_scale ?? 1));
  const gdpBase = Number(entry.gdp_1492 ?? entry.gdp_md ?? 0);
  const gdpScaled = gdpBase > 0 ? gdpBase * (entry.gdp_1492 ? 1 : 1_000_000) * (scale?.gdp_scale ?? 1) : 0;
  const gdp = Math.max(1_000_000, gdpScaled > 0 ? gdpScaled : population * 500);
  return { population, gdp };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function incomeToLiteracy(incomeGroup: string | null | undefined): number {
  const group = String(incomeGroup ?? "").trim();
  const tier = Number.parseInt(group.slice(0, 1), 10);
  switch (tier) {
    case 1:
      return 0.85;
    case 2:
      return 0.7;
    case 3:
      return 0.6;
    case 4:
      return 0.5;
    case 5:
      return 0.4;
    default:
      return 0.55;
  }
}
