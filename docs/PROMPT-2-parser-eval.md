# Prompt 2 — Test the parser from Telegram and pick the best model

Goal: make sure **no log is missed** and fields are right. Missing an event is worse than a slightly wrong number.

## Part A — an offline evaluation harness (build this first)
1. Create `tests/parser-golden.jsonl`: at least 80 real-style messages with the expected events. Cover:
   - English, Hindi, Hinglish, typos, voice-dictation style ("ran five k in thirty minutes").
   - Multi-event lines ("bench 3x10 60, then 20 min treadmill, 2 roti dal for lunch").
   - Every type: strength (incl. `60x8, 70x6, 80x5`, bodyweight, RPE), cardio (pace `5:32/km`, cadence, avg/max HR, splits,
     intervals), meals (estimates must exist), water, sleep (bed/wake, "kal raat", naps), time (deep work topics, reading pages,
     screen time), check-ins (1–5), body (weight), notes/ideas.
   - Edge cases: yesterday/"kal", times written inside the text, ambiguous lines, empty-ish lines ("rest", "ok").
   - Batch prompts (numbered lines with `line` field) and gym-mode style one-set-per-line input.
   Expected output = list of `{type, key fields}`; numbers with tolerances (meal estimates ±40 %, durations exact).
2. Create `scripts/eval-parser.mjs` that, for a given `--model`, sends each message through the **same** PROMPT +
   responseSchema the bot uses (import them; don't copy), and reports:
   - **Event recall** (expected events found, matched by type + main field) — the key metric, target ≥ 98 %.
   - Precision (no invented events), type accuracy, field accuracy per type, JSON/schema validity rate.
   - Latency p50/p95, failures (429/5xx/timeouts), and requests used.
   - A per-message diff for every miss so the prompt can be fixed.
   Throttle to stay inside free-tier limits; cache results per model+prompt hash so reruns don't spend quota.
   Read `GEMINI_API_KEY` from `.dev.vars` (gitignored), never print it.
3. List models available to my key (`GET https://generativelanguage.googleapis.com/v1beta/models`) and evaluate every
   current Flash-Lite and Flash model, plus at least two Workers AI instruct models (via the Cloudflare REST API with a
   scoped token in `.dev.vars`) as a private alternative.
4. Decision rule: highest event recall; ties broken by field accuracy, then p95 latency, then free daily request
   headroom for my usage (~40 messages/day plus retries). The primary must also be reliable (≥ 99 % valid JSON).
   The fallback must be a **different** model family/provider so one outage doesn't stop parsing.
5. Fix the prompt for the systematic misses you find, re-run, and show me a before/after table. Update
   `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` in `wrangler.toml` only after I approve.

## Part B — live test from Telegram (I send, you check)
Give me a numbered checklist of ~30 messages to send to the bot over a day (and one gym session with `/gym … /done`,
one pasted multi-line note, one `/undo`, one `/retry`). For each, the expected rows. Then write
`scripts/check-live.sql` I can run with `npx wrangler d1 execute ryuk --remote --file=scripts/check-live.sql` that lists:
messages from the test window, their status, and the rows each produced (per table), plus any message with zero rows.
Compare against the expected list and report misses, wrong fields and wrong timestamps (IST).

## Part C — make misses visible forever
- Every message with zero parsed rows (and not a command) is `needs_review`, shown in the dashboard and in the 22:00 summary.
- Add a tiny weekly stat: messages, parsed %, needs_review count, retries, model used — so a model getting worse is noticed.
