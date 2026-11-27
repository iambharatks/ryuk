-- Passkey login for the dashboard (replaces Cloudflare Access; Access logins keep working until you switch Access off).
-- Safe to run more than once. Run BEFORE deploying the dashboard:
--   npx wrangler d1 execute ryuk --remote --file=migrations/005_passkeys.sql
CREATE TABLE IF NOT EXISTS auth_credentials (
  id            TEXT PRIMARY KEY,            -- credential ID (base64url)
  public_key    TEXT NOT NULL,               -- COSE public key (base64url)
  counter       INTEGER NOT NULL DEFAULT 0,  -- signature counter (0 for synced passkeys)
  transports    TEXT,                        -- JSON array
  name          TEXT,                        -- "iPhone", "Mac"… as you named it
  created_at    TEXT DEFAULT (datetime('now')),
  last_used_at  TEXT
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash    TEXT PRIMARY KEY,            -- SHA-256 of the cookie value
  credential_id TEXT,                        -- the passkey that opened it (NULL: opened through Cloudflare Access)
  kind          TEXT NOT NULL,               -- browser | app
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,               -- slides forward while in use (30 days idle ends it)
  last_seen_at  TEXT,
  user_agent    TEXT
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge     TEXT PRIMARY KEY,            -- single use, 5 minutes
  purpose       TEXT NOT NULL,               -- login | register | setup
  created_at    INTEGER NOT NULL             -- epoch ms
);
CREATE TABLE IF NOT EXISTS auth_app_codes (
  code_hash     TEXT PRIMARY KEY,            -- one-time code handed to the iOS app (60 s)
  credential_id TEXT,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_throttle (
  key           TEXT PRIMARY KEY,            -- e.g. setup
  n             INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);
