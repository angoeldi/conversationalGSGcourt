---
name: scenario-builder
description: Use when adding or modifying scenario initialization, Wikipedia retrieval, or Scenario schema/prompt.
---

# Scenario Builder skill

## Objective
Build and maintain the scenario initialization pipeline:
- Wikipedia-only retrieval (server-side)
- Builder prompt that produces `Scenario` JSON matching the schema
- Strict schema validation and clear uncertainty notes

## When to use
Trigger on prompts like:
- "Add a new starting era/court"
- "Improve scenario initialization realism"
- "Builder prompt outputs invalid JSON"
- "Change Scenario schema"

## Workflow
1. **Start from contracts**
   - Read `schemas/scenario.schema.json` and `packages/shared/src/schemas/scenario.ts`.
   - Identify any mismatch; fix both sides (JSON Schema + Zod).

2. **Confirm retrieval boundary**
   - Retrieval is Wikipedia-only and server-side:
     - code: `apps/server/src/wiki/wikipedia.ts`
     - routes: `apps/server/src/routes/wikiRoutes.ts`
   - Gameplay LLM must not browse.

3. **Builder endpoint**
   - Update `apps/server/src/routes/llmRoutes.ts`:
     - derive queries
     - fetch summaries
     - inject extracts into the user message
     - call `builderLlm.parseWithSchema(Scenario, ...)`

4. **Prompt hygiene**
   - Keep the builder system prompt short and rule-based.
   - Require `uncertainty_notes` when inventing details.
   - Require `wiki_sources` entries with title+url (+ short excerpt).

5. **Test**
   - Add or update a schema test in `packages/shared/src/schemas.test.ts`.
   - Ensure the endpoint compiles (`pnpm -r typecheck`).

## World stats baselines
- 1492 world GDP/pop baselines come from `apps/server/data/world_1492_overrides.json`.
- If a scenario is set in 1492 and stats feel modern, update overrides (keep nation_id aligned with the geo pack).

## Output expectations
- Scenario JSON always validates.
- Any invented elements are explicitly called out in `uncertainty_notes`.
