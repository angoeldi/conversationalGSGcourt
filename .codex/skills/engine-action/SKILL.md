---
name: engine-action
description: Use when adding a new action type, changing action params, or implementing engine effects.
---

# Engine Action skill

## Objective
Add or modify action types without breaking determinism or schema contracts.

## Trigger examples
- "Add an action to embargo a nation"
- "Implement effects for crackdowns"
- "Decision parser should emit a new action"

## Workflow
1. **Schema-first**
   - Update Zod action catalog: `packages/shared/src/schemas/action.ts`.
   - Update JSON Schema mirror: `schemas/action.schema.json`.
   - Update docs: `docs/actions.md`.

2. **Engine implementation**
   - Add/modify handling in `packages/engine/src/apply.ts` (and/or split into per-action modules).
   - If the action creates multi-week consequences, represent it as an `Operation` and resolve it in `packages/engine/src/tick.ts`.

3. **Validation rules (preconditions)**
   - Enforce treasury and capacity constraints in engine code (not in prompts).
   - Reject impossible geography (unknown province ids, invalid deployments).

4. **Determinism**
   - Any randomness must derive from `turn_seed` and action params (stable key).
   - Log all RNG rolls in `audit` for replay/debug.

5. **Tests**
   - Add a targeted test in `packages/engine/src/engine.test.ts`.
   - Run: `pnpm -r test`.

## Output expectations
- New action parses, validates, and applies with logged effects.
- No new non-deterministic sources (Date.now, Math.random).
