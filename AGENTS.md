# The Court: agent instructions

## Repo goals

- Preserve a strict separation between **ground truth simulation** (`packages/engine`) and **LLM-driven UX** (`apps/server`, `apps/web`).
- All world changes occur via **Actions** validated and applied by the engine.
- Determinism matters: random outcomes must be seeded and written to the event log.

## Commands (run these)

- Install: `pnpm install`
- Dev: `docker compose up -d` then `pnpm dev`
- Typecheck: `pnpm -r typecheck`
- Test: `pnpm -r test`

## Local environment note
- In this local environment, the desktop shortcut runs `scripts/run-court.sh`, which auto-starts the dev server and opens the UI tab.

## Validation policy
- Always run `pnpm -r typecheck` and `pnpm -r test` yourself after changes, and report the results (do not ask the user to validate).

## World data notes
- 1492 baselines are seeded from `apps/server/data/world_1492_overrides.json` (GDP/pop). Update this file when recalibrating historical stats.

## Conventions

- Language: TypeScript.
- Validation: use Zod in `packages/shared` and re-export types.
- Do not introduce new core dependencies without a clear reason.
- Keep LLM prompts in `docs/prompts.md` and reference them from code.
- Operational: perform cleanup/restarts yourself (stop servers, free ports, rerun scripts) instead of asking the user to do it, unless blocked by permissions.

## Skills
- Geo pack boundary workflow: `.codex/skills/geo-pack-boundaries` (use when swapping map boundary datasets or remapping scenario regions).

## Architecture rules

1. **Engine is pure**: no network, no DB, no Date.now; everything uses an explicit `EngineContext` containing `turnIndex`, `turnSeed`, and `now`.
2. **Schema-first**: any persisted JSONB must have a schema in `schemas/` and a Zod mirror in `packages/shared`.
3. **No direct state mutation from LLM**: LLM output must be converted to an `ActionBundle` then validated.
4. **Tooling boundaries**:
   - Wikipedia retrieval is server-side (`apps/server/src/wiki`). The gameplay LLM does not browse.

## PR checklist

- Update relevant schema + Zod mirror.
- Add/adjust tests for schema validation and engine invariants.
- Run `pnpm -r test` and `pnpm -r typecheck`.
