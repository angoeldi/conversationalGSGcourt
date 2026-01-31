---
name: evals
description: Use when adding automated tests for LLM contracts, schema compliance, or regression checks.
---

# Evals skill

## Objective
Make LLM behavior measurable and regressions obvious.

## Trigger examples
- "Decision parser started producing invalid JSON"
- "Builder scenario output violates schema"

## Workflow
1. Test contracts at the boundary
   - Validate JSON against Zod schemas in `packages/shared`.

2. Golden test corpora
   - Store small fixtures of (input → expected JSON) in `apps/server/src/evals/fixtures`.

3. Add non-LLM property tests where possible
   - Engine invariants: no negative populations, treasury updates consistent.

4. Run tests
   - `pnpm -r test`

## Output expectations
- Tests fail loudly on schema violations.
- Tests are deterministic (no live API calls in CI by default).
