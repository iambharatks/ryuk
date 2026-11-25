# Handoff — where Ryuk setup stands (2026-11-25)

Read CLAUDE.md first. This file is the progress log from the claude.ai planning chat; update it as steps finish.
Full step-by-step guide: "Ryuk v8 — Setup from scratch" doc (https://claude.ai/artifact/7ZoexzWQPbK6PzubJwSaGk).

## Done
- Step 1: accounts locked (Cloudflare authenticator-app 2FA; Telegram two-step password + passkey). Google/GitHub 2FA: confirm with Bharat.
- Step 2: v9 code in `E:\Ryuk`, `npm install` done, `npm run typecheck` passes.
- Step 3: D1 database `ryuk` created, `schema.sql` (v9, 14 tables incl. `body`) applied remotely.
- Step 4: bot deployed and webhook working. Gemini prompt fixed (required fields, voice dictation rules, at_time field).
  Primary model swapped to `gemini-3.5-flash-lite` (reliable); `gemini-3.8-flash` is fallback.
  Test rows verified: cardio pace 332, cadence 172, avg_hr 158, max_hr 176; strength sets 3, reps 10, volume_kg 1800.
  `npm run test:sms` → 23 passed. `build:ui` script fixed for Windows (`cp` → `node -e fs.copyFileSync`).
- Step 5: dashboard deployed at https://ryuk-dash.iambharatks.workers.dev behind Cloudflare Access.
  TEAM_DOMAIN=iambharatks.cloudflareaccess.com; POLICY_AUD from "ryuk-dash - Cloudflare Workers" app (2845e...).
  Second duplicate Access app (b2e5d...) can be deleted.

## Next
- Step 6: INGEST_KEY secret → `npm run deploy:bot` → laptop test → iPhone automations (debited/spent/credited/sent/received).
- Step 7: commit + push (scan for secrets first). Step 8: Claude Code already running. Step 9: weekly encrypted backup.
- Cleanup: remove debug auth logging from `dash/src/index.ts` and redeploy dash (done in this session).
- Backlog: bad test rows in D1 (messages 1–33, sparse cardio/strength) can be deleted when convenient.

## Decisions already made (don't re-ask)
- v9 schema adds: cardio pace (sec/km, computed in code if missing), cadence_spm, max_hr, elevation, splits, rpe,
  workout_type, setting; strength muscle_group, equipment, set_detail, volume_kg (computed), rpe, rest_sec;
  meals calories/carbs/fat/fiber estimates + source; sleep quality/awakenings/is_nap; time_log focus_quality,
  output, start_time; checkins add stress/soreness/motivation (scale stays 1-5); new `body` table.
- Finance stays regex-only, never Gemini/Telegram. Telegram finance alerts carry no amount or merchant.
- UI comes after functionality. Planned sections: Today, Body, Mind, Coin, The Arc; Shinigami Eyes global; Ledger behind an icon.
- Backlog: automated nightly encrypted backup (public-key encryption, R2), Body charts for pace/cadence/volume,
  health ingest via Shortcuts, portfolio (broker not chosen yet).
