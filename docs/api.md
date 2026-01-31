# Server API (v1)

Base URL (dev): `http://localhost:8787`

## Health
- `GET /health` → `{ ok: true }`

## Auth
- `POST /api/auth/register` {email, password, display_name?} → {token, expires_at, user}
- `POST /api/auth/login` {email, password} → {token, expires_at, user}
- `POST /api/auth/guest` → {token, expires_at, user}
- `POST /api/auth/promote` {email, password, display_name?} → {token, user}
- `POST /api/auth/logout` (Authorization: Bearer token) → {ok: true}
- `GET /api/auth/me` (Authorization: Bearer token) → {user}

## Wikipedia (builder only)
- `GET /api/wiki/search?q=...&limit=...` → `{ results: [{title,snippet}...] }`
- `GET /api/wiki/summary?title=...` → `{ title, url, extract }`

## LLM
- `POST /api/builder/init-scenario` (builder model + wiki grounding) → `Scenario`
- `POST /api/llm/decision-parse` (game model; structured output) → `DecisionParseOutput`
- `POST /api/llm/court-chat` (game model; structured output) → `CourtChatOutput`
- LLM overrides are sent via headers: `x-llm-provider`, `x-llm-api-key`, `x-llm-model`, `x-llm-base-url`.
- `Authorization` is reserved for user auth and is not used for LLM keys.

JSON Schemas are in `schemas/`.

## Scenarios
- `GET /api/scenarios/default` → `Scenario`
- `POST /api/scenarios` {scenario, seed?} → {scenario, world_state, tasks, current_turn, nation_directory, game_id, scenario_id}
  - Experimental: requires `SCENARIO_BUILDER_ENABLED=true` on the server.

## Game
- `GET /api/game/state?game_id=` → {scenario, world_state, tasks, current_turn, nation_directory, game_id, scenario_id}
- `POST /api/game/decisions/queue` {task_context, player_text, stage, transcript, game_id?} → {decision, queued_actions}
- `task_context.story` (optional) includes storyline continuity for petitions, including recent history and any prior conversation transcripts.
- `POST /api/game/advance-week` (body: `{ auto_decide_open?: boolean, game_id?: string }`) → {turn_index, processed_actions, processed_decisions, auto_decided_tasks, rejected_actions}
- `GET /api/game/action-log?limit=50&offset=0&game_id=` → {entries}
- Game access is scoped to the bearer session (including guests); `game_id` is validated against ownership.

### Game option headers
Optional headers that influence task generation and decision parsing:
- `x-petition-inflow`: `low` | `normal` | `high`
- `x-petition-cap`: integer cap on open petitions (default 10)
- `x-freeform-delta-limit`: `1` to cap freeform deltas
- `x-strict-actions-only`: `1` to disallow freeform actions
- `x-court-churn`: `1` to allow visible court churn

## Feedback
- `POST /api/feedback` {message, game_id?} → {ok: true, feedback_id}

## Portraits
- `POST /api/portraits/generate` {prompt, provider?=openai|hf, model?, size?} → {mime, b64, data_url}
- `GET /api/portraits/:characterId?provider?=openai|hf&model?&size?&refresh?&game_id?` → {character_id, prompt, provider, model, size, mime, b64, data_url}
- Optional headers: `x-portrait-api-key`, `x-portrait-base-url` to override image provider credentials.
