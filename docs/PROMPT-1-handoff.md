# Prompt 1 — Handoff to Claude Code (paste this first)

You are taking over **Ryuk**, my personal life-logging system. The code is in this repo (unzipped from `ryuk-v14.zip`).
Read `CLAUDE.md` and `HANDOFF.md` first, then the skills in `.claude/skills/`. Run `npm install`, `(cd dash/ui && npm install)`
and `npm test` before changing anything, and keep `npm test` green after every change.

## What Ryuk is
A single-user, free-tier system that records my day from low-effort phone input and stores it as structured rows:
- **Telegram bot** (`src/index.ts`, Worker `ryuk`): text → Gemini (`responseSchema` JSON) → typed rows in D1.
  Commands `/today /undo /retry`, gym mode `/gym … /done /status /cancel` (each message stamped with its Telegram send time,
  parsed in ONE Gemini call at the end), multi-line pasted notes (`src/batch.ts`: per-line times, dedupe on resend, rest from gaps).
- **iPhone Shortcuts → HTTP ingest**, each with its own secret key: bank SMS `POST /ingest/sms` (regex parser `src/sms.ts`,
  never Gemini), Apple Health daily totals `POST /ingest/health` (`src/health.ts`), text logging `POST /ingest/log`.
- **Dashboard** (`dash/`, Worker `ryuk-dash`) behind Cloudflare Access; the Worker also verifies the Access JWT itself and shows
  `Forbidden (<reason>)` when it fails. React + Vite + Tailwind, built to one HTML file (`npm run build:ui`).
  Views: Gaze (overview), **Page** (daily notebook page), **Shelf**, Notebook (timeline), Ledger (all tables, editable), Eyes (metrics).
- **D1 database `ryuk`** (`schema.sql`, idempotent): messages, strength, cardio, meals, water, sleep, time_log, checkins, body,
  notes, pins, sms_inbox, transactions, merchant_rules, health_daily, batch_lines, live_session, live_lines, tasks, library, library_events.
- **R2 bucket `ryuk-files`** (binding `FILES` on the dashboard) for shelf uploads, served only through the dashboard Worker
  with HTTP Range support (video seeking).

## Hard rules (never break)
1. Financial and Apple Health data never go to Gemini, Telegram, logs, or any third party. Telegram finance alerts carry no amount/merchant.
2. Store the minimum: last 4 digits only, never OTPs/PINs/passwords/full account numbers; SMS text is redacted before storage.
3. Secrets only via `npx wrangler secret put`. Never in code, config, tests, commits or chat output.
4. Every endpoint authenticated (Telegram secret token + OWNER_CHAT_ID; per-source X-Ryuk-Key with constant-time compare; Access JWT on the dashboard).
5. **A log must never be lost**: the raw text is stored first (`messages`), parsing comes second, failures stay as `needs_review`.
6. Ask me before any deploy, `--remote` database command, secret change, `git push`, or anything destructive.
7. Original visual design only: Death-Note-*inspired* mood, but no copyrighted characters, logos or the manga's lettering.
8. Stay on free tiers unless I agree to pay; say so before anything would cost money.

## Current state (v14)
Done and covered by tests (`npm test` = SMS parser 23 cases + batch/gym mode + dashboard API end-to-end with a real
Access JWT check, fake D1 on `node:sqlite`, in-memory R2 and a stubbed Gemini):
- v9 detailed schema (cardio pace/cadence/HR/splits, strength set_detail/volume/RPE, meal macros, sleep quality, body table).
- v10 health + text ingest; v11 batch notes; v12 Telegram gym mode; v13/v14 dashboard daily Page + Shelf backend:
  `GET /api/page?day=`, `PATCH /api/entry` (re-parses an edited line via bot RPC `relog`), `/api/tasks` (ticking a task logs
  it at that moment via RPC `captureOne`; unticking removes the log), `/api/library` + `/api/library/progress`
  (moving a bookmark/timestamp forward also writes reading/watching time to `time_log`), `/api/upload`, `/api/file/<key>`.
- UI: `dash/ui/src/components/DeathPage.tsx` (paper page, handwriting font *Nothing You Could Do*, pencil drafts kept in
  localStorage, ink sweep on save, pen-nib writing animation, struck-through intentions, tap-to-edit text and time, erase,
  page turn between days, swipe on mobile, "Ink as I write" toggle) and `Shelf.tsx` (books/PDFs with bookmark page, videos and
  audio with timestamps and an auto-saving player, images, links, uploads with progress, PDF page-count and media-duration
  detection). `src/store.ts` gives both an API store and an in-memory demo store (localhost or `?demo`).
- Verified in a browser in demo mode (desktop + 390 px): Page works with no console errors. **Shelf not visually verified yet.**

Deployment status: bot deployed and logging from Telegram. Dashboard was returning `Forbidden` (email matches, so
POLICY_AUD / TEAM_DOMAIN in `dash/wrangler.toml` are suspect); the v14 build shows the exact reason code.

## Your tasks, in this order
1. **Get the dashboard in.** Help me read the `Forbidden (<reason>)` code and fix `dash/wrangler.toml`. Then deploy v14:
   `npx wrangler r2 bucket create ryuk-files` (R2 must be enabled in the Cloudflare dashboard first),
   `npx wrangler d1 execute ryuk --remote --file=schema.sql`, `npm run deploy:bot`, `npm run deploy:dash` (ask me first).
2. **Verify the Shelf UI** in demo mode with Playwright at 1280 px and 390 px (add a dev script for it). Fix layout bugs.
3. **Editable intentions:** the "Apples & Omens" pins in `Overview.tsx` must be editable (title, note, kind, image) and
   deletable, and accept uploaded images. Active shelf items should appear there instead of time_log-derived "books".
4. **Never miss a log** (highest priority after deploy):
   - Unique index on `messages(tg_message_id)` where not null, so Telegram redeliveries can't double-log.
   - If the model returns zero events or invalid JSON for text that clearly contains an activity (numbers, known verbs),
     try the fallback model, then mark `needs_review` instead of silently storing nothing.
   - Hourly cron: auto-retry `needs_review` messages (max 3 attempts, exponential backoff, attempt count column).
   - Daily 22:00 summary includes "N lines not understood" with a one-tap `/retry`.
   - A "Not understood" filter on the dashboard Page and Ledger.
5. **Parser quality:** run Prompt 2 (`docs/PROMPT-2-parser-eval.md`) and switch to the best model it finds.
6. **Encryption, compression, scale:** implement Prompt 3 (`docs/PROMPT-3-security-scale.md`).
7. Automated nightly encrypted backup (public-key encryption so the Worker can't decrypt; R2 + weekly local copy).
8. Later (ask me first): UI restructure into Today / Body / Mind / Coin / The Arc; Workers AI as a private alternative to Gemini.

Work in small, reviewable steps; after each, update `HANDOFF.md` (what's done, what's next) and tell me exactly what to run.
