# ryuk v1

Log anything from your phone in plain text. It becomes structured rows in Notion. Free.

```
iPhone Telegram --webhook--> Cloudflare Worker --> Gemini (messy text -> JSON events)
                                   |
                                   +--> Notion database (view / correct on phone)
                                   +--> Telegram reply ✓ ...  + 22:00 IST daily summary
```

## Design decisions (v1)
| Decision | Why |
|---|---|
| Text only (dictate with keyboard mic) | Smallest thing that builds the habit |
| Telegram as input | Fast, keeps full chat history as raw backup, free bot API |
| Cloudflare Worker | Always on, no laptop, free plan |
| Gemini free tier | Turns messy text into structured events. Free tier may use data to improve Google products |
| Notion as store | Easy daily viewing and correction on phone. Export to CSV/DuckDB for analysis |
| Raw text always stored | Re-parse later if the prompt or schema changes; nothing lost if Gemini fails |

## Notion database properties
| Property | Type |
|---|---|
| Name | Title |
| Category | Select |
| Value | Number |
| Unit | Text |
| Note | Text |
| Raw | Text |
| Logged at | Date |
| Status | Select (`auto`, `needs review`, `corrected`) |

## Build checklist
1. Telegram: @BotFather -> `/newbot` -> save token. Message the bot once, open
   `https://api.telegram.org/bot<TOKEN>/getUpdates`, note `chat.id`.
2. Notion: create the database above. notion.so/my-integrations -> new internal integration -> copy token.
   On the database: ••• -> Connections -> add the integration. Copy the 32-char database id from its URL.
3. Gemini: aistudio.google.com -> Get API key. Copy the current Flash-Lite model id.
4. Cloudflare: free account, then:
   ```bash
   npm install
   npx wrangler login
   npx wrangler secret put TELEGRAM_TOKEN
   npx wrangler secret put WEBHOOK_SECRET     # any random string
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put NOTION_TOKEN
   # edit wrangler.toml: OWNER_CHAT_ID, NOTION_DB_ID, GEMINI_MODEL
   npx wrangler deploy
   ```
5. Connect Telegram to the Worker (once):
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<WEBHOOK_SECRET>`
6. Test: send `read 20 pages atomic habits, energy 4`. Expect two ✓ lines and two Notion rows.
   Debug with `npx wrangler tail`.

## Roadmap (only after 2–3 weeks of daily logging)
- v2: reminders -> Google Calendar (shows in Apple Calendar via iPhone account sync)
- v3: weekly analysis: Notion export -> DuckDB -> charts / LLM weekly review
- v4: photos (meal plates, screen-time screenshots), Apple Health via Health Auto Export
