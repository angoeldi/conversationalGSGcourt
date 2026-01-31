const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const geoPath = path.resolve(root, "apps/web/public/data/geo/ne_110m_admin_0_countries.geojson");
const outPath = path.resolve(root, "apps/web/public/data/geo/scenarios/1492/admin0.geojson");
const scenarioPath = path.resolve(root, "apps/server/data/scenarios/default.england_1492.json");
const catalogPath = path.resolve(root, "apps/server/data/country_catalog.json");
const mappingPath = path.resolve(root, "scripts/data/1492-polity-map.json");
const splitsPath = path.resolve(root, "scripts/data/1492-split-bboxes.json");

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadSplits() {
  try {
    return loadJson(splitsPath);
  } catch {
    return { splits: [] };
  }
}

function computeBBox(geom) {
  const coords = geom.coordinates;
  const polys = geom.type === "Polygon" ? [coords] : coords;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const point of ring) {
        const x = point[0];
        const y = point[1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

function moveNorthernIreland(features) {
  const uk = features.find((feat) => feat.properties?.ADMIN === "United Kingdom");
  const ireland = features.find((feat) => feat.properties?.ADMIN === "Ireland");
  if (!uk || !ireland) return;
  if (!uk.geometry || uk.geometry.type !== "MultiPolygon") return;

  const coords = uk.geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return;

  let smallestIndex = 0;
  let smallest = Infinity;
  coords.forEach((poly, index) => {
    const len = poly?.[0]?.length ?? 0;
    if (len > 0 && len < smallest) {
      smallest = len;
      smallestIndex = index;
    }
  });

  const niPoly = coords.splice(smallestIndex, 1)[0];
  if (!niPoly) return;

  if (ireland.geometry.type === "Polygon") {
    ireland.geometry = {
      type: "MultiPolygon",
      coordinates: [ireland.geometry.coordinates, niPoly]
    };
  } else if (ireland.geometry.type === "MultiPolygon") {
    ireland.geometry.coordinates.push(niPoly);
  }

  if (uk.bbox) uk.bbox = computeBBox(uk.geometry);
  if (ireland.bbox) ireland.bbox = computeBBox(ireland.geometry);
}

function buildMappings(polities) {
  const map = new Map();
  for (const entry of polities) {
    const polity = entry.polity;
    const nation = entry.nation;
    for (const member of entry.members ?? []) {
      const key = normalizeKey(member);
      if (!key) continue;
      map.set(key, { polity, nation });
    }
  }
  return map;
}

function defaultPolity(props) {
  const admin = props.ADMIN || props.NAME || "Unknown";
  const continent = props.CONTINENT || "";
  const subregion = props.SUBREGION || props.REGION_UN || "";
  const regionLabel = subregion || continent;

  if (continent === "Americas") return `${regionLabel} Polities`;
  if (continent === "Africa") return `${regionLabel} Kingdoms`;
  if (continent === "Oceania") return `${regionLabel} Polities`;
  if (continent === "Asia") return `${regionLabel} States`;
  return admin;
}

function buildLookup(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = normalizeKey(entry.name);
    if (key && !map.has(key)) map.set(key, entry.nation_id);
    for (const alias of entry.map_aliases ?? []) {
      const aliasKey = normalizeKey(alias);
      if (aliasKey && !map.has(aliasKey)) map.set(aliasKey, entry.nation_id);
    }
  }
  return map;
}

function buildScenarioNationLookup(scenario) {
  const map = new Map();
  for (const nation of scenario.nations ?? []) {
    const key = normalizeKey(nation.name);
    if (key && !map.has(key)) map.set(key, nation.nation_id);
  }
  return map;
}

function resolveNationId(nationName, scenarioLookup, catalogLookup) {
  const key = normalizeKey(nationName);
  return scenarioLookup.get(key) ?? catalogLookup.get(key) ?? null;
}

function main() {
  const geo = loadJson(geoPath);
  const scenario = loadJson(scenarioPath);
  const catalog = loadJson(catalogPath);
  const mappingData = loadJson(mappingPath);
  const splitData = loadSplits();

  const scenarioLookup = buildScenarioNationLookup(scenario);
  const catalogLookup = buildLookup(catalog.entries ?? []);
  const polityMap = buildMappings(mappingData.polities ?? []);

  const features = geo.features ?? [];
  moveNorthernIreland(features);
  const splitMap = buildSplitMap(splitData.splits ?? []);

  const overlays = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const admin = props.ADMIN || props.NAME || "Unknown";
    const key = normalizeKey(admin);
    const mapped = polityMap.get(key);

    const polity = mapped?.polity ?? defaultPolity(props);
    const nationName = mapped?.nation ?? admin;
    const nationId = resolveNationId(nationName, scenarioLookup, catalogLookup);

    props.ADMIN_1492 = polity;
    props.ADMIN_MODERN = admin;
    props.NATION_NAME_1492 = nationName;
    if (nationId) props.nation_id = nationId;
    feature.properties = props;

    const splits = splitMap.get(admin) ?? [];
    if (splits.length > 0) {
      const clipped = buildSplitOverlays(feature, splits, scenarioLookup, catalogLookup);
      overlays.push(...clipped);
    }
  }

  if (overlays.length > 0) {
    geo.features = [...features, ...overlays];
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(geo));

  const unmapped = new Set();
  for (const feature of features) {
    const props = feature.properties ?? {};
    if (!props.nation_id) {
      const admin = props.ADMIN || "Unknown";
      unmapped.add(admin);
    }
  }
  if (unmapped.size > 0) {
    console.warn(`Unmapped nation_id for ${unmapped.size} features`);
  }
}

main();

function buildSplitMap(splits) {
  const map = new Map();
  for (const split of splits) {
    if (!split?.admin || !split?.bbox) continue;
    const list = map.get(split.admin) ?? [];
    list.push(split);
    map.set(split.admin, list);
  }
  return map;
}

function buildSplitOverlays(feature, splits, scenarioLookup, catalogLookup) {
  const props = feature.properties ?? {};
  const admin = props.ADMIN || props.NAME || "Unknown";
  const overlays = [];
  for (const split of splits) {
    const bbox = split.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4) continue;
    const clipped = clipFeatureToBBox(feature, bbox);
    if (!clipped) continue;
    const polity = split.polity ?? props.ADMIN_1492 ?? admin;
    const nationName = split.nation ?? props.NATION_NAME_1492 ?? admin;
    const nationId = resolveNationId(nationName, scenarioLookup, catalogLookup);
    const overlayProps = {
      ...props,
      ADMIN_1492: polity,
      NATION_NAME_1492: nationName,
      ADMIN_MODERN: admin
    };
    if (nationId) overlayProps.nation_id = nationId;
    overlays.push({
      type: "Feature",
      properties: overlayProps,
      geometry: clipped
    });
  }
  return overlays;
}

function clipFeatureToBBox(feature, bbox) {
  const geom = feature.geometry;
  if (!geom) return null;
  const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  const [minX, minY, maxX, maxY] = bbox;
  const out = [];
  for (const poly of polygons) {
    const ring = poly?.[0];
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const clipped = clipRingToBBox(ring, minX, minY, maxX, maxY);
    if (clipped.length < 3) continue;
    out.push([closeRing(clipped)]);
  }
  if (out.length === 0) return null;
  return {
    type: "MultiPolygon",
    coordinates: out
  };
}

function clipRingToBBox(points, minX, minY, maxX, maxY) {
  let output = points.slice();
  output = clipEdge(output, (p) => p[0] >= minX, (p1, p2) => intersectVertical(p1, p2, minX));
  output = clipEdge(output, (p) => p[0] <= maxX, (p1, p2) => intersectVertical(p1, p2, maxX));
  output = clipEdge(output, (p) => p[1] >= minY, (p1, p2) => intersectHorizontal(p1, p2, minY));
  output = clipEdge(output, (p) => p[1] <= maxY, (p1, p2) => intersectHorizontal(p1, p2, maxY));
  return output;
}

function clipEdge(points, insideFn, intersectFn) {
  if (points.length === 0) return [];
  const output = [];
  let prev = points[points.length - 1];
  let prevInside = insideFn(prev);
  for (const curr of points) {
    const currInside = insideFn(curr);
    if (currInside) {
      if (!prevInside) output.push(intersectFn(prev, curr));
      output.push(curr);
    } else if (prevInside) {
      output.push(intersectFn(prev, curr));
    }
    prev = curr;
    prevInside = currInside;
  }
  return output;
}

function intersectVertical(p1, p2, x) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2) return [x, y1];
  const t = (x - x1) / (x2 - x1);
  return [x, y1 + t * (y2 - y1)];
}

function intersectHorizontal(p1, p2, y) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (y1 === y2) return [x1, y];
  const t = (y - y1) / (y2 - y1);
  return [x1 + t * (x2 - x1), y];
}

function closeRing(points) {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}
