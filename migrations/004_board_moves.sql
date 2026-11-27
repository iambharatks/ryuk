-- Sticky notes that stay until kept, and can be moved anywhere on the board.
-- Run ONCE on the remote database, BEFORE deploying the dashboard:
--   npx wrangler d1 execute ryuk --remote --file=migrations/004_board_moves.sql
-- ALTER TABLE is not idempotent: a second run fails with "duplicate column", which is harmless.
-- Fresh databases get these columns from schema.sql instead.
ALTER TABLE daily_goals ADD COLUMN done_at TEXT;   -- when it was kept (UTC ISO); it leaves the board after that IST day
ALTER TABLE daily_goals ADD COLUMN x REAL;         -- 0..1 across the board (NULL = not moved yet: auto-placed)
ALTER TABLE daily_goals ADD COLUMN y REAL;         -- px down the board
ALTER TABLE daily_goals ADD COLUMN z INTEGER;      -- stacking order: last moved is on top
