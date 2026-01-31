import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getOpenTasks, getSelectedTask, useAppState } from "../state/appStore";
import { ApiError, advanceWeek, fetchPortrait, refreshScenario, type PortraitResponse } from "../lib/api";
import { getCourtierColor } from "../lib/courtierColors";
import HoverTooltip from "./HoverTooltip";

export default function CourtPanel() {
  const { state, dispatch } = useAppState();
  const court = state.scenario?.court ?? null;
  const baseUrl = import.meta.env.BASE_URL ?? "/";
  const assetBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const selectedTask = getSelectedTask(state);
  const openTasks = useMemo(() => getOpenTasks(state), [state.tasks, state.resolvedTaskIds]);
  const realmStats = state.scenario?.realmStats ?? null;
  const prevRealmStats = usePrevious(realmStats);
  const litCount = useMemo(() => (court ? court.council.filter((c) => c.lit).length : 0), [court]);
  const tasksByOwner = useMemo(() => groupTasksByOwner(openTasks), [openTasks]);
  const queuedTaskIds = useMemo(() => new Set(state.decisionQueue.map((entry) => entry.taskId)), [state.decisionQueue]);
  const queuedCount = state.decisionQueue.length;
  const openCount = openTasks.length;
  const totalCount = state.tasks.length;
  const resolvedCount = Math.max(0, totalCount - openCount);
  const currentTask = selectedTask ?? openTasks[0] ?? null;
  const currentIndex = currentTask ? openTasks.findIndex((task) => task.taskId === currentTask.taskId) : -1;
  const [endingWeek, setEndingWeek] = useState(false);
  const [endWeekNote, setEndWeekNote] = useState<string | null>(null);
  const [confirmEndWeek, setConfirmEndWeek] = useState(false);
  const [rejectionNotice, setRejectionNotice] = useState<string | null>(null);
  const [portraits, setPortraits] = useState<Record<string, PortraitResponse | null>>({});
  const [portraitQueueTick, setPortraitQueueTick] = useState(0);
  const pendingPortraits = useRef(new Set<string>());
  const portraitRetries = useRef(new Map<string, number>());
  const portraitRetryTimers = useRef(new Map<string, number>());
  const portraitQueueActive = useRef(false);
  const portraitsRef = useRef(portraits);

  useEffect(() => {
    portraitsRef.current = portraits;
  }, [portraits]);

  const clearPortraitRetry = (characterId: string) => {
    const existing = portraitRetryTimers.current.get(characterId);
    if (existing) {
      window.clearTimeout(existing);
      portraitRetryTimers.current.delete(characterId);
    }
    portraitRetries.current.delete(characterId);
  };

  const schedulePortraitRetry = (characterId: string) => {
    const retries = (portraitRetries.current.get(characterId) ?? 0) + 1;
    portraitRetries.current.set(characterId, retries);
    setPortraits((prev) => ({ ...prev, [characterId]: null }));
    if (retries <= 2) {
      const existing = portraitRetryTimers.current.get(characterId);
      if (existing) window.clearTimeout(existing);
      const delay = retries * 2500;
      const timer = window.setTimeout(() => {
        setPortraits((prev) => {
          if (!(characterId in prev)) return prev;
          const next = { ...prev };
          delete next[characterId];
          return next;
        });
        setPortraitQueueTick((prev) => prev + 1);
      }, delay);
      portraitRetryTimers.current.set(characterId, timer);
    }
  };

  const shouldRetryPortrait = (error: ApiError | null): boolean => {
    if (!error) return true;
    if (error.status !== 404) return true;
    const terminalCodes = new Set(["portrait_generation_unavailable", "character_not_found"]);
    if (error.code && terminalCodes.has(error.code)) return false;
    return true;
  };

  const portraitTargets = useMemo(() => {
    if (!court) return [];
    const ids = new Set<string>();
    if (court.ruler.characterId) ids.add(court.ruler.characterId);
    for (const courtier of court.council) {
      if (!isPortraitEligible(courtier.characterId)) continue;
      ids.add(courtier.characterId);
    }
    return Array.from(ids);
  }, [court]);

  useEffect(() => {
    if (!court || portraitTargets.length === 0) return;
    if (portraitQueueActive.current) return;
    portraitQueueActive.current = true;
    let cancelled = false;

    const runQueue = async () => {
      for (const characterId of portraitTargets) {
        if (cancelled) break;
        if (portraitsRef.current[characterId] !== undefined) continue;
        if (pendingPortraits.current.has(characterId)) continue;
        pendingPortraits.current.add(characterId);
        try {
          const portrait = await fetchPortrait(characterId, { gameId: state.scenario?.gameId });
          if (cancelled) return;
          setPortraits((prev) => ({ ...prev, [characterId]: portrait }));
          clearPortraitRetry(characterId);
        } catch (err) {
          if (cancelled) return;
          const apiError = err instanceof ApiError ? err : null;
          const retryable = shouldRetryPortrait(apiError);
          if (apiError?.status === 404 && !retryable) {
            // eslint-disable-next-line no-console
            console.warn(`Portrait unavailable for ${characterId}: ${apiError.message}`);
            clearPortraitRetry(characterId);
            setPortraits((prev) => ({ ...prev, [characterId]: null }));
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              `Portrait fetch ${apiError?.status === 404 ? "unavailable" : "failed"} for ${characterId}`,
              apiError ?? err
            );
            schedulePortraitRetry(characterId);
          }
        } finally {
          pendingPortraits.current.delete(characterId);
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      portraitQueueActive.current = false;
    };

    void runQueue();
    return () => {
      cancelled = true;
      portraitQueueActive.current = false;
    };
  }, [court, portraitTargets, portraitQueueTick]);

  useEffect(() => {
    return () => {
      for (const timer of portraitRetryTimers.current.values()) {
        window.clearTimeout(timer);
      }
      portraitRetryTimers.current.clear();
    };
  }, []);

  async function handleEndWeek(autoDecideOpen: boolean) {
    if (endingWeek) return;
    setEndingWeek(true);
    setEndWeekNote(null);
    try {
      const result = await advanceWeek({ auto_decide_open: autoDecideOpen, gameId: state.scenario?.gameId });
      dispatch({ type: "clear_decision_queue" });
      const updatedScenario = await refreshScenario(state.scenario?.gameId);
      dispatch({ type: "scenario_loaded", payload: updatedScenario });
      const autoNote = result.auto_decided_tasks && result.auto_decided_tasks > 0
        ? ` Auto-resolved ${result.auto_decided_tasks} tractanda.`
        : "";
      setEndWeekNote(`Week advanced to ${result.turn_index}.${autoNote}`);
      const rejectedMessage = buildRejectionMessage(result.rejected_actions ?? []);
      setRejectionNotice(rejectedMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setEndWeekNote(message);
      setRejectionNotice(null);
    } finally {
      setEndingWeek(false);
      setConfirmEndWeek(false);
    }
  }

  function requestEndWeek() {
    if (endingWeek) return;
    if (openCount > 0) {
      setConfirmEndWeek(true);
      return;
    }
    void handleEndWeek(false);
  }

  function cycleTask(direction: "next" | "prev") {
    if (openTasks.length === 0 || currentIndex === -1) return;
    const delta = direction === "next" ? 1 : -1;
    const nextIndex = (currentIndex + delta + openTasks.length) % openTasks.length;
    const nextTask = openTasks[nextIndex];
    if (nextTask) dispatch({ type: "select_task", payload: nextTask.taskId });
  }

  return (
    <>
      <div className="header">
        <div>
          <h2>The Court</h2>
          <div className="small">Week {state.scenario?.turnIndex ?? 0} · Tasks: {litCount}</div>
        </div>
        <div className="small">{resolvedCount}/{totalCount} resolved</div>
      </div>
      <div className="content court-content">
        <div
          className="court-backdrop"
          style={{ backgroundImage: `url(${assetBase}assets/court-backdrop.svg)` }}
          aria-hidden="true"
        />
        <div className="court-body">
          {state.error && <div className="card">Scenario load error: {state.error}</div>}
          {!court && !state.error && <div className="card">Loading scenario...</div>}
          {court && (
            <>
              <div className="grid2">
                <div className="card">
                  <div className="row">
                    <div>
                    <div className="small">Ruler</div>
                    <div className="section-title">{court.ruler.title} {court.ruler.name}</div>
                    <div className="small">Health: {court.ruler.health} | Legitimacy: {court.ruler.legitimacy}</div>
                    <div style={{ marginTop: 10 }} className="small">
                      Talents: Diplomacy {court.ruler.talents.diplomacy}, Finance {court.ruler.talents.finance}, War {court.ruler.talents.war}, Admin {court.ruler.talents.admin}
                    </div>
                  </div>
                  <div className="portrait" aria-label="Ruler portrait">
                    {court.ruler.characterId && portraits[court.ruler.characterId]?.data_url ? (
                      <img
                        src={portraits[court.ruler.characterId]?.data_url}
                        alt={`${court.ruler.title} ${court.ruler.name} portrait`}
                      />
                    ) : (
                      <span className="portrait-fallback">Portrait</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="small">Realm</div>
                <div style={{ marginTop: 6 }} className="small">{court.realm.name}</div>
                <div className="small">
                  GDP: {court.realm.gdp}
                  {renderDelta(realmStats?.gdp, prevRealmStats?.gdp, formatCompact)}
                </div>
                <div className="small">
                  Treasury: {court.realm.treasury}
                  {renderDelta(realmStats?.treasury, prevRealmStats?.treasury, formatCompact)}
                </div>
                <div className="small">
                  Tax rate: {court.realm.taxRate}
                  {renderDeltaPercent(realmStats?.taxRate, prevRealmStats?.taxRate)}
                </div>
                <div className="small">
                  Stability: {court.realm.stability}
                  {renderDelta(realmStats?.stability, prevRealmStats?.stability, formatNumber)}
                </div>
                <div className="small">
                  Population: {court.realm.population}
                  {renderDelta(realmStats?.population, prevRealmStats?.population, formatCompact)}
                </div>
                <div className="small">
                  Literacy: {court.realm.literacy}
                  {renderDeltaPercent(realmStats?.literacy, prevRealmStats?.literacy)}
                </div>
                <div className="small">Culture: {court.realm.culture}</div>
                <div className="small">Religion: {court.realm.religion}</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }} className="card" data-tutorial-id="courtroom">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="row" style={{ alignItems: "center", gap: 8 }}>
                  <div className="section-title">Courtroom</div>
                  <HoverTooltip content="Click a portrait to add or remove a courtier from chat.\nClick a petition seal to open that petition.">
                    <span className="hint" tabIndex={0} role="img" aria-label="Courtroom help">
                      i
                    </span>
                  </HoverTooltip>
                </div>
                <div className="small">Use petition seals or tractanda arrows to switch tasks.</div>
              </div>

              <div className="courtroom" style={{ marginTop: 12 }}>
                <div className="courtier-grid">
                  {court.council.map((c) => {
                    const ownerTasks = tasksByOwner[c.characterId] ?? [];
                    const primaryTask = ownerTasks.length ? pickPrimaryTask(ownerTasks) : null;
                    const extraCount = ownerTasks.length > 1 ? ` (+${ownerTasks.length - 1} more)` : "";
                    const isSelected = state.selectedCourtiers.includes(c.characterId);
                    const isActivePetition = primaryTask?.taskId === selectedTask?.taskId;
                    const tooltip = buildCourtierTooltip(c, primaryTask, extraCount, isSelected, isActivePetition);
                    const initials = getInitials(c.name);
                    const isVacant = c.name.toLowerCase() === "vacant";
                    const portrait = isPortraitEligible(c.characterId) ? portraits[c.characterId] : null;
                    const courtierColor = getCourtierColor(c.characterId);
                    return (
                      <div key={c.characterId} className="courtier-spot">
                        <HoverTooltip content={tooltip} className="courtier-tooltip-anchor">
                          <button
                            className={`courtier-portrait ${isSelected ? "selected" : ""} ${isVacant ? "vacant" : ""}`}
                            type="button"
                            onClick={() => dispatch({ type: "toggle_courtier", payload: c.characterId })}
                            aria-pressed={isSelected}
                            data-urgency={primaryTask?.urgency}
                            data-active={isActivePetition ? "true" : undefined}
                            disabled={isVacant}
                            style={{ "--courtier-color": courtierColor } as CSSProperties}
                          >
                            {portrait?.data_url ? (
                              <img src={portrait.data_url} alt={`${c.name} portrait`} />
                            ) : (
                              <span className="courtier-initials">{initials}</span>
                            )}
                          </button>
                        </HoverTooltip>
                        {primaryTask && (
                          <HoverTooltip content={`Open petition:\n${summarizeTask(primaryTask.prompt)}${extraCount}`}>
                            <button
                              className={`petition-seal urgency-${primaryTask.urgency} ${isActivePetition ? "active" : ""}`}
                              type="button"
                              onClick={() => dispatch({ type: "select_task", payload: primaryTask.taskId })}
                              aria-label="Open petition"
                            >
                              !
                            </button>
                          </HoverTooltip>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }} className="card tractanda-card" data-tutorial-id="tractanda">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="section-title">Tractanda</div>
                <div className="small">{openCount} open / {totalCount} total</div>
              </div>
              {openCount === 0 && <div className="small" style={{ marginTop: 10 }}>All tractanda resolved.</div>}
              {openCount > 0 && currentTask && (
                <>
                  <div className="tractanda-carousel" style={{ marginTop: 10 }}>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => cycleTask("prev")}
                      aria-label="Previous tractandum"
                    >
                      ◀
                    </button>
                    <button
                      className={`tractanda-item ${selectedTask?.taskId === currentTask.taskId ? "selected" : ""}`}
                      type="button"
                      onClick={() => dispatch({ type: "select_task", payload: currentTask.taskId })}
                      aria-pressed={selectedTask?.taskId === currentTask.taskId}
                    >
                      <div className="tractanda-item-body">
                        <div className="section-title">{buildOwnerLabel(state, currentTask)}</div>
                        <div className="petition-preview">{summarizeTask(currentTask.prompt)}</div>
                      </div>
                      <div className="tractanda-item-meta">
                        <span className={`badge urgency-${currentTask.urgency}`}>{currentTask.urgency}</span>
                        {queuedTaskIds.has(currentTask.taskId) && <span className="badge active">Queued</span>}
                        <span className="small">{currentIndex + 1}/{openCount}</span>
                      </div>
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => cycleTask("next")}
                      aria-label="Next tractandum"
                    >
                      ▶
                    </button>
                  </div>
                  <div className="tractanda-list" style={{ marginTop: 10 }}>
                    {openTasks.map((task) => {
                      const isSelected = selectedTask?.taskId === task.taskId;
                      return (
                        <button
                          key={task.taskId}
                          className={`tractanda-pill ${isSelected ? "selected" : ""}`}
                          type="button"
                          onClick={() => dispatch({ type: "select_task", payload: task.taskId })}
                          aria-pressed={isSelected}
                          title={task.prompt}
                        >
                          <span className="petition-preview">{summarizeTask(task.prompt)}</span>
                          <span className={`badge urgency-${task.urgency}`}>{task.urgency}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              </div>

            </>
          )}
        </div>
      </div>
      <div className="court-actions">
        {rejectionNotice && (
          <div className="card decision-toast action-toast" role="status" aria-live="polite">
            <div>
              <div className="section-title">Action rejected</div>
              <div className="small">{rejectionNotice}</div>
            </div>
            <button className="btn ghost small" type="button" onClick={() => setRejectionNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {confirmEndWeek && (
          <div className="card confirm-card">
            <div className="section-title">End the week early?</div>
            <div className="small">There are {openCount} open tractanda. We will auto-resolve them.</div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn ghost" type="button" onClick={() => setConfirmEndWeek(false)} disabled={endingWeek}>
                Cancel
              </button>
              <button className="btn primary" type="button" onClick={() => handleEndWeek(true)} disabled={endingWeek}>
                End anyway
              </button>
            </div>
          </div>
        )}
        {endWeekNote && <div className="small">{endWeekNote}</div>}
        <button
          className="btn primary end-week-btn"
          type="button"
          onClick={requestEndWeek}
          disabled={endingWeek}
          aria-label="End the week"
          data-tutorial-id="end-week"
        >
          {endingWeek ? "Ending..." : "End week"}
          {queuedCount > 0 && <span className="badge active">{queuedCount} queued</span>}
        </button>
      </div>
    </>
  );
}

function groupTasksByOwner(tasks: Array<{ ownerCharacterId?: string } & { taskId: string; prompt: string; urgency: "low" | "medium" | "high" }>) {
  return tasks.reduce<Record<string, Array<{ taskId: string; prompt: string; urgency: "low" | "medium" | "high" }>>>((acc, task) => {
    if (!task.ownerCharacterId) return acc;
    if (!acc[task.ownerCharacterId]) acc[task.ownerCharacterId] = [];
    acc[task.ownerCharacterId].push(task);
    return acc;
  }, {});
}

function pickPrimaryTask(tasks: Array<{ taskId: string; prompt: string; urgency: "low" | "medium" | "high" }>) {
  const urgencyRank = { low: 0, medium: 1, high: 2 };
  return tasks.reduce((best, task) => (urgencyRank[task.urgency] > urgencyRank[best.urgency] ? task : best), tasks[0]);
}

function summarizeTask(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}...`;
}

function buildRejectionMessage(rejected: Array<{ type: string; reason: string }>): string | null {
  if (!rejected.length) return null;
  const reasons = new Set(rejected.map((entry) => entry.reason));
  if (reasons.has("target_is_player")) {
    return "Trajectory modifiers cannot target the player nation. Those actions were skipped.";
  }
  return `Some actions were rejected (${rejected.length}).`;
}

function isPortraitEligible(characterId?: string): boolean {
  if (!characterId) return false;
  if (characterId.startsWith("vacant-")) return false;
  return true;
}

function buildOwnerLabel(state: { scenario: { characterIndex: Record<string, { name: string; title?: string }> } | null }, task: { ownerCharacterId?: string }) {
  const owner = task.ownerCharacterId ? state.scenario?.characterIndex?.[task.ownerCharacterId] : null;
  if (!owner) return "Court";
  return owner.title ? `${owner.title} ${owner.name}` : owner.name;
}

function usePrevious<T>(value: T | null): T | null {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (value) ref.current = value;
  }, [value]);
  return ref.current;
}

function renderDelta(current: number | undefined, previous: number | undefined, formatter: (value: number) => string) {
  if (current === undefined || previous === undefined) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.0001) return <span className="delta neutral">•</span>;
  const sign = diff > 0 ? "+" : "";
  return <span className={`delta ${diff > 0 ? "up" : "down"}`}>{sign}{formatter(diff)}</span>;
}

function renderDeltaPercent(current: number | undefined, previous: number | undefined) {
  if (current === undefined || previous === undefined) return null;
  const diff = (current - previous) * 100;
  if (Math.abs(diff) < 0.01) return <span className="delta neutral">•</span>;
  const sign = diff > 0 ? "+" : "";
  return <span className={`delta ${diff > 0 ? "up" : "down"}`}>{sign}{diff.toFixed(1)}%</span>;
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

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "--";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function buildCourtierTooltip(
  courtier: { name: string; office: string; stats: string },
  primaryTask: { prompt: string; urgency: "low" | "medium" | "high" } | null,
  extraCount: string,
  isSelected: boolean,
  isActivePetition: boolean
) {
  const lines = [`${courtier.name} - ${courtier.office}`, `Stats: ${courtier.stats}`];
  if (primaryTask) {
    lines.push(`Petition: ${summarizeTask(primaryTask.prompt)}${extraCount}`);
    lines.push(`Urgency: ${primaryTask.urgency}`);
    if (isActivePetition) lines.push("Petition is active in chat.");
  } else {
    lines.push("No petition assigned.");
  }
  lines.push(isSelected ? "In chat (click to remove)." : "Click to add to chat.");
  return lines.join("\n");
}
