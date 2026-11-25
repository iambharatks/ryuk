# Ryuk v2

Text Ryuk on Telegram; Gemini turns the message into typed rows in Cloudflare D1; a private dashboard shows charts and lets you fix rows. Free.

```
iPhone Telegram --webhook--> ryuk (Worker) --> Gemini (text -> typed events)
                                  |
                                  +--> D1 "ryuk": strength, cardio, meals, water, sleep, time_log, checkins, notes, messages
                                                         ^
Browser --Cloudflare Access login--> ryuk-dash (Worker) --+  charts, filters, edit, delete
```

## Layout
| Path | What |
|---|---|
| `src/index.ts`, `wrangler.toml` | Bot Worker `ryuk` (Telegram webhook, public) |
| `dash/src/index.ts`, `dash/wrangler.toml` | Dashboard Worker `ryuk-dash` (behind Cloudflare Access): page, data API, quick capture, pins |
| `dash/ui/` | Dashboard UI source (React + Tailwind + Lucide). `npm run build:ui` compiles it into `dash/src/page.html` |
| `schema.sql` | D1 tables |

## Bot commands
`/today` today's entries · `/undo` delete the last message and its rows · `/retry` re-parse messages that failed (`needs_review`)

## Setup (from v1)
1. `npx wrangler d1 create ryuk` → paste `database_id` into `wrangler.toml` AND `dash/wrangler.toml`
2. `npx wrangler d1 execute ryuk --remote --file=schema.sql`
3. `npx wrangler deploy` (bot). Optional cleanup: `npx wrangler secret delete NOTION_TOKEN`
4. `npm run deploy:dash` (builds the UI, then deploys the dashboard). Deploy the bot first: the dashboard's
   quick capture calls the bot's private `RyukRPC` entrypoint through a Service Binding.
5. Dashboard → Workers & Pages → ryuk-dash → Settings → Domains & Routes → workers.dev → Enable Cloudflare Access.
   Manage Cloudflare Access: allow only your email. Copy the team domain and the Application Audience (AUD) tag
   into `dash/wrangler.toml` (`TEAM_DOMAIN`, `POLICY_AUD`), then deploy the dashboard again.
6. Open `https://ryuk-dash.<subdomain>.workers.dev`, sign in with the email code.

Never enable Access on the `ryuk` bot Worker: Telegram cannot log in, so the webhook would stop working.

## Updating an existing install
Re-run `npx wrangler d1 execute ryuk --remote --file=schema.sql` (adds the `pins` table; safe to repeat),
then `npx wrangler deploy` and `npm run deploy:dash`.

## UI preview without data
`cd dash/ui && npm run dev`, open the localhost URL: localhost and `?demo` use built-in sample data.

## Finance: bank / card SMS → transactions

`POST /ingest/sms` on the bot Worker. The iPhone forwards bank SMS; a plain-code parser (`src/sms.ts`, no AI)
extracts amount, debit/credit, kind, channel, bank, last-4 of account/card, transaction reference, counterparty,
UPI id, purpose, category and flags. Financial text never goes to Gemini or Telegram.

Tables: `sms_inbox` (redacted SMS + what the parser decided), `transactions`, `merchant_rules` (learned from your
corrections in the dashboard's Ledger → Money tab: rename or recategorise once, it applies to that merchant from then on).

### Setup
1. Generate a key (PowerShell): `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})`
2. `npx wrangler secret put INGEST_KEY` (paste it; keep a copy for the Shortcut)
3. `npx wrangler d1 execute ryuk --remote --file=schema.sql` (adds the finance tables; safe to repeat)
4. `npx wrangler deploy` then `npm run deploy:dash`
5. Test from the laptop:
   `curl -X POST https://ryuk.<subdomain>.workers.dev/ingest/sms -H "X-Ryuk-Key: <key>" -H "content-type: application/json" -d "{\"text\":\"Sent Rs.1.00 From HDFC Bank A/C *1234 To TEST On 01/01/26 Ref 433000000001\"}"`
   Expect `{"status":"recorded",...}`. Delete the test row in Ledger → Money.

### iPhone Shortcut (one per keyword: debited, spent, credited, sent, received)
Shortcuts → Automation → + → Message → Message Contains `debited` → Run Immediately, Notify When Run off →
New Blank Automation → Get Contents of URL:
- URL `https://ryuk.<subdomain>.workers.dev/ingest/sms`, Method POST
- Headers: `X-Ryuk-Key` = your key
- Request Body: JSON → `text` = Shortcut Input (Content), `at` = Current Date

### Settings (wrangler.toml)
`LARGE_TXN_INR` (default 5000) · `FINANCE_ALERTS` ("1" = detail-free Telegram ping for large / international /
possible-duplicate transactions, "0" = off)

### Adding your bank's formats
Add real (redacted) SMS with expected fields to `tests/sms.test.mjs`, run `npm run test:sms`, fix `src/sms.ts`.
Ignored SMS and their reasons are kept in `sms_inbox`, so missed formats are easy to find.

## Apple Health: daily totals → `health_daily`

`POST /ingest/health` with header `X-Ryuk-Key: <HEALTH_KEY>` and a JSON body of daily totals, e.g.
`{"date":"2026-11-25","steps":8432,"active_kcal":512,"exercise_min":41,"distance_km":6.2,"resting_hr":58,"hrv_ms":46,"sleep_min":402,"weight_kg":72.4}`.
All fields optional; strings like `"8,432"` or `"58 BPM"` are accepted; out-of-range values are dropped and listed in `dropped`.
Same date again = update (only the fields you send change). Plain code, never Gemini or Telegram.
Fields: steps, distance_km, flights, active_kcal, resting_kcal, exercise_min, stand_hours, avg_hr, resting_hr, walking_hr,
hrv_ms, vo2max, respiratory_rate, spo2_pct, sleep_min, in_bed_min, weight_kg, body_fat_pct, mindful_min.
Setup: `npx wrangler secret put HEALTH_KEY`, apply `schema.sql`, deploy. Shortcut steps are in the setup doc.

## Text logging Shortcut (alternative to Telegram)

`POST /ingest/log` with header `X-Ryuk-Key: <LOG_KEY>`, body `{"text":"bench 3x10 60"}` → same parsing as Telegram,
returns `{"status":"logged","reply":"✓ strength: ..."}`. Setup: `npx wrangler secret put LOG_KEY`, deploy.

## Batch notes (a whole workout at once)

Paste a multi-line note into Telegram (or send it through the Log Shortcut). Each line is logged at its own time:
```
Push day
18:02 bench 60x10
18:05 bench 65x8
6:40 pm squat 80x5
- lat pulldown 3x12 50      (no time: takes the previous line's time)
```
Optional date header (`24/11`, `2026-11-24`, `kal`, `yesterday`). One Gemini call per paste. Re-sending the same note
only logs new lines (`batch_lines` dedupe), so you can send mid-workout and again at the end. Rest between sets of the
same exercise is filled from the timestamps. `/undo` removes the whole last batch. Tests: `npm run test:batch`.

## Gym mode (Telegram, times captured automatically)

`/gym` (optionally `/gym push day`) → send each set as its own message (`bench 60x10`). Each message is stamped with its
send time and gets a ✍ reaction instead of a reply. `/status` lists the session, `/undo` drops the last set, `/cancel`
discards, `/done` parses everything in one Gemini call and replies with every set plus a session summary.
A session idle for over 3 hours is closed automatically. Commands for BotFather `/setcommands`:
```
gym - start a gym session (times recorded automatically)
done - finish the session and log it
status - show sets in the current session
undo - remove the last entry
cancel - discard the current session
today - what was logged today
retry - re-parse messages that failed
```

## Dashboard Notepad

Dashboard → **Notepad**. Type one set per line; each line is stamped with the time you start typing it (tap a time to
correct it). Lines stay in the browser until you press **Send** (or ⌘/Ctrl+Enter), so a dropped connection loses nothing,
and re-sending is safe. On iPhone, Share → Add to Home Screen. Set the Access session to a week or more so it doesn't ask
you to sign in mid-workout.

## Daily Page and Shelf (v14)

- **Page**: one page per day. Type a line, Enter: it appears in pencil, stamped with the time you began writing it.
  "Write in ink" (or Ctrl/⌘+Enter, or the "Ink as I write" toggle) saves it. Start a line with `[]` (or tap the feather) for
  an intention; ticking it logs it at that moment. Tap any line to fix its words or time, or erase it. ← → or swipe turns pages.
- **Shelf**: books and PDFs with a bookmark page, videos/audio with a timestamp (uploaded ones save their position while
  playing), images and links. Moving forward is also logged as reading/watching time.
- Uploads need R2: enable R2 in the Cloudflare dashboard, then `npx wrangler r2 bucket create ryuk-files` before `npm run deploy:dash`.
- Handoff prompts for Claude Code: `docs/PROMPT-1-handoff.md`, `docs/PROMPT-2-parser-eval.md`, `docs/PROMPT-3-security-scale.md`.
