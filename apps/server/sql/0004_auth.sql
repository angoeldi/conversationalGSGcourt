-- User accounts + sessions (v4)

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_idx ON user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS games_user_idx ON games (user_id, created_at);
