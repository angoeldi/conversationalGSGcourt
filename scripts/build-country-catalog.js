const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const geoPath = path.resolve(__dirname, "../apps/web/public/data/geo/ne_110m_admin_0_countries.geojson");
const outPath = path.resolve(__dirname, "../apps/server/data/country_catalog.json");

if (!fs.existsSync(geoPath)) {
  throw new Error(`GeoJSON not found at ${geoPath}. Run scripts/fetch-geo-pack.sh first.`);
}

const raw = fs.readFileSync(geoPath, "utf8");
const geo = JSON.parse(raw);

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashToUuid(input) {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5"; // version 5
  const variant = parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

function pickTag(props, name) {
  const iso = String(props.ISO_A3 || props.ADM0_A3 || props.SOV_A3 || "").trim();
  if (iso && iso !== "-99") return iso;
  return normalizeName(name).slice(0, 3).toUpperCase() || "UNK";
}

function pickTrajectory(props) {
  const income = String(props.INCOME_GRP || "").trim();
  const tier = Number.parseInt(income.slice(0, 1), 10);
  switch (tier) {
    case 1:
      return { gdp_growth_decade: 0.08, population_growth_decade: 0.04, stability_drift_decade: 0.2, literacy_growth_decade: 0.02 };
    case 2:
      return { gdp_growth_decade: 0.1, population_growth_decade: 0.06, stability_drift_decade: 0.1, literacy_growth_decade: 0.03 };
    case 3:
      return { gdp_growth_decade: 0.12, population_growth_decade: 0.08, stability_drift_decade: 0.0, literacy_growth_decade: 0.04 };
    case 4:
      return { gdp_growth_decade: 0.15, population_growth_decade: 0.1, stability_drift_decade: -0.1, literacy_growth_decade: 0.05 };
    case 5:
      return { gdp_growth_decade: 0.18, population_growth_decade: 0.12, stability_drift_decade: -0.2, literacy_growth_decade: 0.06 };
    default:
      return { gdp_growth_decade: 0.1, population_growth_decade: 0.07, stability_drift_decade: 0.0, literacy_growth_decade: 0.03 };
  }
}

function buildSummary(props, name) {
  const formal = String(props.FORMAL_EN || props.NAME_LONG || "").trim();
  const region = String(props.SUBREGION || props.REGION_UN || props.CONTINENT || "").trim();
  let summary = region ? `${name} is a sovereign state in ${region}.` : `${name} is a sovereign state.`;
  if (formal && formal !== name) summary += ` Formal name: ${formal}.`;
  const continent = String(props.CONTINENT || "").trim();
  if (continent && !summary.includes(continent) && continent !== region) {
    summary += ` Continent: ${continent}.`;
  }
  return summary;
}

const entries = [];
const seen = new Set();

for (const feature of geo.features || []) {
  const props = feature.properties || {};
  const name = String(props.ADMIN || props.NAME || props.BRK_NAME || "").trim();
  if (!name) continue;

  const iso = String(props.ISO_A3 || props.ADM0_A3 || props.SOV_A3 || "").trim();
  const key = iso && iso !== "-99" ? iso : normalizeName(name);
  if (seen.has(key)) continue;
  seen.add(key);

  const nation_id = hashToUuid(`thecourt-country:${key}`);
  const tag = pickTag(props, name);

  const aliasCandidates = [
    props.ADMIN,
    props.NAME,
    props.NAME_LONG,
    props.FORMAL_EN,
    props.BRK_NAME,
    props.SOVEREIGNT,
    props.ABBREV,
  ];
  const map_aliases = Array.from(
    new Set(
      aliasCandidates
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => String(value).trim())
    )
  );

  const summary = buildSummary(props, name);
  const trajectory = pickTrajectory(props);

  entries.push({
    nation_id,
    name,
    tag,
    map_aliases,
    summary,
    trajectory,
    population_est: Number(props.POP_EST || 0),
    gdp_md_est: Number(props.GDP_MD || 0),
    continent: props.CONTINENT ?? null,
    subregion: props.SUBREGION ?? null,
    economy: props.ECONOMY ?? null,
    income_group: props.INCOME_GRP ?? null,
  });
}

const output = {
  version: "ne_110m_admin_0_countries",
  generated_at: new Date().toISOString(),
  entries,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`Wrote ${entries.length} country entries to ${outPath}`);
