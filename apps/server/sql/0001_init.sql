-- The Court: minimal persistence schema (v1)
-- This is intentionally compact; expand as the simulation grows.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  scenario_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  game_id UUID PRIMARY KEY,
  scenario_id UUID REFERENCES scenarios(scenario_id),
  seed BIGINT NOT NULL,
  current_turn INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS turns (
  turn_id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(game_id) ON DELETE CASCADE,
  turn_index INT NOT NULL,
  turn_seed BIGINT NOT NULL,
  date TEXT NOT NULL,
  chronicle_text TEXT NOT NULL DEFAULT '',
  deltas JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id, turn_index)
);

CREATE TABLE IF NOT EXISTS world_snapshots (
  game_id UUID REFERENCES games(game_id) ON DELETE CASCADE,
  turn_index INT NOT NULL,
  world_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, turn_index)
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(game_id) ON DELETE CASCADE,
  nation_id UUID NOT NULL,
  owner_character_id UUID,
  task_type TEXT NOT NULL,
  urgency TEXT NOT NULL,
  state TEXT NOT NULL,
  context JSONB NOT NULL,
  created_turn INT NOT NULL,
  closed_turn INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  message_id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(task_id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  sender_character_id UUID,
  content TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS actions (
  action_id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(game_id) ON DELETE CASCADE,
  turn_id UUID REFERENCES turns(turn_id) ON DELETE SET NULL,
  nation_id UUID NOT NULL,
  type TEXT NOT NULL,
  params JSONB NOT NULL,
  source_task_id UUID,
  status TEXT NOT NULL,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_effects (
  effect_id UUID PRIMARY KEY,
  action_id UUID REFERENCES actions(action_id) ON DELETE CASCADE,
  effect_type TEXT NOT NULL,
  delta JSONB NOT NULL,
  audit JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_calls (
  llm_call_id UUID PRIMARY KEY,
  game_id UUID,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  response_json JSONB,
  tokens_in INT,
  tokens_out INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
