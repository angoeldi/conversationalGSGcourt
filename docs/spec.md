# The Court: design specification (v1)

## 0. Elevator pitch
A weekly, turn-based grand strategy game where the **nation model is deterministic ground truth** and the player experiences it through a **biased, noisy, political court**.

## 1. UI (static tri-panel)

### Left: Map
- Zoomed to current zone of control (ZoC).
- Toggle: overseas possessions.
- Map modes: political, economic power, military, unrest, admin.
- Interaction: hover tooltips; click opens province card.

### Center: Court
- Ruler portrait, talents, health, legitimacy.
- Succession panel (heirs or electors).
- Nation summary (GDP, revenue, debt, culture/religion mixes, divisions).
- Court roster: permanent offices + petitioners + experts.
- Courtiers owning open tasks are lit.

### Right: Task chat
- One thread per Task.
- Add 1..k courtiers to a group chat.
- Controls:
  - Request additional input (broadcast or targeted).
  - Decision suggestions (exactly two options, each mapped to an action bundle).
  - 3-stage toggle: discussion → decision if no one objects → final decision.
- Continuing matters open with a short "Remember we did ..." reminder; the full prior transcript is available via the message log button.
- “Finish week” expects all tasks cleared; override is explicit and costly.

## 2. Weekly loop
1) Briefing: compute metrics, spawn tasks via triggers.
2) Deliberation: chat, map exploration, requests.
3) Decision: lock each task with a final decision.
4) Execution: parse decisions → action bundles → validate → apply → tick.
5) After-action: chronicle + audit deltas + roster updates.

### Petitions & continuity
- Each week spawns at least two new petitions and at least one light, courtly "quirk" petition when capacity allows.
- Continuing matters are drawn from recent resolved tasks and preserve their conversation transcripts for UI display.
- Open petitions are capped by a configurable petition limit (default 10); above the cap, new arrivals pause.

## 3. Ground truth model
Keep the model expressive but low-dimensional.

### Core entities
- Nation, Province/Region, Interest Groups, Laws/Institutions, Military Forces, Diplomatic Links, Characters, Operations.

### Nation state (minimum)
Economy (gdp, growth trend, inflation proxy if desired, treasury, debt), society (population, literacy, stability, legitimacy), politics (IG clout/approval, law set, institutions), military (manpower, force size, readiness, supply, war exhaustion), diplomacy (relations edges + treaties), court (ruler + appointments + succession).

### Province state (minimum)
Population, productivity, infrastructure, unrest, compliance, garrison, resources, culture mix, religion mix.

## 4. Advisors: epistemic model
Advisors never see ground truth. They query a computed **perceived view**:
- scope/access gates what is knowable.
- accuracy injects random error.
- reliability/bias inject systematic error.
- output includes confidence.

## 5. Actions: the only state mutation
Every change is an Action validated and applied by the deterministic engine.
LLM text is interpreted into action bundles; it does not change state directly.

## 6. Scenario initialization
Scenario builder is allowed **Wikipedia-only retrieval** (server-side). Gameplay models do not browse.

See `docs/actions.md`, `docs/prompts.md`, and the JSON Schemas in `schemas/`.
