-- Run ONCE on the remote database, BEFORE deploying the dashboard with the pin wall
-- (ALTER TABLE is not idempotent: running it twice fails with "duplicate column", which is harmless).
--   npx wrangler d1 execute ryuk --remote --file=migrations/002_pins_link_position.sql
-- Fresh databases get these columns from schema.sql instead.
ALTER TABLE pins ADD COLUMN link TEXT;
ALTER TABLE pins ADD COLUMN position INTEGER;
