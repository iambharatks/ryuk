# Handoff — where Ryuk setup stands (2026-11-25)

Read CLAUDE.md first. This file is the progress log from the claude.ai planning chat; update it as steps finish.
Full step-by-step guide: "Ryuk v8 — Setup from scratch" doc (https://claude.ai/artifact/7ZoexzWQPbK6PzubJwSaGk).

## Done
- Step 1: accounts locked (Cloudflare authenticator-app 2FA; Telegram two-step password + passkey). Google/GitHub 2FA: confirm with Bharat.
- Step 2: v9 code in `E:\Ryuk`, `npm install` done, `npm run typecheck` passes.
- Step 3: D1 database `ryuk` created, `schema.sql` (v9, 14 tables incl. `body`) applied remotely.
- Step 4: bot deployed and webhook working. Test message
  `10k 55:20 avg 5:32 cadence 172 hr 158 max 176, then bench 3x10 60` produced one cardio + one strength row.

## Next
- Verify the test rows' values (cardio: pace 332, cadence 172, avg_hr 158, max_hr 176; strength: volume_kg 1800).
  If Gemini misses fields, tune PROMPT in `src/index.ts`.
- Confirm `npm run test:sms` shows 23 passed (the tests folder was missing after the v8 unzip).
- Step 5: dashboard behind Cloudflare Access (TEAM_DOMAIN, POLICY_AUD in dash/wrangler.toml), `npm run deploy:dash`.
- NEW (v14): dashboard Page (daily notebook page: pencil drafts → ink, intentions/tasks, edit/erase, page turns) and Shelf (books/PDF bookmarks, video/audio timestamps, uploads to R2). Backend + API tested (npm test); Page verified in browser; Shelf NOT yet visually verified; pins editing NOT done. Next steps: docs/PROMPT-1-handoff.md.
- NEW (v13): dashboard Notepad view (auto timestamps per line, offline-safe draft, Send → one batch).
- NEW (v12): Telegram gym mode (/gym … /done) — time captured automatically per message, one Gemini call at the end. Bharat wants zero typing of times; this is the recommended path.
- NEW (v11): batch notes. Paste a whole timestamped workout note into Telegram or the Log Shortcut; one Gemini call; resend-safe. Dashboard Forbidden page now shows a reason code (Bharat was hitting Forbidden on Step 5; email matched, AUD/team domain being checked).
- NEW (v10): /ingest/health (HEALTH_KEY, table health_daily) and /ingest/log (LOG_KEY). Bharat is setting up both Shortcuts; then the SMS one.
- Step 6: INGEST_KEY secret, ingest curl test, iPhone Message automations (debited/spent/credited/sent/received).
- Step 7: commit + push (scan for secrets first). Step 8: Claude Code. Step 9: weekly encrypted backup.

## Decisions already made (don't re-ask)
- v9 schema adds: cardio pace (sec/km, computed in code if missing), cadence_spm, max_hr, elevation, splits, rpe,
  workout_type, setting; strength muscle_group, equipment, set_detail, volume_kg (computed), rpe, rest_sec;
  meals calories/carbs/fat/fiber estimates + source; sleep quality/awakenings/is_nap; time_log focus_quality,
  output, start_time; checkins add stress/soreness/motivation (scale stays 1-5); new `body` table.
- Finance stays regex-only, never Gemini/Telegram. Telegram finance alerts carry no amount or merchant.
- UI comes after functionality. Planned sections: Today, Body, Mind, Coin, The Arc; Shinigami Eyes global; Ledger behind an icon.
- Proposed, waiting for go-ahead: swap Gemini for Workers AI behind a config switch (privacy: Gemini free tier allows human review); text Shortcut as Telegram replacement.
- Backlog: automated nightly encrypted backup (public-key encryption, R2), Body charts for pace/cadence/volume,
  health ingest via Shortcuts, portfolio (broker not chosen yet).
