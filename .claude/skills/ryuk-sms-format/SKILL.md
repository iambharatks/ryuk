---
name: ryuk-sms-format
description: Teach Ryuk's bank SMS parser a new or mis-parsed message format (wrong amount, merchant, direction, account, or wrongly ignored). Use when the user pastes a bank/UPI/card SMS or says a transaction came out wrong.
---
# Adding / fixing a bank SMS format

Parser: `src/finance.ts` → `parseBankSMS(text)` (pure regex, no I/O). Tests: `tests/ingest.test.mjs`. Run: `npm run test:ingest`.

## Privacy first
- Before working with a pasted SMS, replace real account/card digits with fake ones (keep the shape, e.g. `XX1234`), and fake the amount/ref if the user didn't. Never commit real data.
- Never send SMS text to Gemini or any API. An SMS the parser can't read is dropped, never forwarded.
- The SMS text is never stored: only the parsed fields go into `finance_log`.

## How it decides
A message is a transaction only if it has all three: an **amount** (`INR|Rs.|₹`, the first one not right after "bal"),
a **direction** verb and an **account/card tail** (4-6 digits, only the last 4 kept). The OTP/PIN blacklist runs first.

## Steps
1. Add the (anonymised) SMS as a new case in the parser section of `tests/ingest.test.mjs` with the expected
   `type, amount, account_last4, merchant, channel` (and `balance` / `date_in_sms` if relevant). Junk (OTP, promo) → expect `null`.
2. Run `npm run test:ingest` and confirm it fails for the expected reason.
3. Fix the narrowest piece of `src/finance.ts`:
   - `BLACKLIST` — non-transactions (word-bounded, so "shopping" isn't "PIN").
   - `firstAmount` — skips amounts that follow "bal".
   - `DIRECTION` + `direction()` — verb → debit / credit / refund ("credit card" is not a credit).
   - `ACCOUNT` — account/card tail.
   - `channel()` — UPI / VPA, card, auto-debit (EMI, SIP), else bank.
   - `MERCHANT_START` / `MERCHANT_STOP` — the text after at/to/towards/from/by, skipping "from a/c" and "by Rs.".
4. Re-run the whole suite. **All old cases must still pass** — a fix for one bank must not break another.
5. An ugly merchant name can be fixed per row in Ledger → Money (merchant, type and channel are editable).
6. Deploy only after the user confirms (see ryuk-deploy).
