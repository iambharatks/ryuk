/**
 * Lifelog Worker v1 (text only): Telegram -> Gemini (structure) -> Notion (knowledge base)
 * Free stack: Cloudflare Workers + Gemini free tier + Notion free.
 * Tip: use the iPhone keyboard mic to dictate; the bot still receives plain text.
 */

export interface Env {
  TELEGRAM_TOKEN: string;      // secret
  WEBHOOK_SECRET: string;      // secret, random string, also passed to setWebhook
  OWNER_CHAT_ID: string;       // var
  GEMINI_API_KEY: string;      // secret
  GEMINI_MODEL: string;        // var, primary model (best quality)
  GEMINI_FALLBACK_MODEL?: string; // var, used when the primary is rate-limited or unavailable
  NOTION_TOKEN: string;        // secret
  NOTION_DB_ID: string;        // var
}

type LogEvent = {
  category: string;
  value: number | null;
  unit: string | null;
  note: string | null;
  summary: string;
  day_offset?: number | null; // 0 = today, -1 = yesterday
};

const CATEGORIES = [
  "gym", "cardio", "food", "water", "sleep",
  "deep_work", "read", "watch", "listen", "screen",
  "energy", "focus", "mood", "note",
] as const;

const PROMPT = `You are the parser for a personal life log. The user types (or dictates) short, messy notes
during the day in English, Hindi or Hinglish. Convert each message into structured events for analysis.
Consistency matters more than detail: the same activity must always map to the same category and unit.

RULES
1. One event per distinct activity. "gym then 20 min walk, energy 3" = 3 events.
   For gym, one event per exercise.
2. category: exactly one of the allowed values. If nothing fits, use "note". Never invent categories.
3. Units, normalised:
   - Any duration -> minutes, unit "min" (2h -> 120, "dedh ghanta" -> 90, "half hour" -> 30).
   - Weight -> "kg". Reading -> "pages" (or "min" if only time given). Distance -> "km". Water -> "ml" (1 glass = 250).
   - energy / focus / mood -> score 1-5, unit "score". Map words: very low/dead=1, low/thaka=2,
     ok/theek=3, good/accha=4, great/full josh=5.
4. Never invent numbers. If the user gives no number, value = null. The only exception is food (rule 6).
5. note: short, clean English. Keep names of books, exercises, dishes, apps, topics.
   For deep_work, read, watch, listen and learning-type work, START the note with a topic tag in brackets:
   [work] office/GDX/Gartner tasks, [dsa] LeetCode/CP/algorithms, [system_design], [ai] LLM/RAG/agents/MCP,
   [rust], [gre], [job_search] applications/resume/interviews, [side_project], [other].
6. food: note lists every item with rough quantity (e.g. "2 roti, dal, paneer bhurji ~100g").
   value = your ESTIMATED protein in grams for the whole meal, unit "g_protein_est".
   The user is vegetarian; estimate for Indian home portions. If too vague to estimate, value = null.
7. gym: value = working weight in kg, note = "<exercise> <sets>x<reps>" (e.g. "bench press 3x10").
   Bodyweight exercises: value = total reps, unit "reps". Use full exercise names.
8. cardio: value = minutes; put distance/pace in note.
9. sleep: value = minutes slept. If given bed/wake times, compute it (1am to 8am = 420).
   Put bed and wake times in note.
10. screen = passive phone/laptop use (scrolling, reels, YouTube shorts): value = minutes, note = app.
    watch = deliberate video/course/series; listen = podcast/audiobook; read = books/articles/papers.
11. day_offset: 0 by default; -1 if the user clearly refers to yesterday ("kal raat", "last night", "yesterday").
12. Corrections ("fix:", "galat tha", "actually it was 50") or pure thoughts/ideas -> category "note",
    note starting with "CORRECTION:" or "IDEA:" as appropriate.
13. summary: 3-8 word English title, e.g. "Bench press 3x10 at 60kg".

EXAMPLES
"bench 3x10 60, incline db 3x12 20, 15 pushups"
-> gym 60 kg "bench press 3x10"; gym 20 kg "incline dumbbell press 3x12"; gym 15 reps "push-ups 1x15"
"aaj 2 ghante dsa kiya 3 mediums solve kiye, energy low"
-> deep_work 120 min "[dsa] 3 LeetCode mediums"; energy 2 score
"lunch dal chawal 2 roti aur dahi"
-> food ~20 g_protein_est "1 bowl dal, 1 plate rice, 2 roti, 1 bowl curd"
"kal raat 1 baje soya 8 baje utha"
-> sleep 420 min "bed 01:00, wake 08:00", day_offset -1
"45 min insta reels 😩"
-> screen 45 min "Instagram reels"
"read ddia ch 5 30 pages, then 1hr gdx validation bug"
-> read 30 pages "[system_design] Designing Data-Intensive Applications ch5"; deep_work 60 min "[work] GDX validation bug"`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", enum: [...CATEGORIES] },
          value: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true },
          note: { type: "STRING", nullable: true },
          summary: { type: "STRING" },
          day_offset: { type: "INTEGER", nullable: true },
        },
        required: ["category", "summary"],
      },
    },
  },
  required: ["events"],
};

const NOTION_HEADERS = (env: Env) => ({
  Authorization: `Bearer ${env.NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
});

// ---------- Telegram ----------
function send(env: Env, chatId: string | number, text: string) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ---------- Gemini ----------
async function callGemini(env: Env, model: string, text: string): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, { text: `Message: """${text}"""` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
      }),
    },
  );
}

// Try the primary model; on rate limit (429), missing model (404) or server error (5xx), try the fallback.
async function structure(env: Env, text: string): Promise<LogEvent[]> {
  const models = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter((m): m is string => !!m);
  let lastErr = "";
  for (const model of models) {
    const res = await callGemini(env, model, text);
    if (res.ok) {
      const data: any = await res.json();
      return (JSON.parse(data.candidates[0].content.parts[0].text) as { events: LogEvent[] }).events;
    }
    lastErr = `Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 160)}`;
    console.log(lastErr);
    if (!(res.status === 429 || res.status === 404 || res.status >= 500)) break; // other errors won't be fixed by switching
  }
  throw new Error(lastErr);
}

// ---------- Notion ----------
const rt = (s: string | null) => (s ? [{ text: { content: s.slice(0, 1900) } }] : []);

async function addRow(env: Env, e: LogEvent, raw: string, loggedAt: string, status: string) {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: NOTION_HEADERS(env),
    body: JSON.stringify({
      parent: { database_id: env.NOTION_DB_ID },
      properties: {
        Name: { title: rt(e.summary) },
        Category: { select: { name: e.category } },
        Value: { number: e.value ?? null },
        Unit: { rich_text: rt(e.unit) },
        Note: { rich_text: rt(e.note) },
        Raw: { rich_text: rt(raw) },
        "Logged at": { date: { start: loggedAt } },
        Status: { select: { name: status } },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function todayRows(env: Env): Promise<any[]> {
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_ID}/query`, {
    method: "POST",
    headers: NOTION_HEADERS(env),
    body: JSON.stringify({
      filter: { property: "Logged at", date: { on_or_after: `${ist}T00:00:00+05:30` } },
      sorts: [{ property: "Logged at", direction: "ascending" }],
      page_size: 100,
    }),
  });
  return ((await res.json()) as any).results ?? [];
}

function fmt(e: { category: string; value: number | null; unit: string | null; note: string | null }) {
  return `${e.category}${e.value != null ? ` ${e.value} ${e.unit ?? ""}`.trimEnd() : ""}${e.note ? ` — ${e.note}` : ""}`;
}

function formatRows(rows: any[]): string {
  if (!rows.length) return "Nothing logged today.";
  return rows
    .map((r) => {
      const p = r.properties;
      return "• " + fmt({
        category: p.Category.select?.name ?? "?",
        value: p.Value.number,
        unit: p.Unit.rich_text[0]?.plain_text ?? null,
        note: p.Note.rich_text[0]?.plain_text ?? null,
      });
    })
    .join("\n");
}

// ---------- Handlers ----------
async function handleMessage(env: Env, msg: any) {
  const chatId = msg.chat.id;
  const text: string | undefined = msg.text;
  if (!text) {
    await send(env, chatId, "Text only for now. Use the keyboard mic to dictate.");
    return;
  }
  if (text === "/today") {
    await send(env, chatId, formatRows(await todayRows(env)));
    return;
  }

  const loggedAt = new Date(msg.date * 1000).toISOString();
  try {
    const events = await structure(env, text);
    for (const e of events) {
      const offset = Math.max(-7, Math.min(0, e.day_offset ?? 0)); // only allow looking back up to a week
      const at = offset ? new Date(msg.date * 1000 + offset * 86400e3).toISOString() : loggedAt;
      await addRow(env, e, text, at, "auto");
    }
    await send(env, chatId, events.map((e) => `✓ ${fmt(e)}`).join("\n") || "✓ saved");
  } catch (err) {
    // Never lose a log: keep the raw text as 'unparsed' so you can fix it in Notion later.
    try {
      await addRow(env, { category: "unparsed", value: null, unit: null, note: null, summary: text.slice(0, 60) },
        text, loggedAt, "needs review");
      await send(env, chatId, `⚠ saved raw (not structured): ${(err as Error).message}`);
    } catch (err2) {
      await send(env, chatId, `❌ NOT saved, resend later: ${(err2 as Error).message}`);
    }
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "POST" || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("ok");
    }
    const update: any = await req.json();
    const msg = update.message;
    if (msg && String(msg.chat.id) === env.OWNER_CHAT_ID) {
      ctx.waitUntil(handleMessage(env, msg)); // ack fast so Telegram doesn't retry
    }
    return new Response("ok");
  },

  // Daily summary at 22:00 IST (cron in wrangler.toml)
  async scheduled(_evt: ScheduledController, env: Env): Promise<void> {
    await send(env, env.OWNER_CHAT_ID,
      `📓 Today\n${formatRows(await todayRows(env))}\n\nSend energy and focus (1-5) if you haven't.`);
  },
};
