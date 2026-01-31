import { createHash } from "node:crypto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GEO_REGION_NAMESPACE = "thecourt:geo-region";

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function geoRegionKeyToUuid(key: string): string {
  const normalized = key.trim().toLowerCase();
  const hash = createHash("sha256")
    .update(`${GEO_REGION_NAMESPACE}:${normalized}`)
    .digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // UUID v5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return formatUuid(bytes);
}

export function normalizeScenarioGeoRegions(raw: unknown): { scenario: unknown; changed: boolean } {
  if (!raw || typeof raw !== "object") return { scenario: raw, changed: false };
  const scenario = structuredClone(raw) as Record<string, any>;
  let changed = false;

  const provinceById = new Map<string, Record<string, any>>();
  const keyByProvinceId = new Map<string, string>();

  if (Array.isArray(scenario.province_snapshots)) {
    for (const province of scenario.province_snapshots) {
      if (!province || typeof province !== "object") continue;
      const currentId = province.geo_region_id;
      const existingKey = typeof province.geo_region_key === "string" ? province.geo_region_key : undefined;
      let key = existingKey;
      if (!key && typeof currentId === "string" && !isUuid(currentId)) {
        key = currentId;
        province.geo_region_key = key;
        changed = true;
      }
      if (typeof currentId === "string" && key) {
        const expectedId = geoRegionKeyToUuid(key);
        if (currentId !== expectedId) {
          province.geo_region_id = expectedId;
          changed = true;
        }
      }
      if (typeof province.geo_region_id === "string") {
        const id = province.geo_region_id;
        provinceById.set(id, province);
        if (key) keyByProvinceId.set(id, key);
      }
    }
  }

  if (Array.isArray(scenario.region_assignments)) {
    for (const assignment of scenario.region_assignments) {
      if (!assignment || typeof assignment !== "object") continue;
      const currentId = assignment.geo_region_id;
      const existingKey = typeof assignment.geo_region_key === "string" ? assignment.geo_region_key : undefined;
      let key = existingKey;
      if (!key) {
        if (typeof currentId === "string" && !isUuid(currentId)) {
          key = currentId;
        } else if (typeof currentId === "string") {
          key = keyByProvinceId.get(currentId);
        }
      }
      if (key && assignment.geo_region_key !== key) {
        assignment.geo_region_key = key;
        changed = true;
      }
      if (typeof currentId === "string" && key) {
        const expectedId = geoRegionKeyToUuid(key);
        if (currentId !== expectedId) {
          assignment.geo_region_id = expectedId;
          changed = true;
        }
      }
      if (typeof assignment.geo_region_id === "string" && key) {
        const province = provinceById.get(assignment.geo_region_id);
        if (province && !province.geo_region_key) {
          province.geo_region_key = key;
          changed = true;
        }
      }
    }
  }

  if (Array.isArray(scenario.nations)) {
    for (const nation of scenario.nations) {
      if (!nation || typeof nation !== "object") continue;
      const capital = nation.capital_geo_region_id;
      if (typeof capital === "string" && !isUuid(capital)) {
        nation.capital_geo_region_id = geoRegionKeyToUuid(capital);
        changed = true;
      }
    }
  }

  return { scenario, changed };
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
