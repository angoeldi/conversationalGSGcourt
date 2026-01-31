-- Decision queue + processing metadata (v2)

CREATE TABLE IF NOT EXISTS decision_queue (
  decision_id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(game_id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(task_id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  player_text TEXT NOT NULL,
  decision_json JSONB NOT NULL,
  selected_bundle_index INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_turn INT
);

CREATE INDEX IF NOT EXISTS decision_queue_game_status_idx ON decision_queue(game_id, status);
