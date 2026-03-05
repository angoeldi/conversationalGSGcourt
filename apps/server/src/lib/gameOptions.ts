export type GameOptions = {
  limitFreeformDeltas: boolean;
  strictActionsOnly: boolean;
  petitionInflow: "low" | "normal" | "high";
  petitionCap: number;
  courtChurn: boolean;
  taskGeneration: {
    continuityBias: number;
    diversityBias: number;
    stressBias: number;
  };
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "limited", "conservative"]);
const INFLOW_VALUES = new Set(["low", "normal", "high"]);

function parseBoundedNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function readGameOptionHeaders(headers: Record<string, unknown>): GameOptions {
  const raw = headers["x-freeform-delta-limit"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const strictRaw = headers["x-strict-actions-only"];
  const strictValue = Array.isArray(strictRaw) ? strictRaw[0] : strictRaw;
  const strictNormalized = typeof strictValue === "string" ? strictValue.trim().toLowerCase() : "";
  const inflowRaw = headers["x-petition-inflow"];
  const inflowValue = Array.isArray(inflowRaw) ? inflowRaw[0] : inflowRaw;
  const inflowNormalized = typeof inflowValue === "string" ? inflowValue.trim().toLowerCase() : "";
  const churnRaw = headers["x-court-churn"];
  const churnValue = Array.isArray(churnRaw) ? churnRaw[0] : churnRaw;
  const churnNormalized = typeof churnValue === "string" ? churnValue.trim().toLowerCase() : "";
  const capRaw = headers["x-petition-cap"];
  const capValue = Array.isArray(capRaw) ? capRaw[0] : capRaw;
  const capParsed = typeof capValue === "string" ? Number.parseInt(capValue, 10) : Number(capValue);
  const petitionCap = Number.isFinite(capParsed) ? Math.max(2, Math.min(25, capParsed)) : 10;
  const continuityBias = parseBoundedNumber(headers["x-taskgen-continuity"], 0.5, 1.5, 1);
  const diversityBias = parseBoundedNumber(headers["x-taskgen-diversity"], 0.5, 1.5, 1);
  const stressBias = parseBoundedNumber(headers["x-taskgen-stress"], 0.5, 1.5, 1);

  return {
    limitFreeformDeltas: TRUE_VALUES.has(normalized),
    strictActionsOnly: TRUE_VALUES.has(strictNormalized),
    petitionInflow: INFLOW_VALUES.has(inflowNormalized) ? (inflowNormalized as "low" | "normal" | "high") : "normal",
    petitionCap,
    courtChurn: TRUE_VALUES.has(churnNormalized),
    taskGeneration: {
      continuityBias,
      diversityBias,
      stressBias
    }
  };
}
