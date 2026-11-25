---
name: ryuk-new-log-type
description: Add a new kind of life log to Ryuk end to end — Gemini schema, D1 table, insert, dashboard API and UI tab. Use when the user wants to start tracking something new (e.g. supplements, meditation, expenses by hand, health metrics).
---
# Adding a new log type

Touch points, in order:

1. **schema.sql** — new table `CREATE TABLE IF NOT EXISTS <name> (id INTEGER PRIMARY KEY, message_id INTEGER, logged_at TEXT NOT NULL, ...)` plus `CREATE INDEX IF NOT EXISTS idx_<name>_logged ON <name>(logged_at)` and an index on `message_id`.
2. **src/index.ts**
   - Add the type to the event `type` enum in the Gemini `responseSchema` and any new fields (use `str()` / numeric helpers, nullable).
   - Extend `PROMPT` with 2–3 Hinglish examples of how the user would type it.
   - Add a `case` in `insertFor()`.
   - Include it in `/today` and the daily summary if useful.
   - `deleteMessageRows` must delete from the new table (for /undo).
3. **dash/src/index.ts**
   - Add to `EVENT_TABLES` (used for data fetch, daily counts, and cascading deletes).
   - Add editable fields to `EDITABLE`; numeric ones to `NUMERIC`.
4. **dash/ui/src/data.ts** — add the type to `Data`, include it in `allEvents()` and `demoData()`.
5. **dash/ui/src/components/Views.tsx** — add a tab to `TABS` in the Ledger (VaultView).
6. Verify: `npm run typecheck`, `npm run build:ui`, local `wrangler dev` + `d1 execute --local --file=schema.sql`, send a test message.
7. Give the user the remote schema command + deploy steps; don't run them unasked.

Health/finance-like data that must not go to Gemini → don't use the Telegram/Gemini path; add an authenticated ingest route like `src/ingest.ts` instead.
