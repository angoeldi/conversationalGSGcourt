-- Guest users (v5)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS users_guest_idx ON users (is_guest);
