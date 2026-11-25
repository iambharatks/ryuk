---
name: ryuk-sms-format
description: Teach Ryuk's bank SMS parser a new or mis-parsed message format (wrong amount, merchant, direction, ref, or wrongly ignored). Use when the user pastes a bank/UPI/card SMS or says a transaction came out wrong.
---
# Adding / fixing a bank SMS format

Parser: `src/sms.ts` (pure, no I/O). Tests: `tests/sms.test.mjs`. Run: `npm run test:sms`.

## Privacy first
- Before working with a pasted SMS, replace real account/card digits with fake ones (keep the shape, e.g. `XX1234`), and fake the amount/ref if the user didn't. Never commit real data.
- Never send SMS text to Gemini or any API.

## Steps
1. Add the (anonymised) SMS as a new case in `tests/sms.test.mjs` with the expected fields:
   `amount, direction, kind, channel, bank, account_last4|card_last4, txn_ref, counterparty, vpa, purpose, category`.
   For junk (OTP, reminder, declined, promo) add it to the reject list with the expected reason.
2. Run `npm run test:sms` and confirm it fails for the expected reason.
3. Fix the narrowest function in `src/sms.ts`:
   - `REJECT` — non-transactions (otp, reminder, request, declined, mandate_setup, advert).
   - `findAmount` — skips numbers after bal/limit/avl.
   - `findDirection` — prefer the verb attached to account/card.
   - `BANKS`, `findLast4`, `findRef` (UPI/RRN/UTR/ref), `findChannel` (12-digit ref ⇒ UPI).
   - `findCounterparty` / `findPurpose` — stop at `.` or `;` so balance text isn't swallowed.
   - `findKind` — refund, cash_withdrawal, card_payment, transfer (self/own a/c), investment, income, spend.
   - `CATEGORIES` — regex → category map for merchants.
4. Re-run the whole suite. **All old cases must still pass** — a fix for one bank must not break another.
5. If a merchant name is just ugly (e.g. `PAYTMQR281005`), don't hard-code it: tell the user to rename it once in Ledger → Money; that creates a `merchant_rules` row automatically.
6. Deploy only after the user confirms (see ryuk-deploy).
