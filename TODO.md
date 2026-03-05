# TODO

## Urgent

- **Objective:** Close the turn-resolution loop by ensuring every player-facing world change is emitted as a validated `ActionBundle` and replayable event.
  - **Owner area:** `packages/engine`
  - **Acceptance criteria:**
    - Engine rejects any state mutation path that is not tied to a typed action application.
    - Event log replay from seed reproduces identical world state for 20 sampled turns.
    - Regression tests cover success + invalid-action rejection cases.
  - **Rough priority:** P0

- **Objective:** Add explicit server-side validation telemetry for malformed action payloads to speed up incident triage.
  - **Owner area:** `apps/server`
  - **Acceptance criteria:**
    - Validation failures include scenario id, turn index, action type, and schema error summary.
    - Logs are structured and searchable in local/dev output.
    - A test fixture demonstrates one invalid payload path and expected log shape.
  - **Rough priority:** P1

## Visual + Map

- **Objective:** Improve map readability at default zoom by increasing region contrast and reducing label collision.
  - **Owner area:** `apps/web`
  - **Acceptance criteria:**
    - Adjacent selectable regions meet contrast expectations in the base theme.
    - Label overlap is reduced on 3 representative dense regions.
    - Snapshot/manual QA checklist added for desktop + laptop widths.
  - **Rough priority:** P1

- **Objective:** Add a quick legend for map overlays so users can distinguish economy, stability, and military views instantly.
  - **Owner area:** `apps/web`
  - **Acceptance criteria:**
    - Overlay legend is visible without opening additional panels.
    - Legend updates when layer toggles change.
    - Empty/unknown data state is clearly indicated.
  - **Rough priority:** P2

## UX + Tutorial

- **Objective:** Reduce first-turn confusion with a guided “why this matters” stepper for core controls (turn advance, priorities, advisories).
  - **Owner area:** `apps/web`
  - **Acceptance criteria:**
    - New users see a 3–5 step walkthrough that can be skipped or resumed.
    - Each step links a UI control to an immediate gameplay consequence (UX clarity).
    - Completion is persisted so repeat users are not forced through the flow.
  - **Rough priority:** P1

- **Objective:** Clarify action affordances in the turn composer using inline validation hints before submission.
  - **Owner area:** `apps/web`
  - **Acceptance criteria:**
    - Invalid/ambiguous action inputs show contextual guidance before send.
    - Users can resolve all blocking errors without leaving the composer.
    - At least one usability test script is documented for this flow.
  - **Rough priority:** P1

## UX + Content

- **Objective:** Increase narrative quality by tightening event copy style and adding era-aware flavor text variants.
  - **Owner area:** `apps/server`
  - **Acceptance criteria:**
    - Event text follows a documented tone guide in prompts/content docs.
    - At least 10 high-frequency events have 2+ distinct narrative variants.
    - Variant selection remains deterministic from turn seed.
  - **Rough priority:** P2

- **Objective:** Improve advisory panel usefulness by rewriting recommendations to include rationale and expected tradeoff.
  - **Owner area:** `apps/server`
  - **Acceptance criteria:**
    - Every advisory includes “why now” + “cost/risk” phrasing.
    - Recommendations reference concrete in-world signals (not generic text).
    - Content review checklist added for consistency.
  - **Rough priority:** P2

## Systems
- [x] Remove non-actionable `pnpm -r build` CI step that was failing consistently without signal.
- [x] Add deterministic per-turn task generation tuning (turn phase, pressure, recent mix, nation stress) and wire it through game route generation.
- [x] Add constrained task-generation header knobs for continuity/diversity/stress experimentation.

- **Objective:** Expand simulation depth by introducing regional logistics pressure as an input to military and economic outcomes.
  - **Owner area:** `packages/engine`
  - **Acceptance criteria:**
    - New logistics variable is computed deterministically per turn.
    - Military/economy formulas consume logistics with documented coefficients.
    - Unit tests verify edge cases (overextension, recovery, neutral baseline).
  - **Rough priority:** P0

- **Objective:** Add schema drift checks between persisted JSON shapes and shared Zod mirrors.
  - **Owner area:** `apps/server`
  - **Acceptance criteria:**
    - CI/local check fails when schema and mirror types diverge.
    - Developer command documents how to regenerate/update mirrors.
    - One intentional mismatch test confirms guardrail behavior.
  - **Rough priority:** P1

## Confirm

- **Objective:** Confirm 1492 GDP/pop override integrity after any balancing pass.
  - **Owner area:** `apps/server`
  - **Acceptance criteria:**
    - `world_1492_overrides.json` changes are accompanied by before/after diff notes.
    - Sanity script verifies totals and missing-key regressions.
    - Review sign-off captured in commit/PR notes.
  - **Rough priority:** P1

- **Objective:** Confirm deterministic replay across server + engine boundary before release tagging.
  - **Owner area:** `packages/engine`
  - **Acceptance criteria:**
    - Fixed seed + action sequence replay matches golden snapshot.
    - Time source remains context-driven (`EngineContext.now`) with no ambient clock usage.
    - Release checklist includes deterministic replay evidence link.
  - **Rough priority:** P0

## Next 2 sprints

- **Sprint 1 (execution order):** Complete P0 items first (action/event loop hardening, logistics simulation depth, deterministic replay confirmation), then ship tutorial clarity improvements.
- **Sprint 2 (execution order):** Focus on map readability/legend and narrative/advisory quality upgrades, then finalize schema drift checks and 1492 override confirmation work.
