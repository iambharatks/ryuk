-- iOS app sign-in with a Secure Enclave key (paired once with a code from the website). Safe to run more than once.
-- Run BEFORE deploying the dashboard:
--   npx wrangler d1 execute ryuk --remote --file=migrations/006_app_devices.sql
-- (auth_app_codes from 005 is no longer used; it is empty and harmless.)
-- iOS app: a Secure Enclave key per paired iPhone (public half only). Sessions it opens have credential_id "device:<id>".
CREATE TABLE IF NOT EXISTS auth_devices (
  id            TEXT PRIMARY KEY,            -- random, given to the app when it pairs
  public_key    TEXT NOT NULL,               -- X9.63 uncompressed P-256 point (base64url)
  name          TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  last_used_at  TEXT
);
CREATE TABLE IF NOT EXISTS auth_pairings (
  code_hash     TEXT PRIMARY KEY,            -- SHA-256 of the 6-digit code the website shows (5 min, one use)
  created_at    INTEGER NOT NULL
);
