# Architecture overview

## Separation of concerns

- **Engine (`packages/engine`)**: deterministic simulation core. No network, no DB, no Date.now. Inputs are explicit and seeded.
- **Server (`apps/server`)**: persistence + LLM orchestration + API surface. Owns Postgres and Wikipedia retrieval.
- **Web (`apps/web`)**: UI/UX only. Presents state, gathers player input, calls APIs.

## State flow

1. Player submits intent.
2. LLM parses intent into a structured decision.
3. Server converts decision → Action bundles.
4. Engine validates and applies Actions.
5. Server stores action logs + world snapshots.

## Determinism rules

- All stochastic behavior must be seeded and recorded.
- Engine outputs must be reproducible from inputs + seeds.

## Schema-first persistence

- Persisted JSON is defined in `schemas/`.
- Zod mirrors live in `packages/shared` and should be used at boundaries.
