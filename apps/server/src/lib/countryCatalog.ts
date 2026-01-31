import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CountryCatalogEntry = {
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
  population_est: number;
  gdp_md_est: number;
  continent: string | null;
  subregion: string | null;
  economy: string | null;
  income_group: string | null;
};

const catalogPath = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data/country_catalog.json");
})();

let cached: CountryCatalogEntry[] | null = null;

export function loadCountryCatalog(): CountryCatalogEntry[] {
  if (cached) return cached;
  if (!fs.existsSync(catalogPath)) return [];
  const raw = fs.readFileSync(catalogPath, "utf8");
  const parsed = JSON.parse(raw) as { entries?: CountryCatalogEntry[] };
  cached = Array.isArray(parsed.entries) ? parsed.entries : [];
  return cached;
}

export function normalizeCountryKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
