import fs from "node:fs";
import path from "node:path";

export type GeoPackPolity = {
  nation_id: string;
  name: string;
  map_aliases: string[];
  gdp_md?: number;
  pop_est?: number;
  gdp_1492?: number;
  pop_1492?: number;
};

const WORLD_1492_PATH = resolveWorld1492Path();
const WORLD_1492_OVERRIDES_PATH = path.resolve(process.cwd(), "apps/server/data/world_1492_overrides.json");
let cachedWorld1492: GeoPackPolity[] | null = null;

export function loadWorld1492Polities(): GeoPackPolity[] {
  if (cachedWorld1492) return cachedWorld1492;
  try {
    const raw = fs.readFileSync(WORLD_1492_PATH, "utf8");
    const json = JSON.parse(raw) as { features?: Array<{ properties?: Record<string, any> }> };
    const entries: GeoPackPolity[] = [];
    const byId = new Map<string, GeoPackPolity & { _aliases?: Set<string> }>();
    const overrides = loadWorld1492Overrides();

    for (const feature of json.features ?? []) {
      const props = feature.properties ?? {};
      const nationId = typeof props.nation_id === "string" ? props.nation_id : "";
      if (!nationId) continue;

      const name = String(props.ADMIN_1492 || props.NATION_NAME_1492 || props.ADMIN || props.NAME || "Unknown polity");
      const aliasKeys = [
        props.ADMIN_1492,
        props.NATION_NAME_1492,
        props.ADMIN,
        props.NAME,
        props.NAME_LONG,
        props.ADMIN_MODERN,
        props.SOVEREIGNT
      ];
      const gdp = Number(props.GDP_MD);
      const pop = Number(props.POP_EST);

      const existing = byId.get(nationId);
      const aliasSet = existing?._aliases ?? new Set<string>(existing?.map_aliases ?? []);
      for (const alias of aliasKeys) {
        if (typeof alias === "string" && alias.trim()) aliasSet.add(alias.trim());
      }

      const override = overrides.get(nationId);
      const next: GeoPackPolity & { _aliases?: Set<string> } = {
        nation_id: nationId,
        name: existing?.name ?? name,
        map_aliases: Array.from(aliasSet),
        gdp_md: Number.isFinite(gdp) ? Math.max(existing?.gdp_md ?? 0, gdp) : existing?.gdp_md,
        pop_est: Number.isFinite(pop) ? Math.max(existing?.pop_est ?? 0, pop) : existing?.pop_est,
        gdp_1492: override?.gdp ?? existing?.gdp_1492,
        pop_1492: override?.population ?? existing?.pop_1492,
        _aliases: aliasSet
      };
      byId.set(nationId, next);
    }

    for (const entry of byId.values()) {
      const { _aliases, ...clean } = entry;
      entries.push(clean);
    }
    cachedWorld1492 = entries;
    return entries;
  } catch {
    cachedWorld1492 = [];
    return [];
  }
}

function loadWorld1492Overrides(): Map<string, { gdp: number; population: number }> {
  try {
    if (!fs.existsSync(WORLD_1492_OVERRIDES_PATH)) return new Map();
    const raw = fs.readFileSync(WORLD_1492_OVERRIDES_PATH, "utf8");
    const json = JSON.parse(raw) as { entries?: Array<{ nation_id: string; gdp: number; population: number }> };
    const map = new Map<string, { gdp: number; population: number }>();
    for (const entry of json.entries ?? []) {
      if (!entry?.nation_id) continue;
      map.set(entry.nation_id, { gdp: entry.gdp, population: entry.population });
    }
    return map;
  } catch {
    return new Map();
  }
}

function resolveWorld1492Path(): string {
  const candidates = [
    path.resolve(process.cwd(), "apps/web/public/data/geo/scenarios/1492/admin0.geojson"),
    path.resolve(process.cwd(), "../web/public/data/geo/scenarios/1492/admin0.geojson")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}
