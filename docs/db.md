# Persistence and Postgres design (v1)

Primary goals:
- replayability (event log)
- fast loads (weekly snapshots)
- auditability (who decided what, and what changed)

## Strategy: event sourcing + snapshots
- Every week: store `world_state` snapshot (JSONB) for fast map rendering.
- Every action: store action record + computed `action_effects`.
- Keep LLM calls for debugging and evals.

See `apps/server/sql/0001_init.sql` for the minimal schema.

## Decision queue (v2)
- `decision_queue` stores parsed decisions (DecisionParseOutput) and processing status.
- Actions derived from queued decisions are stored in `actions` with status = `queued` until the next tick.

## Portrait cache (v3)
- `portraits` stores generated character portraits per scenario for reuse.
- Rows are keyed by `(scenario_id, character_id)` and store the prompt + base64 image payload.

## Auth + sessions (v4)
- `users` stores email + password hash (scrypt).
- `user_sessions` stores hashed bearer tokens with expiry + revocation.
- `games.user_id` links a game to a player account.
- `users.is_guest` marks guest accounts created automatically.

## Feedback (v6)
- `feedback_items` stores player feedback across all users.
- Captures `game_id`, `scenario_id`, and `turn_index` for context.

## World stat baselines (1492)
- Baseline GDP/population overrides live in `apps/server/data/world_1492_overrides.json`.
- Regenerate with:
  - `node scripts/build-world-1492-overrides.mjs --out apps/server/data/world_1492_overrides.json`
- The generator reads `apps/web/public/data/geo/scenarios/1492/admin0.geojson` and applies a 1492 scaling model so in-game stats are not modern.

## Indices (recommended)
- `turns(game_id, turn_index)` unique (already).
- `tasks(game_id, state, urgency)` for UI queries.
- `decision_queue(game_id, status)` for end-week processing.
- GIN indices on JSONB as needed once query patterns are known.
