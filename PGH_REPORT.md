# PGH Report — The Court (spec kit)
Date: 2026-01-30
Reviewer: Codex (dev review)

## Understanding of the project
The Court is a turn-based grand strategy game prototype where the **engine** models a deterministic world state and the **player experience** is mediated by LLM-driven court advisors. Players submit intents; LLMs translate them into action bundles, and the engine applies validated actions deterministically. The server orchestrates LLM calls, persistence, and scenario/wiki grounding. The web app renders a static tri-panel UI (map | court | chat) over dynamic content. I understand the intended separation of concerns and the goal of replayable, audited simulation with LLM-assisted UX.

## Review scope
- README + core docs (architecture, actions, prompts, API, DB notes)
- AI pipeline: prompts, LLM providers, decision parsing, scenario builder, court chat
- Engine + server game loop + world state + UI map dependencies

## Findings (ordered by severity)

### Critical / High
1) **Operation budgets are double-counted** (treasury drains twice for `send_spy` and `improve_relations`).
   - In `packages/engine/src/apply.ts`, the full action `budget` is subtracted up front. Then in `packages/engine/src/tick.ts`, `opWeekly` (derived from the same budget) is included in weekly spending. This charges the full budget *and* the weekly budget, effectively ~2x cost.
   - Impact: treasury plunges faster than intended; long operations can become economically prohibitive; action effects are misleading.
   - Files: `packages/engine/src/apply.ts` (send_spy, improve_relations), `packages/engine/src/tick.ts` (opWeekly spending).

2) **Player nation inference can target the wrong nation** when player is not lexicographically first.
   - Many actions use `inferPlayerNationId()` which sorts nation IDs and picks the first, ignoring `state.player_nation_id`. If a scenario has a different player nation, actions mutate the wrong nation.
   - Impact: incorrect state mutations, especially in multi-nation scenarios from the builder.
   - Files: `packages/engine/src/apply.ts` (inferPlayerNationId + usages).

3) **`issue_debt` parameters are ignored in simulation**.
   - The engine records `interest_rate_annual` and `maturity_weeks` in the action effect, but `tickWeek` uses a fixed 5% annual service and never tracks maturities. The action’s parameters do not influence state.
   - Impact: LLM outputs and player decisions about debt terms are meaningless; simulation diverges from action intent.
   - Files: `packages/engine/src/apply.ts` (`issue_debt`), `packages/engine/src/tick.ts` (debtService).

4) **Freeform province deltas can hit the wrong province** when a target nation has no provinces.
   - `inferProvinceIdForNation()` falls back to the first province in the world if the target nation has none (possible because world state adds catalog/1492 nations without provinces). Freeform effects against those nations may mutate unrelated provinces.
   - Impact: unintended cross-nation province changes; hard-to-debug map/state drift.
   - File: `packages/engine/src/apply.ts` (`inferProvinceIdForNation`).

5) **Auto-decisions can violate action constraints**.
   - `buildAutoDecision()` filters `allowed_action_types` through `KNOWN_ACTIONS`, but if the allowed set is only `freeform_effect` or `apply_trajectory_modifier`, it falls back to `DEFAULT_ACTIONS`, which are *not allowed*.
   - Impact: auto-decide can enqueue actions that violate constraints and player expectations.
   - File: `apps/server/src/lib/autoDecision.ts`.

### Major
6) **Schema-first persistence is incomplete** for `world_state` (and related JSONB).
   - The repo rule requires schemas and Zod mirrors for persisted JSONB. `world_state` (snapshots) has no JSON schema in `schemas/` and no Zod mirror in `packages/shared`. `action_effects.delta/audit` also lack schemas.
   - Impact: weaker validation guarantees, harder migration/versioning, and drift between persisted data and TypeScript expectations.
   - Evidence: `schemas/` has action/decision/task/scenario schemas but no world_state; `packages/shared/src/schemas` likewise.

7) **EngineContext in code doesn’t match the repo rule**.
   - AGENTS.md requires `EngineContext` to include `{turnIndex, turnSeed, now}`. The actual type only has `turn_index` and `turn_seed`.
   - Impact: architectural inconsistency with stated determinism contract; future engine features may assume `now` and break.
   - File: `packages/engine/src/state.ts`.

8) **Action RNG ignores turn_index**, causing repeated actions with identical params to always yield identical random outcomes.
   - `hashSeed()` uses only `turn_seed` and the action params. That means performing the same action in a later turn produces the same RNG result.
   - Impact: exploitable/unnatural gameplay (e.g., repeated spy actions always expose or never expose if parameters match).
   - File: `packages/engine/src/apply.ts` (`hashSeed`, `stableActionKey`).

### Medium
9) **Suggested action types are effectively ignored by the LLM and UI**.
   - `task_generation` sets `context_overrides.suggested_action_types`, but `buildTaskContext()` only places them in `constraints.notes`. `parseDecision()` does not include notes, and the web UI only reads `constraints.allowed_action_types`.
   - Impact: LLM is not guided toward domain-appropriate actions; UI shows full catalog even when suggestions exist.
   - Files: `apps/server/src/lib/taskGeneration.ts`, `apps/server/src/lib/game.ts` (buildTaskContext), `apps/server/src/lib/decision.ts` (prompt construction), `apps/web/src/lib/api.ts` (applyActionTypeOptions).

10) **`constraints.forbidden_action_types` is defined but never enforced**.
   - The schema includes `forbidden_action_types`, but neither the LLM prompt nor server-side coercion filters them out.
   - Impact: constraints are advisory only; mismatches with spec intent.
   - Files: `packages/shared/src/schemas/taskContext.ts`, `apps/server/src/lib/decision.ts`, `apps/server/src/lib/actionHarness.ts`.

11) **README vs config mismatch on default LLM provider**.
   - README claims default LLM is Groq OSS-20b; `.env.example` and config default `LLM_PROVIDER` to `openai` with `gpt-4o-mini`. Without OpenAI credentials, local setup fails unless the developer edits `.env`.
   - Impact: onboarding confusion; README implies a default that doesn’t match the shipped config.
   - Files: `README.md`, `.env.example`, `apps/server/src/config.ts`.

12) **Unbounded in-memory wiki cache**.
   - `wikiCache` grows per `(scenario_id, turnIndex)` and is never pruned.
   - Impact: memory growth on long-running servers or many scenarios.
   - File: `apps/server/src/lib/taskGeneration.ts`.

### Minor / Observations
13) **Many actions are documented but unimplemented (noop)** in the engine.
   - The engine explicitly no-ops most action types, while `docs/actions.md` describes their effects as if implemented.
   - Impact: player decisions appear to do nothing beyond logging; expectation mismatch.
   - Files: `docs/actions.md`, `packages/engine/src/apply.ts` (default case).

14) **Random outcomes are not fully logged**.
   - GDP shocks, operation success rolls, and non-exposed spy rolls aren’t logged as audit fields, which weakens replayability/audit trails relative to the stated “random outcomes must be seeded and written to the event log”.
   - Files: `packages/engine/src/tick.ts`, `packages/engine/src/apply.ts`.

15) **Scenario builder normalization trusts UUIDs even when a geo_region_key is provided**.
   - If the LLM emits arbitrary UUIDs (while also providing geo_region_key), normalization does not reconcile them to the deterministic UUID derived from the key. This can undermine ID stability across runs.
   - Impact: inconsistent geo IDs between runs; tools expecting `geoRegionKey → UUID` determinism may not align.
   - Files: `apps/server/src/lib/geoRegion.ts`, `apps/server/src/routes/llmRoutes.ts` (builder prompt).

## Consistency check summary
- **Docs vs code**: Major mismatch on default LLM provider (README vs env/config). Action effects are described in docs but are mostly no-ops in engine (document or implement).
- **Architecture rules**: EngineContext lacks `now`; schema-first persistence is incomplete for world_state/action_effects.
- **LLM prompt integration**: Suggested action types are generated but not passed into LLM or UI; forbidden actions are never enforced.

## Overall assessment
The repo’s core architecture is coherent and I understand the intended separation: deterministic engine + LLM UX. The implementation largely matches that design, but the findings above show several correctness bugs (double-charged budgets, wrong player nation inference, ignored debt parameters) and a few conceptual mismatches between docs, schemas, and runtime behavior. Addressing the high-severity items will materially improve correctness and determinism.
