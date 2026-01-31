CREATE TABLE IF NOT EXISTS portraits (
  portrait_id UUID PRIMARY KEY,
  scenario_id UUID REFERENCES scenarios(scenario_id) ON DELETE CASCADE,
  character_id UUID NOT NULL,
  prompt TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  size TEXT NOT NULL,
  mime TEXT NOT NULL,
  image_b64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, character_id)
);

CREATE INDEX IF NOT EXISTS portraits_scenario_character_idx ON portraits (scenario_id, character_id);
CREATE INDEX IF NOT EXISTS portraits_character_idx ON portraits (character_id);
