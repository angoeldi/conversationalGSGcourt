-- Feedback (v6)

CREATE TABLE IF NOT EXISTS feedback_items (
  feedback_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id),
  game_id UUID NOT NULL REFERENCES games(game_id),
  scenario_id UUID NOT NULL REFERENCES scenarios(scenario_id),
  turn_index INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_items_game_idx ON feedback_items (game_id);
CREATE INDEX IF NOT EXISTS feedback_items_created_idx ON feedback_items (created_at);
