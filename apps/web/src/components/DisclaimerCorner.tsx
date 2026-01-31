import { useEffect, useState, type FormEvent } from "react";
import { loadPlayerOptions, savePlayerOptions, sendFeedback } from "../lib/api";

const DISCLAIMER_KEY = "court:disclaimer-ack";

export default function DisclaimerCorner() {
  const [acknowledged, setAcknowledged] = useState(false);
  const [openNotice, setOpenNotice] = useState(false);
  const [openFeedback, setOpenFeedback] = useState(false);
  const [openOptions, setOpenOptions] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [options, setOptions] = useState(() => loadPlayerOptions());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(DISCLAIMER_KEY);
    if (stored === "true") setAcknowledged(true);
  }, []);

  function toggleNotice() {
    setOpenNotice((prev) => {
      const next = !prev;
      if (next) {
        setOpenFeedback(false);
        setOpenOptions(false);
      }
      return next;
    });
  }

  function toggleFeedback() {
    setOpenFeedback((prev) => {
      const next = !prev;
      if (next) {
        setOpenNotice(false);
        setOpenOptions(false);
      }
      return next;
    });
  }

  function toggleOptions() {
    setOpenOptions((prev) => {
      const next = !prev;
      if (next) {
        setOpenNotice(false);
        setOpenFeedback(false);
      }
      return next;
    });
  }

  function updateOptions(next: typeof options) {
    setOptions(next);
    savePlayerOptions(next);
  }

  function acknowledge() {
    setAcknowledged(true);
    setOpenNotice(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DISCLAIMER_KEY, "true");
    }
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = feedbackText.trim();
    if (!message) return;
    setFeedbackStatus("sending");
    setFeedbackError(null);
    try {
      await sendFeedback(message);
      setFeedbackStatus("sent");
      setFeedbackText("");
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Failed to send feedback.";
      setFeedbackStatus("error");
      setFeedbackError(messageText);
    }
  }

  const flagged = !acknowledged;

  return (
    <div className={`disclaimer-corner${flagged ? " flagged" : ""}`}>
      <div className="corner-buttons">
        <button
          className="disclaimer-button"
          type="button"
          onClick={toggleNotice}
          aria-expanded={openNotice}
          aria-controls="disclaimer-panel"
          aria-label="Notices"
        >
          <span className="disclaimer-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" role="presentation">
              <path
                d="M3 1h2v14H3V1zm2 1h8l-2 3 2 3H5V2z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="disclaimer-label">Notice</span>
        </button>
        <button
          className="feedback-button"
          type="button"
          onClick={toggleFeedback}
          aria-expanded={openFeedback}
          aria-controls="feedback-panel"
          aria-label="Send feedback"
        >
          Feedback
        </button>
        <button
          className="options-button"
          type="button"
          onClick={toggleOptions}
          aria-expanded={openOptions}
          aria-controls="options-panel"
          aria-label="Options"
        >
          Options
        </button>
      </div>
      {openNotice && (
        <div className="disclaimer-panel" id="disclaimer-panel">
          <div className="disclaimer-title">Important notices</div>
          <ul className="disclaimer-list">
            <li>This experience stores session data and gameplay state in the database.</li>
            <li>If you provide email or display name, that personal data is stored server-side.</li>
            <li>Game content is AI-generated and may be inaccurate or inappropriate.</li>
            <li>Do not rely on outputs for legal, medical, or financial advice.</li>
            <li>Avoid entering sensitive personal data.</li>
          </ul>
          <button className="btn small" type="button" onClick={acknowledge}>
            Acknowledge
          </button>
        </div>
      )}
      {openFeedback && (
        <div className="feedback-panel" id="feedback-panel">
          <div className="disclaimer-title">Feedback</div>
          <form className="feedback-form" onSubmit={submitFeedback}>
            <textarea
              className="text-input text-area feedback-textarea"
              placeholder="Share a bug, idea, or quick note..."
              value={feedbackText}
              onChange={(event) => {
                setFeedbackText(event.target.value);
                if (feedbackStatus !== "idle") {
                  setFeedbackStatus("idle");
                  setFeedbackError(null);
                }
              }}
            />
            <div className="feedback-actions">
              <button className="btn small" type="submit" disabled={feedbackStatus === "sending" || !feedbackText.trim()}>
                {feedbackStatus === "sending" ? "Sending..." : "Send feedback"}
              </button>
              {feedbackStatus === "sent" && (
                <span className="feedback-status" role="status" aria-live="polite">
                  Thanks — feedback received.
                </span>
              )}
              {feedbackStatus === "error" && (
                <span className="feedback-error" role="status" aria-live="polite">
                  {feedbackError ?? "Failed to send feedback."}
                </span>
              )}
            </div>
          </form>
        </div>
      )}
      {openOptions && (
        <div className="options-panel" id="options-panel">
          <div className="disclaimer-title">Options</div>
          <div className="options-row">
            <div className="options-text">
              <div className="options-label">Limit freeform deltas</div>
              <div className="options-hint">Caps freeform effects to conservative deltas for stability.</div>
            </div>
            <label className="options-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-label="Limit freeform deltas"
                checked={options.limitFreeformDeltas}
                onChange={(event) => updateOptions({ ...options, limitFreeformDeltas: event.target.checked })}
              />
              <span aria-hidden="true" />
            </label>
          </div>
          <div className="options-row">
            <div className="options-text">
              <div className="options-label">Strict actions only</div>
              <div className="options-hint">Disallow freeform effects; only canonical actions.</div>
            </div>
            <label className="options-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-label="Strict actions only"
                checked={options.strictActionsOnly}
                onChange={(event) => updateOptions({ ...options, strictActionsOnly: event.target.checked })}
              />
              <span aria-hidden="true" />
            </label>
          </div>
          <div className="options-row">
            <div className="options-text">
              <div className="options-label">Petition inflow</div>
              <div className="options-hint">Controls how many new petitioners arrive each week.</div>
            </div>
            <select
              className="options-select"
              value={options.petitionInflow}
              onChange={(event) => updateOptions({ ...options, petitionInflow: event.target.value as typeof options.petitionInflow })}
              aria-label="Petition inflow"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="options-row">
            <div className="options-text">
              <div className="options-label">Petition cap</div>
              <div className="options-hint">Maximum open petitions before new arrivals pause.</div>
            </div>
            <select
              className="options-select"
              value={options.petitionCap}
              onChange={(event) => updateOptions({ ...options, petitionCap: Number.parseInt(event.target.value, 10) })}
              aria-label="Petition cap"
            >
              <option value={10}>10 (default)</option>
              <option value={12}>12</option>
              <option value={15}>15</option>
              <option value={20}>20</option>
              <option value={25}>25</option>
            </select>
          </div>
          <div className="options-row">
            <div className="options-text">
              <div className="options-label">Court size</div>
              <div className="options-hint">Limits how many courtiers appear in the courtroom.</div>
            </div>
            <select
              className="options-select"
              value={options.courtSize}
              onChange={(event) => updateOptions({ ...options, courtSize: event.target.value as typeof options.courtSize })}
              aria-label="Court size"
            >
              <option value="full">Full</option>
              <option value="focused">Focused (5)</option>
              <option value="core">Core (3)</option>
            </select>
          </div>
          <div className="options-row">
            <div className="options-text">
              <div className="options-label">Court churn</div>
              <div className="options-hint">Courtiers may leave the visible court over time.</div>
            </div>
            <label className="options-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-label="Court churn"
                checked={options.courtChurn}
                onChange={(event) => updateOptions({ ...options, courtChurn: event.target.checked })}
              />
              <span aria-hidden="true" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
