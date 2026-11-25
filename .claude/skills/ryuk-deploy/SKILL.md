---
name: ryuk-deploy
description: Deploy Ryuk workers, set secrets, or apply schema changes to the remote D1 database safely. Use when the user says deploy, ship, push live, set a secret, or migrate the database.
---
# Deploying Ryuk safely

Always confirm with the user before any remote action. Show the exact commands first.

## Pre-flight (local, no confirmation needed)
1. `npm run typecheck`
2. `npm run test:sms`
3. `git status` — make sure no secret is staged. Grep the diff for `AIza`, `bot[0-9]+:`, long base64/hex strings. Abort if found.
4. Check both `wrangler.toml` and `dash/wrangler.toml` still contain the user's real IDs locally (not placeholders) — otherwise the deploy will break.

## Schema changes
- Edit `schema.sql` only with `CREATE TABLE/INDEX IF NOT EXISTS`. Never `DROP`.
- Column additions: `ALTER TABLE x ADD COLUMN ...` in a separate file `migrations/NNN_name.sql` (ALTER isn't idempotent). Tell the user it is run once.
- Test locally: `npx wrangler d1 execute ryuk --local --file=schema.sql`
- Remote (after user confirms): `npx wrangler d1 execute ryuk --remote --file=<file>`
- Remind the user: Free plan Time Travel restores only 7 days back. Suggest `npx wrangler d1 export ryuk --remote --output=backup-YYYYMMDD.sql` before risky changes (that file is sensitive; keep it out of git).

## Secrets
- `npx wrangler secret put NAME` (bot) or `npx wrangler secret put NAME --config dash/wrangler.toml` (dashboard). The user pastes the value; never echo it, never put it in a file or command line.
- Generate random keys with letters+digits only (Telegram webhook secret rejects other chars).

## Deploy order
1. Schema (if changed) → 2. `npm run deploy:bot` → 3. `npm run deploy:dash` (dash depends on the bot's `RyukRPC` entrypoint).

## Verify
- `npx wrangler tail` while the user sends a Telegram message.
- Ingest: `curl -X POST https://ryuk.<sub>.workers.dev/ingest/sms -H "X-Ryuk-Key: $KEY" -H "Content-Type: application/json" -d '{"text":"Sent Rs.1.00 From HDFC Bank A/C *0000 To TEST On 25/11/25 Ref 433000000001"}'` → `"status":"recorded"`. Then have the user delete that row in Ledger → Money.
