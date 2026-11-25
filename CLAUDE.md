# Ryuk — personal life-logging system (owner: Bharat)

Ryuk records everything about one person's life (gym, food, sleep, reading, time, mood, money)
from low-effort phone input and stores it as structured rows for later analysis.
Single user. Free tier only. Privacy is the top constraint.

## Architecture
```
iPhone Telegram ──webhook──▶ ryuk (Worker, src/index.ts) ──Gemini Flash-Lite──▶ JSON events ──▶ D1 "ryuk"
iPhone bank SMS ──Shortcut POST /ingest/sms    (X-Ryuk-Key = INGEST_KEY)──▶ src/ingest.ts ──regex parser src/sms.ts──▶ D1
iPhone Health   ──Shortcut POST /ingest/health (X-Ryuk-Key = HEALTH_KEY)──▶ src/health.ts ──plain code──▶ D1 health_daily
iPhone text     ──Shortcut POST /ingest/log    (X-Ryuk-Key = LOG_KEY)────▶ same Gemini path as Telegram
Browser ──Cloudflare Access (Google login, one email)──▶ ryuk-dash (dash/src/index.ts) ──▶ D1
                                                         └─ Service Binding RPC BOT.capture() → ryuk
Cron 30 16 * * * (22:00 IST) ──▶ daily summary to Telegram
```
- Bot worker: `src/index.ts` (Telegram, Gemini, /today /undo /retry, `RyukRPC` entrypoint, cron).
- Batch notes: `src/batch.ts` (pure line/time parsing) + `logBatch()` in `src/index.ts`: a multi-line paste becomes one message per line at its own time, ONE Gemini call, dedupe via `batch_lines`, rest_sec from gaps, `/undo` removes the whole batch.
- Gym mode (Telegram): `/gym [label]` opens a session; each message is buffered in `live_lines` with Telegram's send time and gets a ✍ reaction (no reply); `/status`, `/undo` (last set), `/cancel`, `/done` → `logLines()` in one Gemini call. Sessions idle > 3 h auto-close (next message or cron).
- Dashboard Page (`DeathPage.tsx`): lines stamped when you start typing, pencil drafts in localStorage, ink = POST `/api/notepad` → `BOT.captureLines()`; edits via `/api/entry` → `BOT.relog()`; tasks via `/api/tasks` (`BOT.captureOne()` when ticked).
- Shelf (`Shelf.tsx`, `dash/src/extra.ts`): library items, progress → library_events + time_log; uploads to R2 `FILES`, served with Range by `/api/file/<key>`.
- `dash/ui/src/store.ts`: API store and in-memory demo store with the same interface.
- Finance: `src/sms.ts` (pure, deterministic parser) + `src/ingest.ts` (auth, dedupe, flags, rules).
- Dashboard worker: `dash/src/index.ts` (Access JWT verify, `/api/data`, `/api/row` PATCH/DELETE, `/api/pins`, `/api/capture`). Serves one inlined HTML file `dash/src/page.html`.
- UI: `dash/ui/` React 18 + Vite + Tailwind 3 + lucide-react, built to a single file (vite-plugin-singlefile). Death Note–inspired original theme ("Obsidian Archive").
- Schema: `schema.sql` (idempotent `CREATE ... IF NOT EXISTS`). Tables: messages, strength, cardio (pace in sec/km, cadence, HR, splits), meals (kcal + macro estimates), water, sleep, time_log, checkins, body, notes, pins, sms_inbox, transactions, merchant_rules, health_daily, batch_lines, live_session, live_lines (one row per IST day, upserted). Both workers share D1 database `ryuk`.

## Hard rules (do not break)
1. **Financial and Apple Health data never go to Gemini, Telegram, logs, or any third party.** Finance alerts to Telegram carry no amount/merchant. Each Shortcut source has its own key.
2. Store the minimum: never full account/card numbers, OTPs, PINs, passwords. Keep last 4 only; `redact()` before storing SMS text.
3. **Secrets only via `npx wrangler secret put`.** Never write keys/tokens into `wrangler.toml`, code, tests, or commits (a leaked Gemini key already hit GitHub push protection once). Secrets: TELEGRAM_TOKEN, WEBHOOK_SECRET, GEMINI_API_KEY, INGEST_KEY, HEALTH_KEY, LOG_KEY.
4. Every new endpoint must be authenticated (Telegram secret_token + OWNER_CHAT_ID, X-Ryuk-Key constant-time compare, or Access JWT). Never weaken CSP or Access checks.
5. Never run remote destructive SQL (`DROP`, `DELETE`, `--remote` schema changes) or deploy without asking the user first.
6. No copyrighted characters/art/lettering in the UI. Original "Watcher" figure, Jacquard 24 font only.
7. Stay on free tiers (Workers Free, D1 Free: 7-day Time Travel; Gemini free RPD). Flag anything that would cost money.

## Conventions
- TypeScript, no framework on Workers. Times stored as UTC ISO strings; display/aggregate in IST (`+330 minutes`).
- D1: no giant `UNION` views (hit "too many terms in compound SELECT"); use per-table `DB.batch()`.
- Telegram webhook: process **before** returning the response (`waitUntil` was cut off at ~30 s).
- Gemini: primary `GEMINI_MODEL`, fallback `GEMINI_FALLBACK_MODEL`, per-model timeout, fall back on 429/404/5xx/timeout. Uses `responseSchema` JSON.
- Ingest endpoint always returns 200 `{status}` for authenticated valid requests (recorded|duplicate|ignored|unparsed) so the iPhone Shortcut never errors.
- Dashboard edits go through the `EDITABLE` whitelist in `dash/src/index.ts`; numeric fields listed in `NUMERIC`. Editing a transaction's counterparty/category/kind upserts a `merchant_rules` row.
- The user's real IDs (OWNER_CHAT_ID, database_id, TEAM_DOMAIN, POLICY_AUD) live only in their local `wrangler.toml` files. Keep placeholders in anything shipped.

## Commands
```bash
npm install
npm run typecheck                 # tsc --noEmit
npm run test:sms                  # SMS parser tests (tests/sms.test.mjs)
npm run test:batch                # batch notes end-to-end on a fake D1 + stubbed Gemini (tests/batch.test.mjs)
npm run test:dash                 # dashboard API end-to-end (JWT, page, tasks, shelf, uploads)
npm test                          # all
npx wrangler dev                  # local bot (use .dev.vars for local secrets, gitignored)
npx wrangler d1 execute ryuk --local  --file=schema.sql
npx wrangler d1 execute ryuk --remote --file=schema.sql   # ASK FIRST
npm run deploy:bot                # ASK FIRST
npm run deploy:dash               # builds UI then deploys dashboard; ASK FIRST
npm run build:demo                # offline demo UI with sample data (VITE_DEMO=1)
npx wrangler tail                 # live logs
```

## Before saying a change is done
- `npm run typecheck` passes; `npm run test:sms` passes if `src/sms.ts` changed.
- New SMS format → add a case to `tests/sms.test.mjs`.
- Schema change → add to `schema.sql` idempotently and tell the user the exact remote command to run.
- UI change → `npm run build:ui` succeeds and `dash/src/page.html` is updated.

## Setup progress
See HANDOFF.md for what is done and what is next.

## Project skills (in .claude/skills/)
- `ryuk-deploy` — safe deploy/secret/schema routine.
- `ryuk-sms-format` — teach the parser a new bank SMS format.
- `ryuk-new-log-type` — add a new kind of life log end to end (Gemini → table → dashboard).
- `ryuk-dashboard-ui` — UI structure, theme tokens, planned Today/Body/Mind/Coin/The Arc sections.
