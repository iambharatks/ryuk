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
