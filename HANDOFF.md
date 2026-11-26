# Handoff — where Ryuk setup stands (2026-11-26)

Read CLAUDE.md first. This file is the progress log; update it as steps finish.
Full step-by-step guide: "Ryuk v8 — Setup from scratch" doc (https://claude.ai/artifact/7ZoexzWQPbK6PzubJwSaGk).
Roadmap prompts live in `docs/` (PROMPT-1 … PROMPT-8).

## Done
- Steps 1–5: accounts locked, D1 `ryuk` created, bot deployed with webhook, dashboard live behind Cloudflare Access
  (POLICY_AUD is the auto-created "ryuk-dash - Cloudflare Workers" app; the duplicate plain "ryuk-dash" app can be deleted).
- Parser: every schema field is `required` (lite models skip optional numbers otherwise), `at_time` for "subah 7 baje…",
  rules 7–10 for messy/voice input, primary `gemini-3.5-flash-lite`, 15 s timeout.
- v14 code deployed (gym mode, batch notes, Page, Shelf). R2 binding is commented out in `dash/wrangler.toml`
  until R2 is enabled; uploads have a 7 GB quota and monthly Class A/B op caps (`r2_ops` table).
- Prompt 4 step 1 + Prompt 6: Gaze restyle, notebook-on-desk opening animation (transform/opacity only),
  Page view page-turn leaf, ink/paper polish, tab fade. Deployed.
- Prompt 7 (code done, NOT deployed): finance and health ingest replaced.
  - `/ingest/finance` (also `/ingest`, `/ingest/sms`): `src/finance.ts` regex parser → `finance_log`. Never Gemini; SMS text never stored;
    resends deduped by an HMAC of the SMS; Telegram gets only "💰 Finance entry logged".
  - `/ingest/health`: Shortcut keys (camelCase or snake_case, e.g. `excerciseMinutes`) → `health_log`, one row per IST day. No Telegram.
  - `/ingest/log`: Gemini path, returns `{ok, category, summary}`, reply also sent to Telegram.
  - Auth `Authorization: Bearer <key>` (X-Ryuk-Key still accepted). Dashboard: `GET /api/health?range=7d`, `GET /api/finance?range=30d`.
  - Old `src/sms.ts`, `tests/sms.test.mjs`, merchant rules, `transactions`/`sms_inbox`/`merchant_rules`/`health_daily` are gone from code
    (the remote tables still exist, empty).
- Prompt 8 (code done, NOT deployed): Gaze is a workspace — vitals strip (numbers only, tap for 7 days), goals board
  (sticky notes, `daily_goals`, `/api/goals`), pin wall (posters, reuses `pins`, `/api/pins/:id`, linked images copied to R2 when on).
  Today's Entries, Vital Readings card and Apples & Omens card removed from Gaze.
- `npm test` = ingest (parser + endpoints) + batch + dashboard API, all passing.

## Next (in this order; each remote step needs Bharat's OK)
1. `npx wrangler d1 execute ryuk --remote --file=schema.sql`  (adds finance_log, health_log, daily_goals; idempotent)
2. `npx wrangler d1 execute ryuk --remote --file=migrations/002_pins_link_position.sql`  (once; adds pins.link, pins.position)
3. `npm run deploy:bot` then `npm run deploy:dash`
4. Secrets if not set yet: `npx wrangler secret put INGEST_KEY`, `HEALTH_KEY`, `LOG_KEY`
5. Optional: `migrations/001_drop_old_finance_health.sql` (drops the four old empty tables; check counts first)
6. Shortcuts: Health Watcher → `/ingest/health` with `Authorization: Bearer <HEALTH_KEY>`; bank SMS automation → `/ingest/finance`.
7. Not visually verified in a browser yet (no Playwright here): Prompt 6/8 layouts at 1280 px and 390 px, sticky notes, pin wall.
8. Later: Prompt 2 (parser eval), Prompt 3 (encryption/backups), rest of Prompt 4 (pacts, art slots, motion lab).

## Decisions already made (don't re-ask)
- Finance is regex-only: unparsed SMS are dropped, never sent to Gemini. Telegram finance pings carry no amount/merchant/account.
- Health data never goes to Gemini or Telegram (no "health synced" message either).
- Bharat chose Prompt 7's tables over the old ones ("replace"), accepting the loss of merchant rules and SMS flags.
- Goals board: each day starts empty (no carry-over). Page "intentions" (tasks table) are separate and still log when ticked.
- Character art: Claude won't draw copyrighted characters; art slots (Prompt 4 §6) are for art Bharat supplies.
- Proposed, waiting for go-ahead: Workers AI as a private alternative to Gemini.
