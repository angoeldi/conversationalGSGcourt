import { useEffect, useMemo, useState } from "react";
import { fetchActionLog, type ActionEffectLogEntry } from "../lib/api";
import { useAppState } from "../state/appStore";

const ACTION_LOG_PAGE_SIZE = 50;

export default function ActionLogDock() {
  const { state } = useAppState();
  const [actionLogEntries, setActionLogEntries] = useState<ActionEffectLogEntry[]>([]);
  const [actionLogOffset, setActionLogOffset] = useState(0);
  const [actionLogHasMore, setActionLogHasMore] = useState(true);
  const [actionLogLoading, setActionLogLoading] = useState(false);

  const nationNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const nation of state.scenario?.nations ?? []) {
      map.set(nation.nationId, nation.name);
    }
    return map;
  }, [state.scenario?.nations]);

  const actionLog = useMemo(
    () => buildActionLogSections(actionLogEntries, nationNameMap),
    [actionLogEntries, nationNameMap]
  );

  useEffect(() => {
    if (!state.scenario) return;
    void refreshActionLogState(true);
  }, [state.scenario?.turnIndex, state.scenario?.gameId]);

  async function refreshActionLogState(reset = false) {
    if (actionLogLoading) return;
    setActionLogLoading(true);
    try {
      const offset = reset ? 0 : actionLogOffset;
      const entries = await fetchActionLog(ACTION_LOG_PAGE_SIZE, offset, state.scenario?.gameId);
      setActionLogEntries((prev) => (reset ? entries : mergeActionLogEntries(prev, entries)));
      setActionLogOffset((prev) => (reset ? entries.length : prev + entries.length));
      setActionLogHasMore(entries.length === ACTION_LOG_PAGE_SIZE);
    } catch {
      // Keep existing log on failure.
    } finally {
      setActionLogLoading(false);
    }
  }

  function clearActionLog() {
    setActionLogEntries([]);
    setActionLogOffset(0);
    setActionLogHasMore(true);
  }

  if (!state.scenario) return null;

  return (
    <div className="action-log-dock" data-tutorial-id="action-log">
      <button className="action-log-trigger" type="button" aria-label="Action log">
        A
      </button>
      <div className="action-log-panel">
        <div className="row action-log-header">
          <div className="section-title">Action Log</div>
          <div className="row action-log-actions">
            <button
              className="btn ghost small"
              type="button"
              onClick={clearActionLog}
              disabled={actionLogEntries.length === 0}
            >
              Clear
            </button>
            {actionLogHasMore && (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => refreshActionLogState(false)}
                disabled={actionLogLoading}
              >
                {actionLogLoading ? "Loading..." : actionLogEntries.length === 0 ? "Load log" : "Load more"}
              </button>
            )}
          </div>
        </div>
        <div className="action-log-list">
          {actionLogEntries.length === 0 && <div className="small">No recent actions.</div>}
          {actionLog.map((entry) => (
            <div key={entry.id} className="action-log-entry">
              <div className="action-log-meta">
                <span>{entry.timestamp}</span>
                <span>{entry.title}</span>
              </div>
              {entry.lines.map((line, idx) => (
                <div key={idx} className="small">{line}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ActionLogSection = {
  id: string;
  title: string;
  timestamp: string;
  lines: string[];
};

function mergeActionLogEntries(existing: ActionEffectLogEntry[], incoming: ActionEffectLogEntry[]): ActionEffectLogEntry[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((entry) => entry.effect_id));
  const merged = [...existing];
  for (const entry of incoming) {
    if (seen.has(entry.effect_id)) continue;
    seen.add(entry.effect_id);
    merged.push(entry);
  }
  return merged;
}

function buildActionLogSections(entries: ActionEffectLogEntry[], nationNameMap: Map<string, string>): ActionLogSection[] {
  if (!entries.length) return [];
  const grouped = new Map<string, ActionEffectLogEntry[]>();
  for (const entry of entries) {
    const key = entry.turn_index === null ? "pending" : `turn-${entry.turn_index}`;
    const list = grouped.get(key) ?? [];
    list.push(entry);
    grouped.set(key, list);
  }

  const sections: ActionLogSection[] = [];
  for (const [key, list] of grouped.entries()) {
    const sorted = list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const first = sorted[0];
    const turnIndex = first.turn_index;
    const title = turnIndex === null ? "Pending actions" : `Week ${turnIndex}`;
    const timestamp = formatLogTimestamp(first.turn_date ?? first.created_at);
    const lines: string[] = [`Effects: ${sorted.length}`];
    const maxLines = 6;
    for (const entry of sorted.slice(0, maxLines)) {
      lines.push(formatEffectLine(entry, nationNameMap));
    }
    if (sorted.length > maxLines) lines.push(`... +${sorted.length - maxLines} more`);
    sections.push({ id: key, title, timestamp, lines });
  }

  return sections.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

function formatEffectLine(entry: ActionEffectLogEntry, nationNameMap: Map<string, string>): string {
  const delta = asRecord(entry.delta) ?? {};
  const audit = asRecord(entry.audit) ?? {};
  const actionLabel = humanizeLabel(entry.action_type || "action");
  switch (entry.effect_type) {
    case "action.rejected": {
      const reason = typeof delta.reason === "string" ? humanizeLabel(delta.reason) : "unknown";
      const actionType = typeof delta.type === "string" ? humanizeLabel(delta.type) : actionLabel;
      const targetId = typeof delta.target_nation_id === "string" ? delta.target_nation_id : null;
      const targetLabel = targetId ? resolveNationName(nationNameMap, targetId) : null;
      return `${actionType} rejected: ${reason}${targetLabel ? ` (${targetLabel})` : ""}`;
    }
    case "trajectory.modifier_added": {
      const modifier = asRecord(delta.modifier);
      if (!modifier) return "Trajectory modifier added.";
      const nationId = typeof modifier.nation_id === "string" ? modifier.nation_id : null;
      const metric = typeof modifier.metric === "string" ? modifier.metric : "metric";
      const deltaValue = coerceNumber(modifier.delta);
      const duration = coerceNumber(modifier.remaining_weeks);
      const note = typeof modifier.note === "string" ? modifier.note : null;
      const nationLabel = nationId ? resolveNationName(nationNameMap, nationId) : "Unknown nation";
      const metricLabel = formatTrajectoryMetricLabel(metric);
      const deltaLabel = deltaValue !== null ? formatTrajectoryDelta(metric, deltaValue) : "updated";
      const parts = [`Trajectory modifier (${nationLabel}): ${metricLabel} ${deltaLabel}`];
      if (duration !== null) parts.push(`for ${Math.round(duration)}w`);
      if (note) parts.push(`note: ${note}`);
      return parts.join(" ");
    }
    case "nation.weekly_finance": {
      const nationId = typeof delta.nation_id === "string" ? delta.nation_id : null;
      const revenue = coerceNumber(delta.revenue);
      const spending = coerceNumber(delta.spending);
      const balance = coerceNumber(delta.balance);
      const nationLabel = nationId ? resolveNationName(nationNameMap, nationId) : "Unknown nation";
      const details: string[] = [];
      if (revenue !== null) details.push(`revenue ${formatCompact(revenue)}`);
      if (spending !== null) details.push(`spending ${formatCompact(spending)}`);
      if (balance !== null) details.push(`balance ${formatSignedNumber(balance, formatCompact)}`);
      return details.length > 0
        ? `Weekly finance (${nationLabel}): ${details.join(", ")}`
        : `Weekly finance (${nationLabel})`;
    }
    case "nation.tax_rate": {
      const nationId = typeof delta.nation_id === "string" ? delta.nation_id : null;
      const from = coerceNumber(delta.from);
      const to = coerceNumber(delta.to);
      const nationLabel = nationId ? resolveNationName(nationNameMap, nationId) : "Unknown nation";
      if (from !== null && to !== null) {
        return `Tax rate (${nationLabel}): ${formatPercent(from)} -> ${formatPercent(to)}`;
      }
      if (to !== null) {
        return `Tax rate (${nationLabel}): set to ${formatPercent(to)}`;
      }
      return `Tax rate updated (${nationLabel})`;
    }
    case "nation.debt": {
      const nationId = typeof delta.nation_id === "string" ? delta.nation_id : null;
      const amount = coerceNumber(delta.amount);
      const rate = coerceNumber(delta.interest_rate_annual);
      const maturity = coerceNumber(delta.maturity_weeks);
      const nationLabel = nationId ? resolveNationName(nationNameMap, nationId) : "Unknown nation";
      const parts = [`Debt issued (${nationLabel})`];
      if (amount !== null) parts.push(`${formatSignedNumber(amount, formatCompact)}`);
      if (rate !== null) parts.push(`at ${formatPercent(rate)}`);
      if (maturity !== null) parts.push(`for ${Math.round(maturity)}w`);
      return parts.join(" ");
    }
    case "operation.created": {
      return formatOperationLine(delta.operation, audit, nationNameMap);
    }
    case "intrigue.spy_exposed": {
      const targetId = typeof delta.target_nation_id === "string" ? delta.target_nation_id : null;
      const targetLabel = targetId ? resolveNationName(nationNameMap, targetId) : "Unknown nation";
      const roll = coerceNumber(audit.roll);
      return `Spy exposed in ${targetLabel}${roll !== null ? ` (roll ${Math.round(roll)})` : ""}`;
    }
    case "intrigue.spy_resolved": {
      const targetId = typeof delta.target_nation_id === "string" ? delta.target_nation_id : null;
      const targetLabel = targetId ? resolveNationName(nationNameMap, targetId) : "Unknown nation";
      const objective = typeof delta.objective === "string" ? delta.objective : null;
      const success = delta.success === true ? "success" : delta.success === false ? "failure" : "resolved";
      return `Spy operation ${success} vs ${targetLabel}${objective ? ` (objective: ${objective})` : ""}`;
    }
    case "diplomacy.envoy_sent": {
      const targetId = typeof delta.target_nation_id === "string" ? delta.target_nation_id : null;
      const targetLabel = targetId ? resolveNationName(nationNameMap, targetId) : "Unknown nation";
      const relationDelta = coerceNumber(delta.relation_delta);
      const topic = typeof delta.topic === "string" ? delta.topic : null;
      const offer = typeof audit.offer === "string" ? audit.offer : null;
      const parts = [`Envoy sent to ${targetLabel}`];
      if (topic) parts.push(`on ${topic}`);
      if (relationDelta !== null) parts.push(`(relations ${formatSignedNumber(relationDelta, formatNumber)})`);
      if (offer) parts.push(`offer: ${offer}`);
      return parts.join(" ");
    }
    case "diplomacy.campaign_resolved": {
      const targetId = typeof delta.target_nation_id === "string" ? delta.target_nation_id : null;
      const targetLabel = targetId ? resolveNationName(nationNameMap, targetId) : "Unknown nation";
      const relationDelta = coerceNumber(delta.relation_delta);
      return `Diplomacy campaign resolved with ${targetLabel}${relationDelta !== null ? ` (relations ${formatSignedNumber(relationDelta, formatNumber)})` : ""}`;
    }
    case "military.mobilized": {
      const scope = typeof delta.scope === "string" ? delta.scope : "mobilization";
      return `Mobilization ordered (${scope})`;
    }
    case "nation.trajectory_drift": {
      const nationId = typeof delta.nation_id === "string" ? delta.nation_id : null;
      const nationLabel = nationId ? resolveNationName(nationNameMap, nationId) : "Unknown nation";
      const parts = buildTrajectoryParts(delta);
      return parts.length > 0
        ? `Trajectory drift (${nationLabel}): ${parts.join("; ")}`
        : `Trajectory drift (${nationLabel})`;
    }
    case "action.noop": {
      return `No modeled effect for ${actionLabel}`;
    }
    default: {
      const effectLabel = humanizeLabel(entry.effect_type);
      return `${actionLabel}: ${effectLabel}`;
    }
  }
}

function formatOperationLine(operation: unknown, audit: Record<string, unknown>, nationNameMap: Map<string, string>): string {
  const op = asRecord(operation);
  if (!op) return "Operation started.";
  const meta = asRecord(op.meta) ?? {};
  const type = typeof op.type === "string" ? op.type : "operation";
  const targetId = typeof op.target_nation_id === "string" ? op.target_nation_id : null;
  const targetLabel = targetId ? resolveNationName(nationNameMap, targetId) : "Unknown nation";
  const remainingWeeks = coerceNumber(op.remaining_weeks);
  const budgetWeekly = coerceNumber(op.budget_weekly);
  const spent = coerceNumber(audit.treasury_spent);

  const parts: string[] = [];
  if (type === "spy_operation") {
    parts.push(`Spy operation launched vs ${targetLabel}`);
    const objective = typeof meta.objective === "string" ? meta.objective : null;
    const risk = typeof meta.risk_tolerance === "string" ? meta.risk_tolerance : null;
    if (objective) parts.push(`objective: ${objective}`);
    if (risk) parts.push(`risk: ${risk}`);
  } else if (type === "diplomacy_campaign") {
    parts.push(`Diplomacy campaign launched vs ${targetLabel}`);
    const tone = typeof meta.message_tone === "string" ? meta.message_tone : null;
    if (tone) parts.push(`tone: ${tone}`);
  } else {
    parts.push(`${humanizeLabel(type)} operation started`);
  }

  const detail: string[] = [];
  if (remainingWeeks !== null) detail.push(`${Math.round(remainingWeeks)}w`);
  if (budgetWeekly !== null) detail.push(`${formatCompact(budgetWeekly)}/w`);
  if (detail.length > 0) parts.push(`(${detail.join(", ")})`);
  if (spent !== null) parts.push(`spent ${formatCompact(spent)}`);
  return parts.join(" ");
}

function resolveNationName(nationNameMap: Map<string, string>, nationId: string): string {
  return nationNameMap.get(nationId) ?? nationId;
}

function buildTrajectoryParts(delta: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const gdp = coerceNumber(delta.gdp_growth_decade);
  if (gdp !== null && gdp !== 0) parts.push(`GDP ${formatTrajectoryDelta("gdp_growth_decade", gdp)}`);
  const population = coerceNumber(delta.population_growth_decade);
  if (population !== null && population !== 0) parts.push(`Population ${formatTrajectoryDelta("population_growth_decade", population)}`);
  const stability = coerceNumber(delta.stability_drift_decade);
  if (stability !== null && stability !== 0) parts.push(`Stability ${formatTrajectoryDelta("stability_drift_decade", stability)}`);
  const literacy = coerceNumber(delta.literacy_growth_decade);
  if (literacy !== null && literacy !== 0) parts.push(`Literacy ${formatTrajectoryDelta("literacy_growth_decade", literacy)}`);
  return parts;
}

function formatTrajectoryMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    gdp_growth_decade: "GDP growth",
    population_growth_decade: "Population growth",
    stability_drift_decade: "Stability drift",
    literacy_growth_decade: "Literacy growth"
  };
  return labels[metric] ?? humanizeLabel(metric);
}

function formatTrajectoryDelta(metric: string, value: number): string {
  if (metric.includes("growth_decade")) {
    return `${formatSignedPercent(value, 1)}/decade`;
  }
  if (metric === "stability_drift_decade") {
    return formatSignedFixed(value, 1, "/decade");
  }
  return formatSignedFixed(value, 2);
}

function formatLogTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function humanizeLabel(value: string): string {
  return value.replace(/[_.]/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatNumber(value: number): string {
  return `${Math.round(value)}`;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${Math.round(value)}`;
}

function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedNumber(value: number, formatter: (value: number) => string): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatter(Math.abs(value))}`;
}

function formatSignedPercent(value: number, digits = 1): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value * 100).toFixed(digits)}%`;
}

function formatSignedFixed(value: number, digits: number, suffix = ""): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(digits)}${suffix}`;
}
