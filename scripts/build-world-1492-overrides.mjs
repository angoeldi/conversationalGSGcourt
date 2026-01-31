#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function readArg(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value ?? fallback;
}

function hasFlag(flag) {
  return args.includes(flag);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

const inputPath = path.resolve(process.cwd(), readArg("--in", "apps/web/public/data/geo/scenarios/1492/admin0.geojson"));
const outputPath = path.resolve(process.cwd(), readArg("--out", "apps/server/data/world_1492_overrides.json"));
const dryRun = hasFlag("--dry-run");

const targetPop = Number(readArg("--target-pop", "450000000"));
const basePerCap = Number(readArg("--base-per-cap", "220"));
const minPerCap = Number(readArg("--min-per-cap", "80"));
const maxPerCap = Number(readArg("--max-per-cap", "450"));
const alpha = Number(readArg("--alpha", "0.35"));
const scalePerCap = Number(readArg("--scale-per-cap", "900"));
const popScaleMin = Number(readArg("--pop-scale-min", "0.02"));
const popScaleMax = Number(readArg("--pop-scale-max", "0.2"));
const gdpScaleMin = Number(readArg("--gdp-scale-min", "0.001"));
const gdpScaleMax = Number(readArg("--gdp-scale-max", "0.2"));

const raw = fs.readFileSync(inputPath, "utf8");
const geo = JSON.parse(raw);
const byId = new Map();

for (const feature of geo.features ?? []) {
  const props = feature?.properties ?? {};
  const nationId = typeof props.nation_id === "string" ? props.nation_id : "";
  if (!nationId) continue;
  const pop = Number(props.POP_EST);
  const gdpMd = Number(props.GDP_MD);
  const entry = byId.get(nationId) ?? { pop_est: 0, gdp_md: 0 };
  if (Number.isFinite(pop)) entry.pop_est = Math.max(entry.pop_est, pop);
  if (Number.isFinite(gdpMd)) entry.gdp_md = Math.max(entry.gdp_md, gdpMd);
  byId.set(nationId, entry);
}

const popValues = [];
let totalPop = 0;
let totalGdp = 0;
for (const entry of byId.values()) {
  const pop = Number(entry.pop_est || 0);
  const gdp = Number(entry.gdp_md || 0) * 1_000_000;
  if (Number.isFinite(pop) && pop > 0) {
    totalPop += pop;
    popValues.push(pop);
  }
  if (Number.isFinite(gdp) && gdp > 0) {
    totalGdp += gdp;
  }
}

const fallbackPop = median(popValues) || 500_000;
const modernPerCap = totalPop > 0 ? totalGdp / totalPop : scalePerCap;
const popScaleRaw = totalPop > 0 ? targetPop / totalPop : 1;
const popScale = clamp(popScaleRaw, popScaleMin, popScaleMax);
const gdpScaleRaw = totalPop > 0 ? popScale * (scalePerCap / Math.max(1, modernPerCap)) : popScale;
const gdpScale = clamp(gdpScaleRaw, gdpScaleMin, gdpScaleMax);

const entries = [];
for (const [nationId, entry] of byId) {
  const popEst = Number.isFinite(entry.pop_est) && entry.pop_est > 0 ? entry.pop_est : fallbackPop;
  const gdpMd = Number.isFinite(entry.gdp_md) && entry.gdp_md > 0
    ? entry.gdp_md
    : (popEst * modernPerCap) / 1_000_000;
  const gdpAbs = gdpMd * 1_000_000;
  const gdpPerCap = popEst > 0 ? gdpAbs / popEst : modernPerCap;
  const wealthIndex = modernPerCap > 0 ? gdpPerCap / modernPerCap : 1;
  const perCapTarget = clamp(basePerCap * Math.pow(wealthIndex, alpha), minPerCap, maxPerCap);

  const popFinal = Math.max(10_000, popEst * popScale);
  const gdpFinal = Math.max(1_000_000, perCapTarget * popFinal);

  const popRaw = Math.round(popFinal / popScale);
  const gdpRaw = Math.round(gdpFinal / gdpScale);

  entries.push({
    nation_id: nationId,
    population: popRaw,
    gdp: gdpRaw
  });
}

entries.sort((a, b) => a.nation_id.localeCompare(b.nation_id));

const output = {
  version: 2,
  generated_at: new Date().toISOString(),
  params: {
    input: path.relative(process.cwd(), inputPath),
    target_pop: targetPop,
    base_per_cap: basePerCap,
    min_per_cap: minPerCap,
    max_per_cap: maxPerCap,
    alpha,
    scale_per_cap: scalePerCap,
    pop_scale: popScale,
    gdp_scale: gdpScale
  },
  entries
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (dryRun) {
  process.stdout.write(serialized);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, "utf8");
  console.log(`[world1492] wrote ${entries.length} entries to ${outputPath}`);
}
