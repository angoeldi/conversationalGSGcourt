import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/appStore";

const STORAGE_KEY = "thecourt_tutorial_dismissed_v1";

const STEPS = [
  {
    id: "map-panel",
    title: "Realm Map",
    body: "Track control and context here. Map modes will surface politics, unrest, and economy as the game evolves."
  },
  {
    id: "courtroom",
    title: "Courtroom",
    body: "Select courtiers to add them to the chamber. Petition seals open the most urgent matters for that advisor."
  },
  {
    id: "tractanda",
    title: "Tractanda",
    body: "These are the open petitions. Cycle through them and resolve each one to clear the queue."
  },
  {
    id: "chat-controls",
    title: "Council Chamber",
    body: "Ask for counsel, then choose a ruling mode: Discuss, Decide, or Overrule. The slider controls which response is queued."
  },
  {
    id: "end-week",
    title: "End the Week",
    body: "Advance time after rulings. Unresolved tractanda can be auto-decided if you end early."
  }
];

type Rect = { top: number; left: number; width: number; height: number } | null;

type CardPos = { top: number; left: number } | null;

export default function TutorialOverlay() {
  const { state } = useAppState();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [autoShown, setAutoShown] = useState(false);
  const [highlightRect, setHighlightRect] = useState<Rect>(null);
  const [cardPos, setCardPos] = useState<CardPos>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const step = STEPS[stepIndex] ?? STEPS[0];
  const stepCount = STEPS.length;

  useEffect(() => {
    if (autoShown) return;
    if (!state.scenario) return;
    if (state.scenario.turnIndex !== 0) return;
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(STORAGE_KEY) === "1";
    if (!dismissed) {
      setActive(true);
      setStepIndex(0);
      setAutoShown(true);
    }
  }, [autoShown, state.scenario]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const update = () => {
      const nextRect = resolveTargetRect(step.id);
      setHighlightRect(nextRect);
      const card = cardRef.current;
      if (!card) return;
      const pos = computeCardPosition(nextRect, card);
      setCardPos(pos);
    };
    raf = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.cancelAnimationFrame(raf);
    };
  }, [active, step.id]);

  useEffect(() => {
    if (!active) return;
    const target = resolveTarget(step.id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [active, step.id]);

  function closeTutorial(persist: boolean) {
    if (persist && typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    setActive(false);
  }

  function openTutorial() {
    setActive(true);
    setStepIndex(0);
  }

  function goNext() {
    if (stepIndex + 1 >= stepCount) {
      closeTutorial(false);
      return;
    }
    setStepIndex((prev) => Math.min(prev + 1, stepCount - 1));
  }

  function goBack() {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  }

  return (
    <>
      <button
        className="info-button"
        type="button"
        onClick={openTutorial}
        aria-label="Open tutorial"
        title="Open tutorial"
      >
        i
      </button>
      {active && (
        <div className="tutorial-layer" role="dialog" aria-modal="true" aria-label="Tutorial">
          {highlightRect && (
            <div
              className="tutorial-spotlight"
              style={{
                top: highlightRect.top - 8,
                left: highlightRect.left - 8,
                width: highlightRect.width + 16,
                height: highlightRect.height + 16
              }}
            />
          )}
          <div
            ref={cardRef}
            className="tutorial-card"
            style={cardPos ? { top: cardPos.top, left: cardPos.left } : undefined}
          >
            <div className="tutorial-progress">Step {stepIndex + 1} of {stepCount}</div>
            <div className="tutorial-title">{step.title}</div>
            <div className="tutorial-body">{step.body}</div>
            <div className="tutorial-actions">
              <button className="btn ghost" type="button" onClick={() => closeTutorial(false)}>
                Close
              </button>
              <button className="btn ghost" type="button" onClick={() => closeTutorial(true)}>
                Don&apos;t show again
              </button>
              <span className="tutorial-spacer" />
              <button className="btn ghost" type="button" onClick={goBack} disabled={stepIndex === 0}>
                Back
              </button>
              <button className="btn primary" type="button" onClick={goNext}>
                {stepIndex + 1 >= stepCount ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function resolveTarget(stepId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(`[data-tutorial-id="${stepId}"]`);
}

function resolveTargetRect(stepId: string): Rect {
  const target = resolveTarget(stepId);
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

function computeCardPosition(rect: Rect, card: HTMLDivElement): CardPos {
  const margin = 16;
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  if (!rect) {
    return {
      top: Math.max(margin, (screenH - height) / 2),
      left: Math.max(margin, (screenW - width) / 2)
    };
  }

  let top = rect.top + rect.height + 12;
  if (top + height > screenH - margin) {
    top = rect.top - height - 12;
  }
  if (top < margin) top = margin;

  let left = rect.left;
  if (left + width > screenW - margin) {
    left = screenW - width - margin;
  }
  if (left < margin) left = margin;

  return { top, left };
}
