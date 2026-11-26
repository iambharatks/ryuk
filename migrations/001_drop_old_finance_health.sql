-- OPTIONAL, DESTRUCTIVE, run once and only after checking the counts below are 0.
-- Prompt 7 replaced these tables with finance_log and health_log; no code reads them any more.
-- Check first:
--   npx wrangler d1 execute ryuk --remote --command="SELECT (SELECT COUNT(*) FROM transactions), (SELECT COUNT(*) FROM merchant_rules), (SELECT COUNT(*) FROM sms_inbox), (SELECT COUNT(*) FROM health_daily)"
-- Then:
--   npx wrangler d1 execute ryuk --remote --file=migrations/001_drop_old_finance_health.sql
DROP INDEX IF EXISTS idx_txn_at;
DROP INDEX IF EXISTS idx_txn_cp;
DROP INDEX IF EXISTS idx_txn_category;
DROP INDEX IF EXISTS idx_txn_ref;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS merchant_rules;
DROP TABLE IF EXISTS sms_inbox;
DROP TABLE IF EXISTS health_daily;
