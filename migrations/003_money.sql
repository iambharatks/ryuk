-- Money view: categories, investments, rules and budgets for finance_log.
-- Run ONCE on the remote database, BEFORE deploying the bot and the dashboard:
--   npx wrangler d1 execute ryuk --remote --file=migrations/003_money.sql
-- ALTER TABLE is not idempotent: a second run fails with "duplicate column", which is harmless.
-- Fresh databases get all of this from schema.sql instead.
ALTER TABLE finance_log ADD COLUMN category TEXT;
ALTER TABLE finance_log ADD COLUMN invest_class TEXT;
ALTER TABLE finance_log ADD COLUMN category_src TEXT;
ALTER TABLE finance_log ADD COLUMN note TEXT;
CREATE INDEX IF NOT EXISTS idx_finance_category ON finance_log(category);
CREATE TABLE IF NOT EXISTS finance_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL,
  invest_class  TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS finance_budgets (
  category      TEXT PRIMARY KEY,
  monthly_limit REAL NOT NULL
);
