import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { buildTaskContext, queueDecision, requestCourtChat, type ChatMessage, type CourtierProfile, type TaskViewModel } from "../lib/api";
import { getOpenTasks, getSelectedTask, useAppState, type Stage } from "../state/appStore";
import { getCourtierColor } from "../lib/courtierColors";
import { renderMarkdown } from "../lib/markdown";
import HoverTooltip from "./HoverTooltip";

const STAGE_ORDER: Stage[] = ["discussion", "no_objection", "final"];

const STAGE_META: Record<Stage, { label: string; sendLabel: string; placeholder: string; help: string }> = {
  discussion: {
    label: "Discuss",
    sendLabel: "Send",
    placeholder: "Ask your question...",
    help: "Discuss mode: explore options and ask for counsel."
  },
  no_objection: {
    label: "Decide",
    sendLabel: "Send decision",
    placeholder: "State your decision...",
    help: "Decide mode: a ruling stands unless someone objects."
  },
  final: {
    label: "Overrule",
    sendLabel: "Send overrule",
    placeholder: "Issue the final ruling...",
    help: "Overrule mode: final ruling for execution."
  }
};

export default function ChatPanel() {
  const { state, dispatch } = useAppState();
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<{ taskId: string; label: string } | null>(null);
  const [showContextTooltip, setShowContextTooltip] = useState(false);
  const [showTranscriptTooltip, setShowTranscriptTooltip] = useState(false);
  const [petitionTooltipStyle, setPetitionTooltipStyle] = useState<CSSProperties | undefined>(undefined);
  const [transcriptTooltipStyle, setTranscriptTooltipStyle] = useState<CSSProperties | undefined>(undefined);
  const petitionRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const transcriptButtonRef = useRef<HTMLButtonElement | null>(null);
  const transcriptTooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipCloseTimer = useRef<number | null>(null);
  const transcriptCloseTimer = useRef<number | null>(null);

  const selectedTask = getSelectedTask(state);
  const openTasks = useMemo(() => getOpenTasks(state), [state.tasks, state.resolvedTaskIds]);
  const taskMessages = selectedTask ? state.chatByTask[selectedTask.taskId] ?? [] : [];
  const taskContext = selectedTask && state.scenario
    ? buildTaskContext(selectedTask, state.scenario.playerNationId, taskMessages)
    : null;

  const stageMeta = STAGE_META[state.stage];
  const stageLabel = stageMeta.label;
  const isDecisionStage = state.stage !== "discussion";

  const activeCourtiers = useMemo(() => {
    if (!state.scenario) return [];
    return state.scenario.courtiers.filter((courtier) => state.selectedCourtiers.includes(courtier.characterId));
  }, [state.scenario, state.selectedCourtiers]);

  const petitionerLabel = useMemo(() => {
    if (!selectedTask) return "None selected";
    if (!selectedTask.ownerCharacterId) return "Courtier";
    const entry = state.scenario?.characterIndex?.[selectedTask.ownerCharacterId];
    if (!entry) return "Courtier";
    return entry.title ? `${entry.title} ${entry.name}` : entry.name;
  }, [selectedTask, state.scenario]);

  const storyTranscripts = useMemo(() => {
    if (!selectedTask?.story?.transcripts || selectedTask.story.transcripts.length === 0) return [];
    return [...selectedTask.story.transcripts].sort((a, b) => a.turn_index - b.turn_index);
  }, [selectedTask?.story?.transcripts]);

  const quickPrompts = useMemo(
    () => buildSuggestions(selectedTask, state.stage, taskMessages),
    [selectedTask, state.stage, taskMessages]
  );

  const requiresCourtiers = state.stage === "discussion";
  const canSend = Boolean(input.trim()) && (!requiresCourtiers || activeCourtiers.length > 0) && !state.isChatLoading;
  const canClearChat = Boolean(selectedTask) && taskMessages.length > 1;

  useEffect(() => {
    setLocalError(null);
    setInput("");
    setDecisionNotice(null);
    setShowContextTooltip(false);
    setShowTranscriptTooltip(false);
    setPetitionTooltipStyle(undefined);
    setTranscriptTooltipStyle(undefined);
    if (tooltipCloseTimer.current) {
      window.clearTimeout(tooltipCloseTimer.current);
      tooltipCloseTimer.current = null;
    }
    if (transcriptCloseTimer.current) {
      window.clearTimeout(transcriptCloseTimer.current);
      transcriptCloseTimer.current = null;
    }
  }, [selectedTask?.taskId]);

  useEffect(() => {
    if (!showContextTooltip) return;
    let raf = 0;
    const updatePosition = () => {
      const anchor = petitionRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const margin = 12;
      const rect = anchor.getBoundingClientRect();
      const tipRect = tooltip.getBoundingClientRect();

      let top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - margin) {
        top = rect.top - tipRect.height - 8;
      }
      if (top < margin) top = margin;

      let left = rect.left;
      if (left + tipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tipRect.width - margin;
      }
      if (left < margin) left = margin;

      setPetitionTooltipStyle({ top, left });
    };

    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updatePosition);
    };

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.cancelAnimationFrame(raf);
    };
  }, [showContextTooltip, selectedTask?.taskId]);

  useEffect(() => {
    if (!showTranscriptTooltip) return;
    let raf = 0;
    const updatePosition = () => {
      const anchor = transcriptButtonRef.current;
      const tooltip = transcriptTooltipRef.current;
      if (!anchor || !tooltip) return;
      const margin = 12;
      const rect = anchor.getBoundingClientRect();
      const tipRect = tooltip.getBoundingClientRect();

      let top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - margin) {
        top = rect.top - tipRect.height - 8;
      }
      if (top < margin) top = margin;

      let left = rect.right - tipRect.width;
      if (left + tipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tipRect.width - margin;
      }
      if (left < margin) left = margin;

      setTranscriptTooltipStyle({ top, left });
    };

    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updatePosition);
    };

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.cancelAnimationFrame(raf);
    };
  }, [showTranscriptTooltip, selectedTask?.taskId]);

  function cancelTooltipClose() {
    if (tooltipCloseTimer.current) {
      window.clearTimeout(tooltipCloseTimer.current);
      tooltipCloseTimer.current = null;
    }
  }

  function scheduleTooltipClose() {
    cancelTooltipClose();
    tooltipCloseTimer.current = window.setTimeout(() => {
      setShowContextTooltip(false);
      tooltipCloseTimer.current = null;
    }, 120);
  }

  function cancelTranscriptClose() {
    if (transcriptCloseTimer.current) {
      window.clearTimeout(transcriptCloseTimer.current);
      transcriptCloseTimer.current = null;
    }
  }

  function scheduleTranscriptClose() {
    cancelTranscriptClose();
    transcriptCloseTimer.current = window.setTimeout(() => {
      setShowTranscriptTooltip(false);
      transcriptCloseTimer.current = null;
    }, 120);
  }

  useEffect(() => {
    if (!decisionNotice) return;
    const timer = setTimeout(() => setDecisionNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [decisionNotice]);

  async function requestInput() {
    if (!selectedTask || !state.scenario) return;
    const trimmed = input.trim();
    if (!trimmed) {
      setLocalError("Enter a message for the court.");
      return;
    }
    if (requiresCourtiers && activeCourtiers.length === 0) {
      setLocalError("Select at least one courtier to respond.");
      return;
    }

    setLocalError(null);

    const playerMessage: ChatMessage = { role: "player", content: trimmed };
    const pendingMessages = [...taskMessages, playerMessage];

    dispatch({ type: "append_messages", payload: { taskId: selectedTask.taskId, messages: [playerMessage] } });
    dispatch({ type: "set_chat_loading", payload: true });

    if (state.stage !== "discussion") {
      try {
        const decisionContext = buildTaskContext(selectedTask, state.scenario.playerNationId, pendingMessages);
        const result = await queueDecision({
          task_context: decisionContext,
          player_text: trimmed,
          stage: state.stage,
          transcript: pendingMessages,
          gameId: state.scenario?.gameId
        });
        dispatch({
          type: "queue_decision",
          payload: {
            taskId: selectedTask.taskId,
            stage: state.stage,
            playerText: trimmed,
            decision: result.decision,
            transcript: pendingMessages,
            queuedAt: new Date().toISOString()
          }
        });
        dispatch({ type: "reset_task_chat", payload: { taskId: selectedTask.taskId } });
        dispatch({ type: "set_stage", payload: "discussion" });
        setInput("");
        setDecisionNotice({ taskId: selectedTask.taskId, label: stageMeta.label });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLocalError(message);
      } finally {
        dispatch({ type: "set_chat_loading", payload: false });
      }
      return;
    }

    if (!taskContext) return;

    try {
      const chatPayload = buildChatPayload(taskContext, trimmed, activeCourtiers, pendingMessages, state.scenario.playerNationId);
      const response = await requestCourtChat(chatPayload);
      const courtierMessages: ChatMessage[] = response.messages.map((msg) => ({
        role: "courtier",
        speakerCharacterId: msg.speaker_character_id,
        content: msg.content
      }));
      dispatch({ type: "append_messages", payload: { taskId: selectedTask.taskId, messages: courtierMessages } });
      setInput("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalError(message);
    } finally {
      dispatch({ type: "set_chat_loading", payload: false });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!state.isChatLoading) requestInput();
    }
  }

  function handleClearChat() {
    if (!selectedTask || !canClearChat) return;
    setInput("");
    setLocalError(null);
    dispatch({ type: "reset_task_chat", payload: { taskId: selectedTask.taskId } });
  }

  return (
    <>
      <div className="header">
        <div>
          <h2>Council Chamber</h2>
          <div className="small">Petitioner: {petitionerLabel}</div>
        </div>
        <span className={`badge ${isDecisionStage ? "hot" : ""}`}>{stageLabel}</span>
      </div>
      <div className="content chat">
        {state.error && <div className="card">Scenario load error: {state.error}</div>}
        {!state.error && !selectedTask && openTasks.length === 0 && state.scenario && (
          <div className="card">All tractanda resolved. End the week to process rulings.</div>
        )}
        {!state.error && !selectedTask && (!state.scenario || openTasks.length > 0) && <div className="card">Loading tasks...</div>}
        {selectedTask && (
          <>
            <div className="card compact">
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <div className="section-title">Participants</div>
                <HoverTooltip content="Add or remove courtiers from the Court panel.">
                  <span className="hint" tabIndex={0} role="img" aria-label="Participants help">
                    i
                  </span>
                </HoverTooltip>
              </div>
              <div className="participant-list" style={{ marginTop: 6 }}>
                {activeCourtiers.length === 0 && <span className="small">None selected</span>}
                {activeCourtiers.map((courtier) => (
                  <span
                    key={courtier.characterId}
                    className="participant-pill"
                    style={{ "--courtier-color": getCourtierColor(courtier.characterId) } as CSSProperties}
                  >
                    {courtier.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="petition-header">
              <div
                className="petition-tooltip-wrap"
                onMouseEnter={() => {
                  cancelTooltipClose();
                  setShowContextTooltip(true);
                }}
                onMouseLeave={scheduleTooltipClose}
              >
                <button
                  type="button"
                  className="petition-label"
                  ref={petitionRef}
                  onFocus={() => {
                    cancelTooltipClose();
                    setShowContextTooltip(true);
                  }}
                  onBlur={scheduleTooltipClose}
                  aria-haspopup={selectedTask.sources.length > 0 ? "dialog" : undefined}
                  aria-expanded={showContextTooltip}
                >
                  Petition
                </button>
                {showContextTooltip && (
                  <div
                    className="petition-context-tooltip"
                    role="tooltip"
                    ref={tooltipRef}
                    style={petitionTooltipStyle}
                    onMouseEnter={cancelTooltipClose}
                    onMouseLeave={scheduleTooltipClose}
                  >
                    <div className="context-tooltip-title">Petition</div>
                    <div className="petition-tooltip-text">{selectedTask.prompt}</div>
                    {selectedTask.story && (
                      <>
                        <div className="context-tooltip-title">Storyline</div>
                        <div className="context-story-title">{selectedTask.story.title}</div>
                        <div className="context-story-summary">{selectedTask.story.summary}</div>
                        {selectedTask.story.history && selectedTask.story.history.length > 1 && (
                          <div className="context-story-history">
                            {selectedTask.story.history.map((entry: string, index: number) => (
                              <div key={`${selectedTask.story?.story_id}-${index}`} className="context-story-entry">
                                {entry}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {selectedTask.sources.length > 0 && (
                      <>
                        <div className="context-tooltip-title">Background</div>
                        {selectedTask.sources.map((source, index) => (
                          <div key={`${source.title}-${index}`} className="context-source">
                            <div className="context-source-title">{source.title}</div>
                            {source.excerpt && <div className="context-source-excerpt">{source.excerpt}</div>}
                            <div className="context-source-meta">
                              {source.source_type === "wikipedia" ? "Wikipedia" : source.source_type}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              <span className={`badge urgency-${selectedTask.urgency}`}>{selectedTask.urgency}</span>
              {selectedTask.story?.history && selectedTask.story.history.length > 1 && (
                <span className="badge subtle">Continuing matter</span>
              )}
            </div>

            {decisionNotice && (
              <div className="card decision-toast" role="status" aria-live="polite">
                <div>
                  <div className="section-title">Decision queued</div>
                  <div className="small">{decisionNotice.label} ruling queued for next week. Chat cleared.</div>
                </div>
                <button className="btn ghost small" type="button" onClick={() => setDecisionNotice(null)}>
                  Dismiss
                </button>
              </div>
            )}

            <div className="chat-log">
              {taskMessages.length === 0 && <div className="small">No messages yet. Send a request to the court.</div>}
              {taskMessages.map((m, i) => {
                const speaker = getSpeakerMeta(state.scenario?.characterIndex, m);
                const showTranscript = i === 0
                  && Boolean(selectedTask?.story?.history && selectedTask.story.history.length > 1)
                  && storyTranscripts.length > 0;
                return (
                  <div
                    key={i}
                    className={`msg ${m.role}${showTranscript ? " with-transcript" : ""}`}
                    style={{ "--speaker-color": speaker.color } as CSSProperties}
                  >
                    <div className="who">{speaker.label}</div>
                    <div className="text">{renderMarkdown(m.content)}</div>
                    {showTranscript && (
                      <div
                        className="transcript-tooltip-wrap"
                        onMouseEnter={() => {
                          cancelTranscriptClose();
                          setShowTranscriptTooltip(true);
                        }}
                        onMouseLeave={scheduleTranscriptClose}
                      >
                        <button
                          type="button"
                          className="transcript-button"
                          ref={transcriptButtonRef}
                          onClick={() => setShowTranscriptTooltip((open) => !open)}
                          onFocus={() => {
                            cancelTranscriptClose();
                            setShowTranscriptTooltip(true);
                          }}
                          onBlur={scheduleTranscriptClose}
                          aria-haspopup="dialog"
                          aria-expanded={showTranscriptTooltip}
                          aria-label="Show prior conversation log"
                        >
                          log
                        </button>
                        {showTranscriptTooltip && (
                          <div
                            className="transcript-tooltip"
                            role="tooltip"
                            ref={transcriptTooltipRef}
                            style={transcriptTooltipStyle}
                            onMouseEnter={cancelTranscriptClose}
                            onMouseLeave={scheduleTranscriptClose}
                          >
                            <div className="transcript-title">Previous conversations</div>
                            {storyTranscripts.map((transcript) => (
                              <div key={transcript.task_id} className="transcript-block">
                                <div className="transcript-week">Week {transcript.turn_index}</div>
                                {transcript.messages.map((message, idx) => (
                                  <div key={`${transcript.task_id}-${idx}`} className={`transcript-line ${message.role}`}>
                                    <span className="transcript-speaker">
                                      {getTranscriptSpeakerLabel(state.scenario?.characterIndex, message)}
                                    </span>
                                    <span className="transcript-text">{message.content}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {state.isChatLoading && (
                <div className="msg system" style={{ "--speaker-color": "#6b6b6b" } as CSSProperties}>
                  <div className="who">Court</div>
                  <div className="text">…</div>
                </div>
              )}
            </div>

            <div className="chat-controls" data-tutorial-id="chat-controls">
              <div className="row" style={{ alignItems: "center", gap: 8 }}>
                <div className="small">Quick prompts</div>
              </div>
              <div className="row">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setInput(prompt);
                    }}
                    title="Click to fill the input"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={stageMeta.placeholder}
              />
              <div className="send-row">
                <div className="send-split" role="group" aria-label="Send decision">
                  <div
                    className="mode-slider"
                    role="radiogroup"
                    aria-label="Message mode"
                    style={{ "--mode-index": STAGE_ORDER.indexOf(state.stage) } as CSSProperties}
                  >
                    {STAGE_ORDER.map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        className={`mode-option ${state.stage === stage ? "active" : ""}`}
                        role="radio"
                        aria-checked={state.stage === stage}
                        onClick={() => dispatch({ type: "set_stage", payload: stage })}
                      >
                        {STAGE_META[stage].label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn primary send-action"
                    onClick={requestInput}
                    disabled={!canSend}
                    title={stageMeta.help}
                  >
                    {stageMeta.sendLabel}
                  </button>
                </div>
                <button className="btn" type="button" onClick={handleClearChat} disabled={!canClearChat}>
                  Clear chat
                </button>
              </div>
              <div className="small">{stageMeta.help}</div>
              {localError && <div className="small">{localError}</div>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function buildChatPayload(taskContext: ReturnType<typeof buildTaskContext>, playerText: string, courtiers: CourtierProfile[], messages: ChatMessage[], playerNationId: string) {
  const updatedContext = buildTaskContext(
    {
      taskId: taskContext.task_id,
      taskType: taskContext.task_type,
      ownerCharacterId: taskContext.owner_character_id,
      urgency: taskContext.urgency,
      prompt: taskContext.prompt,
      sources: taskContext.sources ?? [],
      allowedActionTypes: taskContext.constraints.allowed_action_types,
      suggestedActionTypes: taskContext.constraints.suggested_action_types,
      state: "open"
    },
    playerNationId,
    messages
  );

  return {
    task_context: updatedContext,
    player_text: playerText,
    active_character_ids: courtiers.map((c) => c.characterId),
    characters: courtiers.map((c) => ({
      character_id: c.characterId,
      name: c.name,
      title: c.title,
      office: c.office,
      domain: c.domain,
      traits: c.traits,
      skills: c.skills,
      advisor_model: {
        accuracy: c.advisorModel?.accuracy,
        reliability: c.advisorModel?.reliability
      }
    })),
    max_messages: Math.min(3, courtiers.length)
  };
}

function getSpeakerMeta(
  characterIndex: Record<string, { name: string; title?: string }> | undefined,
  message: ChatMessage
): { label: string; color: string } {
  if (message.role === "player") return { label: "Player", color: "#c8a357" };
  if (message.role === "system") return { label: "System", color: "#6b6b6b" };
  if (!message.speakerCharacterId) return { label: "Courtier", color: "#8fb7a7" };
  const entry = characterIndex?.[message.speakerCharacterId];
  const label = entry ? (entry.title ? `${entry.title} ${entry.name}` : entry.name) : "Courtier";
  return { label, color: getCourtierColor(message.speakerCharacterId) };
}

function getTranscriptSpeakerLabel(
  characterIndex: Record<string, { name: string; title?: string }> | undefined,
  message: { role: "player" | "courtier" | "system"; sender_character_id?: string }
): string {
  if (message.role === "player") return "Player";
  if (message.role === "system") return "System";
  if (!message.sender_character_id) return "Courtier";
  const entry = characterIndex?.[message.sender_character_id];
  return entry ? (entry.title ? `${entry.title} ${entry.name}` : entry.name) : "Courtier";
}

function buildSuggestions(task: TaskViewModel | null, stage: Stage, messages: ChatMessage[]): string[] {
  if (!task) return [];
  const summary = task.prompt.trim();
  if (stage === "discussion") {
    return [
      `What are the risks and tradeoffs of \"${summary}\"?`,
      `Outline two viable alternatives to \"${summary}\".`
    ];
  }
  const hasCourtierInput = messages.some((message) => message.role === "courtier" && message.content.trim().length > 0);
  if (hasCourtierInput) {
    return [
      "Yes. Proceed with the council's recommendation.",
      "Approved. Execute the advised course."
    ];
  }
  return [
    "No objections. Proceed as you see fit.",
    "I defer to the council; resolve this without me."
  ];
}
