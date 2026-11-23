# Ryuk / Life Note — Setup & Runbook

Nov 23, 2026 · @Bharat Kumar Sharma

## Overview

Life Note is a free personal logging system: you text a Telegram bot called Ryuk from your iPhone, and every message becomes structured rows in a Notion database you can view and correct on your phone.

The goal is to document daily life with almost no effort in the moment: workouts, food, sleep, reading, deep work, screen time, energy and mood. Typing (or dictating) one messy line is the only manual step; everything else is automatic.

**Design principles**

- **Minimal effort while logging.** Messy text, Hinglish and several activities in one message are all fine.
- **Nothing is lost.** The original message is always stored in the `Raw` column, even if structuring fails.
- **Correct later, not now.** Mistakes are fixed in Notion during the daily review, not at the moment of logging.
- **Absolutely free.** Every component runs on a free tier; no laptop needs to stay on.
- **Text only in v1.** Photos, voice notes and reminders are deliberately left for later versions.

## Components and accounts

Four free services do the work; your laptop is only needed to change code and redeploy.

| Component | What it does | Where it lives | Cost / limits |
| --- | --- | --- | --- |
| Telegram bot (Ryuk) | Where you type logs on the iPhone; keeps the full chat history as a raw backup | Telegram account, created with @BotFather | Free |
| Cloudflare Worker (`ryuk`) | Receives each message, calls Gemini, writes to Notion, replies, sends the 22:00 summary | `https://ryuk.iambharatks.workers.dev`, account iambharatks@gmail.com | Free plan |
| Gemini API | Turns messy text into structured JSON events | Google AI Studio API key | Free tier; free-tier data may be used by Google to improve its products |
| Notion database (Lifelog / Life Note) | The knowledge base: one row per event, viewable and editable on the phone | Your Notion workspace, accessed by the internal integration Ryuk | Free plan |
| Wrangler CLI | Deploys the code and stores secrets on Cloudflare | Your laptop, project folder `E:\Ryuk` | Free |

**AWS analogy:** the Worker is like a Lambda with a built-in Function URL, Wrangler is like the SAM CLI, `wrangler.toml` is like `template.yaml`, and Worker secrets are like Secrets Manager values exposed as environment variables.

## Configuration reference

Four secrets live encrypted on Cloudflare and three plain variables live in `wrangler.toml`. Never write secret values into any file or this doc.

**Secrets** (set with `npx wrangler secret put <NAME>`; check with `npx wrangler secret list`)

| Name | Where to get it | Looks like |
| --- | --- | --- |
| `TELEGRAM_TOKEN` | Telegram, @BotFather, then `/mybots`, Ryuk, API Token | `7123456789:AAH...` |
| `WEBHOOK_SECRET` | You generate it. PowerShell: `-join ((48..57)+(65..90)+(97..122) \| Get-Random -Count 32 \| % {[char]$_})` | 32 letters and digits |
| `GEMINI_API_KEY` | aistudio.google.com, Get API key, Create API key | `AIza...` |
| `NOTION_TOKEN` | Notion, Settings, Connections, Develop or manage integrations, Ryuk, Internal Integration Secret | `ntn_...` |

**Variables** (in `wrangler.toml`, under `[vars]`)

| Name | Value / where from |
| --- | --- |
| `OWNER_CHAT_ID` | Your Telegram user ID, from @userinfobot. Only this chat can write to the log. |
| `NOTION_DB_ID` | `421c0614e01681bdb52fd9f6ae643e13` (the 32 characters in the database URL) |
| `GEMINI_MODEL` | The current Flash-Lite model ID, copied from AI Studio. Model names change; update this when Google retires a model. |

**Other settings in `wrangler.toml`:** `name = "ryuk"` (sets the Worker URL), `crons = ["30 16 * * *"]` (16:30 UTC = 22:00 IST daily summary), and optionally `preview_urls = false`.

**Project files:** `src/index.ts` (all logic), `wrangler.toml`, `package.json`, `tsconfig.json`, `README.md`. Keep them in a private GitHub repo.

## Notion database

Every event is one row with a fixed category and a normalised unit, so weekly totals add up without cleaning.

**Properties**

| Property | Type | Holds |
| --- | --- | --- |
| Name | Title | 3 to 8 word summary, e.g. "Bench press 3x10 at 60kg" |
| Category | Select | One of the fixed categories below |
| Value | Number | The main number (minutes, kg, pages, score, protein estimate) |
| Unit | Text | Unit of Value |
| Note | Text | Clean detail; topic tag first for work and learning |
| Raw | Text | Your original message, exactly as sent |
| Logged at | Date | When it happened (yesterday if you said "kal raat") |
| Status | Select | `auto`, `needs review` (Gemini failed), `corrected` (you fixed it) |

**Categories and units**

| Category | Value and unit | Example message |
| --- | --- | --- |
| gym | working weight in `kg`, or `reps` for bodyweight | `bench 3x10 60` |
| cardio | `min`; distance in note | `20 min treadmill 2.5km` |
| food | estimated protein, `g_protein_est` | `lunch dal chawal 2 roti dahi` |
| water | `ml` (1 glass = 250) | `3 glass water` |
| sleep | `min` slept; bed and wake times in note | `kal raat 1 baje soya 8 baje utha` |
| deep\_work | `min` | `2 ghante dsa kiya` |
| read | `pages` (or `min`) | `read ddia 30 pages` |
| watch | `min` (deliberate videos, courses) | `1 hr system design video` |
| listen | `min` (podcasts, audiobooks) | `40 min podcast on rag` |
| screen | `min` (passive scrolling); app in note | `45 min insta reels` |
| energy, focus, mood | `score` 1 to 5 | `energy low`, `focus 4` |
| note | none | ideas, thoughts, `CORRECTION:` lines |

**Topic tags** (start of the note for deep\_work, read, watch, listen): `[work]` office / GDX, `[dsa]`, `[system_design]`, `[ai]`, `[rust]`, `[gre]`, `[job_search]`, `[side_project]`, `[other]`.

**Word-to-score mapping:** very low = 1, low / thaka = 2, ok / theek = 3, good / accha = 4, great / full josh = 5.

Protein values are rough estimates (about plus or minus 30%) for spotting trends, not exact counts. Add quantities like `200g paneer` when you know them.

## Daily usage

Log in the moment with one message to Ryuk, then spend two minutes each night reviewing the day in Notion.

**Logging**

- Open the Ryuk chat in Telegram (pin it to the top).
- Type, or tap the **iPhone keyboard mic** to dictate. Do not use Telegram's own mic button: it sends a voice note, which v1 ignores.
- One message can hold several activities: `bench 3x10 60, then 20 min run, energy 3` becomes three rows.
- Ryuk replies with one check mark line per row it saved.

**Replies you can get**

| Reply | Meaning | What to do |
| --- | --- | --- |
| `✓ gym 60 kg — bench press 3x10` | Saved and structured | Nothing |
| `⚠ saved raw (not structured)` | Gemini failed; raw text saved with status `needs review` | Fix the row in Notion later |
| `❌ NOT saved, resend later` | Notion also failed; nothing stored | Resend the message later |
| `Text only for now` | You sent a photo or voice note | Send it as text |

**Commands and automatic messages**

- `/today`: lists everything logged today.
- 22:00 IST every day: Ryuk sends the day's summary and reminds you to log energy and focus.

**Correcting entries**

- Edit the row directly in the Notion app and set Status to `corrected`. The original stays in `Raw`.
- Or send a message starting with `fix:` (for example `fix: it was 50 pages`). It is saved as a `note` row starting with `CORRECTION:` so you can find it in the review.

**Useful Notion views to create**

- **Today:** filter Logged at = today, sort ascending.
- **Needs review:** filter Status = `needs review`.
- **This week by category:** group by Category, show the sum of Value.

## Rebuild from scratch

A full redo takes about 45 minutes; follow these steps in order.

1. **Telegram bot**
   - Message @BotFather, send `/newbot`, choose a display name (Ryuk) and a username ending in `bot`.
   - Save the token. Get your user ID from @userinfobot.
2. **Notion database**
   - Create a database with the eight properties in the Notion database section (or duplicate the existing one).
   - Copy the 32-character ID from its URL.
3. **Notion integration**
   - Notion, Settings, Connections, Develop or manage integrations, New integration.
   - Type **Internal** (API token, not OAuth). Capabilities: Read, Update and Insert content.
   - Copy the `ntn_` secret. On the integration's **Access** tab, give it access to the database.
4. **Gemini**
   - aistudio.google.com, Get API key, Create API key.
   - Copy the current Flash-Lite model ID.
5. **Project folder**
   - Put `src/index.ts`, `wrangler.toml`, `package.json` and `tsconfig.json` in one folder (or clone the GitHub repo).
   - Fill `OWNER_CHAT_ID`, `NOTION_DB_ID` and `GEMINI_MODEL` in `wrangler.toml`.
   - Run `npm install`.
6. **Cloudflare**
   - `npx wrangler login` and approve in the browser tab that opens (close old tabs first).
   - Run `npx wrangler secret put` for TELEGRAM\_TOKEN, WEBHOOK\_SECRET, GEMINI\_API\_KEY and NOTION\_TOKEN.
   - `npx wrangler deploy`. Note the printed Worker URL.
7. **Connect Telegram to the Worker** (once): open in a browser `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<WEBHOOK_SECRET>` and expect `"Webhook was set"`.
8. **Test**
   - Run `npx wrangler tail`, then send `read 20 pages atomic habits, energy 4`.
   - Expect two check mark replies and two Notion rows.

## Maintenance and troubleshooting

Start every investigation with `npx wrangler tail`, resend the message, and read the error it prints.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Bot never replies | Webhook not set, wrong URL, or wrong `secret_token` | Re-run `setWebhook`; check `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` for `last_error_message` |
| Bot never replies, webhook fine | `OWNER_CHAT_ID` wrong, so the Worker ignores you | Compare it with @userinfobot's ID; redeploy |
| `Notion 404 object_not_found` | Integration has no access to the database | Integration, Access tab, add the database |
| `Notion 401 unauthorized` | Wrong or revoked `NOTION_TOKEN` | Copy the secret again; `wrangler secret put NOTION_TOKEN` |
| `Notion 400 validation_error` | A property was renamed or deleted | Restore the property names exactly as in the Notion database section |
| `Gemini 404` | Model ID retired or mistyped | Copy the current Flash-Lite ID into `GEMINI_MODEL`; redeploy |
| `Gemini 429` | Free-tier rate limit hit | Wait; rows are still saved raw as `needs review` |
| `getUpdates` returns `[]` | A webhook is set, so updates go to the Worker | Use @userinfobot for IDs instead |
| `OAuth error: request_forbidden` on login | Approved an old login tab | Close all Cloudflare tabs; `wrangler logout`, then `wrangler login` |
| No 22:00 summary | Cron missing or Worker errors | Check `crons` in `wrangler.toml`; check Cloudflare dashboard logs |

**Routine maintenance**

- **Change the prompt or code:** edit `src/index.ts`, then `npx wrangler deploy`. The webhook does not need resetting.
- **Rotate a secret:** `npx wrangler secret put <NAME>`; it takes effect immediately.
- **Back up the code:** keep the folder in a private GitHub repo.
- **Weekly:** clear `needs review` rows; look at the `note` category for activities that deserve their own category.

## Other use cases with the current setup

The same pipeline (text in, Gemini structures it, a Notion row out) handles much more than the daily log. Most of these work today; the rest need only a prompt edit.

| Use case | Example message | Change needed |
| --- | --- | --- |
| Idea capture | `idea: MCP server that queries my lifelog` | None (saved as `note`, `IDEA:`) |
| Study / prep log | `2h leetcode graphs, 4 mediums, struggled with dijkstra` | None (`deep_work`, `[dsa]`) |
| Job search tracker | `applied to anthropic FDE role via referral` | None (`deep_work`, `[job_search]`); add a `job` category for richer fields |
| Interview reflection | `mock interview system design: weak on caching tradeoffs` | None (`note`); add a `reflection` category if frequent |
| Reading notes | `ddia ch6: partitioning by key range causes hot spots` | None (`read` with the insight in note) |
| Content consumption | `watched 3 youtube videos on agents 50 min` | None (`watch`) |
| Habit streaks | `meditated 10 min`, `no sugar today` | Prompt: add a `habit` category |
| Supplements and water | `whey 1 scoop`, `4 glasses water` | Prompt: protein from supplements is already estimated under `food`; water works today |
| Body measurements | `weight 72.4 kg` | Prompt: add a `body` category |
| Expenses | `swiggy 340` | Prompt: add an `expense` category (unit `INR`) |
| Gratitude / journal line | `good call with papa today` | None (`mood` or `note`) |
| Work log for appraisals | `fixed GDX validation bug for payload hooks` | None (`deep_work`, `[work]`); export the `[work]` rows before reviews |
| Weekly review with an LLM | Export the week to CSV and ask for patterns | No code; v3 automates it |
| Accountability summary | The 22:00 summary already shows the day | None |

**How to add a category:** add it to the `CATEGORIES` list and to the rules in `PROMPT` in `src/index.ts`, add one example message, then `npx wrangler deploy`. Notion creates the new select option automatically on first use. Add categories only after the same kind of activity keeps landing in `note`.

## Limitations and roadmap

v1 is deliberately small; add the next version only after two to three weeks of daily logging.

**Known limitations of v1**

- Text only: photos and Telegram voice notes are rejected (keyboard dictation works).
- Gemini's free tier may use your logs to improve Google's products. A paid key, or a local model via Ollama, avoids this.
- Protein numbers are estimates, and categories depend on the prompt recognising your words.
- Notion is good for viewing and fixing, not for analysis; export to CSV or DuckDB for that.
- No automatic import of Apple Health, phone screen time or laptop usage yet.
- The webhook URL depends on the Worker name and workers.dev subdomain; renaming either means re-running `setWebhook`.

**Roadmap**

| Version | Adds | Notes |
| --- | --- | --- |
| v2 | Reminders to Google Calendar | Shows in Apple Calendar once the Google account is added on the iPhone; or Telegram-only reminders via Cloudflare KV and a per-minute cron |
| v2 | Voice notes | Gemini transcribes and structures in one call; about 15 lines of code |
| v3 | Weekly analysis | Notion export to DuckDB, charts, and an LLM weekly review |
| v4 | Photos | Meal plates and Screen Time screenshots, uploaded to Notion (free plan limit 5 MiB per file) |
| v4 | Passive data | Apple Health via Health Auto Export, laptop time via ActivityWatch |
| Later | MCP server over the data | Lets Claude query your own life data; doubles as a portfolio project |
