/**
 * Ryuk bot v2: Telegram -> Gemini (structure) -> Cloudflare D1 (typed tables)
 * Free stack: Cloudflare Workers + D1 + Gemini free tier.
 * Commands: /today  /undo  /retry
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { handleIngest, json, keyOk } from "./ingest";
import { handleHealth } from "./health";
import { type BatchLine, hhmm, isBatch, lineKey, parseBatch } from "./batch";

export interface Env {
  DB: D1Database;                  // D1 binding (wrangler.toml)
  TELEGRAM_TOKEN: string;          // secret
  WEBHOOK_SECRET: string;          // secret
  GEMINI_API_KEY: string;          // secret
  OWNER_CHAT_ID: string;           // var
  GEMINI_MODEL: string;            // var, primary model
  GEMINI_FALLBACK_MODEL?: string;  // var, used on 429 / 404 / 5xx / timeout
  INGEST_KEY?: string;             // secret, for /ingest/sms (bank SMS Shortcut)
  HEALTH_KEY?: string;             // secret, for /ingest/health (Apple Health Shortcut)
  LOG_KEY?: string;                // secret, for /ingest/log (text logging Shortcut)
  LARGE_TXN_INR?: string;          // var, threshold for the "large" flag
  FINANCE_ALERTS?: string;         // var, "1" = detail-free Telegram ping for flagged transactions
}

// ---------- Event model (what Gemini returns) ----------
type EventType = "strength" | "cardio" | "meal" | "water" | "sleep" | "time" | "checkin" | "body" | "note";

type Ev = {
  type: EventType;
  summary: string;
  day_offset?: number | null;
  at_time?: string | null;
  line?: number | null;          // batch mode: which numbered line the event came from
  detail?: string | null;
  // strength
  exercise?: string | null; muscle_group?: string | null; equipment?: string | null;
  sets?: number | null; reps?: number | null; weight_kg?: number | null; set_detail?: string | null; rest_sec?: number | null;
  // strength + cardio
  rpe?: number | null;
  // cardio
  activity?: string | null; setting?: string | null; workout_type?: string | null; distance_km?: number | null;
  avg_pace_sec_km?: number | null; avg_speed_kmh?: number | null; cadence_spm?: number | null;
  avg_hr?: number | null; max_hr?: number | null; elevation_gain_m?: number | null; calories?: number | null;
  steps?: number | null; splits?: string | null;
  // shared duration (cardio, sleep, time)
  duration_min?: number | null;
  // meal
  meal_slot?: string | null; items?: string | null; source?: string | null; calories_est?: number | null;
  protein_g_est?: number | null; carbs_g_est?: number | null; fat_g_est?: number | null; fiber_g_est?: number | null;
  // water
  ml?: number | null;
  // sleep
  bed_time?: string | null; wake_time?: string | null; quality?: number | null; awakenings?: number | null; is_nap?: boolean | null;
  // time
  kind?: string | null; topic?: string | null; pages?: number | null; title?: string | null;
  start_time?: string | null; focus_quality?: number | null; output?: string | null;
  // body
  body_fat_pct?: number | null; waist_cm?: number | null; resting_hr?: number | null;
  // checkin
  metric?: string | null; score?: number | null;
  // note
  note_kind?: string | null; text?: string | null;
};

const str = (enumVals?: string[]) => ({ type: "STRING", nullable: true, ...(enumVals ? { enum: enumVals } : {}) });
const num = { type: "NUMBER", nullable: true };
const int = { type: "INTEGER", nullable: true };

const SCHEMA = {
  type: "OBJECT",
  properties: {
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["strength", "cardio", "meal", "water", "sleep", "time", "checkin", "body", "note"] },
          summary: { type: "STRING" },
          day_offset: int,
          at_time: str(),
          line: int,
          detail: str(),
          exercise: str(), muscle_group: str(["chest", "back", "shoulders", "legs", "arms", "core", "full_body"]),
          equipment: str(["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band", "other"]),
          sets: int, reps: int, weight_kg: num, set_detail: str(), rest_sec: int, rpe: num,
          activity: str(), setting: str(["outdoor", "indoor", "treadmill"]),
          workout_type: str(["easy", "tempo", "intervals", "long", "recovery", "race", "other"]),
          distance_km: num, avg_pace_sec_km: num, avg_speed_kmh: num, cadence_spm: int,
          avg_hr: int, max_hr: int, elevation_gain_m: num, calories: num, steps: int, splits: str(),
          duration_min: num,
          meal_slot: str(["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]), items: str(),
          source: str(["home", "outside", "ordered", "office", "packaged"]),
          calories_est: num, protein_g_est: num, carbs_g_est: num, fat_g_est: num, fiber_g_est: num,
          ml: num,
          bed_time: str(), wake_time: str(), quality: num, awakenings: int, is_nap: { type: "BOOLEAN", nullable: true },
          kind: str(["deep_work", "read", "watch", "listen", "screen"]),
          topic: str(["work", "dsa", "system_design", "ai", "rust", "gre", "job_search", "side_project", "other"]),
          pages: num, title: str(), start_time: str(), focus_quality: num, output: str(),
          metric: str(["energy", "focus", "mood", "stress", "soreness", "motivation"]), score: num,
          body_fat_pct: num, waist_cm: num, resting_hr: int,
          note_kind: str(["idea", "correction", "note"]), text: str(),
        },
        required: [
          "type", "summary", "day_offset", "at_time", "detail",
          "exercise", "muscle_group", "equipment", "sets", "reps", "weight_kg", "set_detail", "rpe", "rest_sec",
          "activity", "setting", "workout_type", "distance_km", "duration_min", "avg_pace_sec_km", "avg_speed_kmh",
          "cadence_spm", "avg_hr", "max_hr", "elevation_gain_m", "calories", "steps", "splits",
          "meal_slot", "items", "source", "calories_est", "protein_g_est", "carbs_g_est", "fat_g_est", "fiber_g_est",
          "ml", "bed_time", "wake_time", "quality", "awakenings", "is_nap",
          "kind", "topic", "pages", "title", "start_time", "focus_quality", "output",
          "metric", "score", "body_fat_pct", "waist_cm", "resting_hr", "note_kind", "text",
        ],
      },
    },
  },
  required: ["events"],
};

const PROMPT = `You are the parser for a personal life log. The user types or dictates short, messy notes during the day
in English, Hindi or Hinglish. Turn each message into typed events. Consistency matters more than detail.

EVENT TYPES AND THEIR FIELDS (fill only the fields of the chosen type; others null)
- strength: one event PER EXERCISE. exercise (canonical full name: "Bench press", "Barbell back squat", "Lat pulldown"),
  muscle_group (main group), equipment, sets, reps (per set), weight_kg (null if bodyweight), rpe (1-10 if stated),
  rest_sec. If sets differ ("60x10, 65x8, 70x6" or "pyramid"), fill set_detail with every set as "kg x reps",
  and put the top set in weight_kg/reps.
  "bench 3x10 60" -> Bench press, chest, barbell, sets 3, reps 10, weight_kg 60. "20 pushups" -> sets 1, reps 20, bodyweight.
- cardio: activity ("Run", "Walk", "Cycling", "Swim", "Treadmill run", "Yoga", "Stretching", "Badminton"...),
  setting (outdoor/indoor/treadmill), workout_type (easy/tempo/intervals/long/recovery/race), duration_min, distance_km,
  avg_pace_sec_km (pace in SECONDS per km: "5:30/km" = 330; only if stated), avg_speed_kmh (if stated),
  cadence_spm (steps per minute, or rpm for cycling: "cadence 170", "170 spm"), avg_hr, max_hr, elevation_gain_m,
  calories (only if the user states it, e.g. from a watch), steps, rpe (1-10), splits (per-km splits or interval reps
  as written: "5:40, 5:35, 5:30" or "6x400m @ 1:45"). How it felt goes in detail.
  "ran 5km in 30 min" -> duration_min 30, distance_km 5. "10k 55:20 avg 5:32 cadence 172 hr 158 max 176" ->
  distance 10, duration 55.33, pace 332, cadence 172, avg_hr 158, max_hr 176.
- meal: meal_slot (breakfast/lunch/dinner/snack/pre_workout/post_workout; infer or null), items (every item with rough
  quantity, e.g. "2 roti, 1 bowl dal, 1 bowl curd"), source (home/outside/ordered/office/packaged; null if unknown),
  ESTIMATES for the whole meal: calories_est, protein_g_est, carbs_g_est, fat_g_est, fiber_g_est (vegetarian Indian
  portions; all null if far too vague). Supplements like whey or creatine count as meal/snack.
- water: ml (1 glass = 250, 1 bottle = 1000).
- sleep: duration_min (compute from bed/wake if given: 1am to 8am = 420), bed_time and wake_time as "HH:MM" 24h,
  quality 1-5 if described (bad=1 ... deep/great=5), awakenings (times woke up), is_nap true for daytime naps.
  Sleep that ended this morning belongs to last night: day_offset -1. A nap is today (day_offset 0).
- time: where time went. kind = deep_work (focused work or study), read (books/articles/papers), watch (deliberate
  videos/courses/series), listen (podcasts/audiobooks), screen (passive scrolling: reels, shorts, feeds).
  topic = work (office, GDX, Gartner), dsa (LeetCode, CP, algorithms), system_design, ai (LLM, RAG, agents, MCP),
  rust, gre, job_search (applications, resume, interviews), side_project, other. duration_min, pages (for read),
  title (book / video / app / task name), start_time "HH:MM" if stated, focus_quality 1-5 if described
  (distracted=2, solid=4, flow=5), output = what came out of it ("3 mediums solved", "PR merged", "ch5 notes").
- body: weight_kg (bodyweight), body_fat_pct, waist_cm, resting_hr. "weight 72.4" -> body weight_kg 72.4.
- checkin: metric energy | focus | mood | stress | soreness | motivation, score 1-5. Words: very low/dead=1, low/thaka=2, ok/theek=3, good/accha=4,
  great/full josh=5.
- note: note_kind idea | correction | note, text = the thought, cleaned up. Use for corrections ("fix:", "galat tha"),
  ideas, and anything that fits no other type.

GENERAL RULES
1. One event per distinct activity; a message can hold many.
2. Durations always in minutes ("2 ghante" = 120, "dedh ghanta" = 90, "28:10" = 28.17).
3. Never invent numbers except the meal estimates (calories_est and the *_g_est fields). Unknown -> null.
   The app auto-derives avg_pace_sec_km, avg_speed_kmh, and volume_kg only — do NOT fill those unless the user stated them.
   Converting formats IS expected: "55:20" time → 55.33 min, "5:32/km" pace → 332 sec/km, "2 ghante" → 120 min.
4. day_offset: 0 normally, -1 for yesterday ("kal", "last night", "yesterday").
5. detail: short English extra info worth keeping; null if none.
6. summary: 3-8 word English title, e.g. "Bench press 3x10 at 60kg", "Run 5 km in 30 min".
7. Every number present in the summary MUST also appear in its matching structured field.
8. Voice dictation often garbles numbers: "five k" = 5 km, "one seventy two" = 172 bpm, "five five eight" = 558 sec pace. Apply common sense.
9. at_time: if the user mentions WHEN an activity happened (not duration), fill at_time as "HH:MM" in IST 24h.
   "subah" / "morning" → "07:00", "dopahar" → "12:00", "shaam" / "evening" → "18:00", "raat" / "night" → "21:00".
   If not mentioned leave null — the app uses the message send time.
10. Unstructured input: "around 5k", "roughly 30 min", "maybe 400 cal" → use the number as-is (5, 30, 400).
    Missing units: "ran 5 in 30" likely → 5 km, 30 min. "bench 60" → 60 kg. Use fitness context.

EXAMPLES
"bench 3x10 60, incline db 3x12 20, 15 pushups"
-> strength Bench press 3x10 60kg; strength Incline dumbbell press 3x12 20kg; strength Push-ups 1x15 (weight null)
"ran 5km in 30 min, legs heavy"
-> cardio Run outdoor 30 min 5 km, detail "legs heavy"
"aaj 2 ghante dsa kiya 3 mediums, energy low"
-> time deep_work dsa 120 min output "3 LeetCode mediums"; checkin energy 2
"treadmill 20 min intervals 8x1min fast, cadence 175, hr max 182"
-> cardio Treadmill run, treadmill, intervals, 20 min, cadence 175, max_hr 182, splits "8x1min fast"
"squats 60x8 70x6 80x5 rpe 9"
-> strength Barbell back squat, legs, barbell, sets 3, reps 5, weight_kg 80, set_detail "60x8, 70x6, 80x5", rpe 9
"subah weight 72.4"
-> body weight_kg 72.4
"lunch dal chawal 2 roti aur dahi"
-> meal lunch items "1 bowl dal, 1 plate rice, 2 roti, 1 bowl curd" protein_g_est ~20
"kal raat 1 baje soya 8 baje utha"
-> sleep duration 420, bed 01:00, wake 08:00, day_offset -1
"45 min insta reels"
-> time screen other 45 min title "Instagram reels"
"read ddia ch5 30 pages then 1hr gdx validation bug"
-> time read system_design pages 30 title "Designing Data-Intensive Applications ch5";
   time deep_work work 60 min title "GDX validation bug"
"idea: mcp server over my ryuk log"
-> note idea "MCP server over my ryuk log"
"subah 7 baje 5km run kiya 30 min"
-> cardio Run outdoor 30 min 5 km, at_time "07:00"
"shaam gym gaya bench 3x10 60"
-> strength Bench press 3x10 60kg, at_time "18:00"
"around 5k ran maybe 30 min legs felt heavy"
-> cardio Run outdoor 30 min 5 km, detail "legs felt heavy"`;

// ---------- Telegram ----------
function send(env: Env, chatId: string | number, text: string) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ---------- Gemini (primary + fallback, with timeouts) ----------
const TIMEOUTS_MS = [15000, 10000];

const BATCH_PROMPT = `BATCH MODE. The message is a numbered list of lines the user jotted at different times during one
session (usually a workout). For EVERY event set "line" to the number of the line it came from.
- Each line is usually ONE set: make one strength event per line ("bench 60x10" -> sets 1, reps 10, weight_kg 60;
  "bench 3x10 60" on one line -> sets 3). Never merge lines into one event, even for the same exercise.
- Use the same canonical exercise name for the same exercise across lines ("bench", "bp", "bench press" -> "Bench press").
- A line that only names an exercise or says "same" / "again" / "+5" repeats the previous line's exercise with that change.
- Do not set day_offset; times come from the lines. Lines with nothing loggable ("rest", "water") produce no event.`;

async function callGemini(env: Env, model: string, text: string, timeoutMs: number, extra?: string): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, ...(extra ? [{ text: extra }] : []), { text: `Message: """${text}"""` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
}

async function structure(env: Env, text: string, extra?: string, timeouts = TIMEOUTS_MS): Promise<{ events: Ev[]; model: string }> {
  const models = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter((m): m is string => !!m);
  let lastErr = "";
  for (const [i, model] of models.entries()) {
    let res: Response;
    try {
      res = await callGemini(env, model, text, timeouts[Math.min(i, timeouts.length - 1)], extra);
    } catch (e) {
      lastErr = `Gemini ${model} timed out or failed: ${(e as Error).name}`;
      console.log(lastErr);
      continue;
    }
    if (res.ok) {
      const data: any = await res.json();
      const events = (JSON.parse(data.candidates[0].content.parts[0].text) as { events: Ev[] }).events;
      return { events, model };
    }
    lastErr = `Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 160)}`;
    console.log(lastErr);
    if (!(res.status === 429 || res.status === 404 || res.status >= 500)) break;
  }
  throw new Error(lastErr);
}

// ---------- D1 ----------
const n = (v: unknown) => (v === undefined ? null : v); // D1 rejects undefined

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// Total kg moved: sum of "kg x reps" pairs in set_detail, else sets x reps x weight.
export function strengthVolume(e: Ev): number | null {
  if (e.set_detail) {
    let total = 0, found = 0;
    for (const m of e.set_detail.matchAll(/(\d+(?:\.\d+)?)\s*(?:kg)?\s*[x×*]\s*(\d+)/gi)) { total += +m[1] * +m[2]; found++; }
    if (found) return round(total);
  }
  if (e.weight_kg != null && e.reps != null) return round((e.sets ?? 1) * e.reps * e.weight_kg);
  return null;
}

// Pace for foot/swim activities, speed for wheels; computed from duration + distance when not stated.
export function cardioDerived(e: Ev): { pace: number | null; speed: number | null } {
  const d = e.distance_km, t = e.duration_min;
  const canCompute = d != null && t != null && d > 0 && t > 0;
  const wheels = /cycl|bike|ride|spin/i.test(e.activity ?? "");
  const pace = e.avg_pace_sec_km ?? (canCompute && !wheels ? Math.round((t! * 60) / d!) : null);
  const speed = e.avg_speed_kmh ?? (canCompute && wheels ? round(d! / (t! / 60)) : null);
  return { pace, speed };
}

function insertFor(db: D1Database, e: Ev, messageId: number, at: string): D1PreparedStatement | null {
  const s = e.summary;
  switch (e.type) {
    case "strength":
      return db.prepare(`INSERT INTO strength (message_id, logged_at, exercise, muscle_group, equipment, sets, reps, weight_kg, set_detail, volume_kg, rpe, rest_sec, detail, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(messageId, at, e.exercise ?? s, n(e.muscle_group), n(e.equipment), n(e.sets), n(e.reps), n(e.weight_kg),
          n(e.set_detail), strengthVolume(e), n(e.rpe), n(e.rest_sec), n(e.detail), s);
    case "cardio": {
      const { pace, speed } = cardioDerived(e);
      return db.prepare(`INSERT INTO cardio (message_id, logged_at, activity, setting, workout_type, duration_min, distance_km, avg_pace_sec_km, avg_speed_kmh, cadence_spm, avg_hr, max_hr, elevation_gain_m, calories, steps, rpe, splits, detail, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(messageId, at, e.activity ?? "Cardio", n(e.setting), n(e.workout_type), n(e.duration_min), n(e.distance_km),
          pace, speed, n(e.cadence_spm), n(e.avg_hr), n(e.max_hr), n(e.elevation_gain_m), n(e.calories), n(e.steps),
          n(e.rpe), n(e.splits), n(e.detail), s);
    }
    case "meal":
      return db.prepare(`INSERT INTO meals (message_id, logged_at, meal_slot, items, source, calories_est, protein_g_est, carbs_g_est, fat_g_est, fiber_g_est, detail, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(messageId, at, n(e.meal_slot), n(e.items), n(e.source), n(e.calories_est), n(e.protein_g_est),
          n(e.carbs_g_est), n(e.fat_g_est), n(e.fiber_g_est), n(e.detail), s);
    case "water":
      if (e.ml == null) return null;
      return db.prepare(`INSERT INTO water (message_id, logged_at, ml, summary) VALUES (?,?,?,?)`)
        .bind(messageId, at, e.ml, s);
    case "sleep":
      return db.prepare(`INSERT INTO sleep (message_id, logged_at, duration_min, bed_time, wake_time, quality, awakenings, is_nap, detail, summary) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(messageId, at, n(e.duration_min), n(e.bed_time), n(e.wake_time), n(e.quality), n(e.awakenings), e.is_nap ? 1 : 0, n(e.detail), s);
    case "time":
      return db.prepare(`INSERT INTO time_log (message_id, logged_at, kind, topic, duration_min, pages, title, start_time, focus_quality, output, detail, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(messageId, at, e.kind ?? "deep_work", n(e.topic), n(e.duration_min), n(e.pages), n(e.title),
          n(e.start_time), n(e.focus_quality), n(e.output), n(e.detail), s);
    case "body":
      if (e.weight_kg == null && e.body_fat_pct == null && e.waist_cm == null && e.resting_hr == null) return null;
      return db.prepare(`INSERT INTO body (message_id, logged_at, weight_kg, body_fat_pct, waist_cm, resting_hr, detail, summary) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(messageId, at, n(e.weight_kg), n(e.body_fat_pct), n(e.waist_cm), n(e.resting_hr), n(e.detail), s);
    case "checkin":
      if (e.score == null || !e.metric) return null;
      return db.prepare(`INSERT INTO checkins (message_id, logged_at, metric, score, summary) VALUES (?,?,?,?,?)`)
        .bind(messageId, at, e.metric, e.score, s);
    case "note":
    default:
      return db.prepare(`INSERT INTO notes (message_id, logged_at, note_kind, text, summary) VALUES (?,?,?,?,?)`)
        .bind(messageId, at, e.note_kind ?? "note", e.text ?? e.detail ?? s, s);
  }
}

const CHILD_TABLES = ["strength", "cardio", "meals", "water", "sleep", "time_log", "checkins", "body", "notes"] as const;

async function saveEvents(env: Env, messageId: number, sentAtMs: number, events: Ev[]): Promise<string[]> {
  const stmts: D1PreparedStatement[] = [];
  const lines: string[] = [];
  for (const e of events) {
    const offset = Math.max(-7, Math.min(0, e.day_offset ?? 0));
    const baseUtcMs = sentAtMs + offset * 86400e3;
    let atMs = baseUtcMs;
    if (e.at_time) {
      const [h, m] = e.at_time.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m) && h >= 0 && h < 24 && m >= 0 && m < 60) {
        const istDateStr = new Date(baseUtcMs + 5.5 * 3600e3).toISOString().slice(0, 10);
        atMs = Date.parse(`${istDateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
      }
    }
    const at = new Date(atMs).toISOString();
    const st = insertFor(env.DB, e, messageId, at);
    if (st) {
      stmts.push(st);
      lines.push(`✓ ${e.type}: ${e.summary}${offset ? " (yesterday)" : ""}`);
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return lines;
}

async function deleteMessageRows(env: Env, messageId: number) {
  await env.DB.batch(CHILD_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE message_id = ?`).bind(messageId)));
}

function istDayStartUtcIso(now = Date.now()): string {
  const istDate = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
  return new Date(Date.parse(`${istDate}T00:00:00+05:30`)).toISOString();
}

async function todayText(env: Env): Promise<string> {
  // D1 limits compound SELECTs, so query each table in one batch and merge here.
  const since = istDayStartUtcIso();
  const batches = await env.DB.batch(
    CHILD_TABLES.map((t) => env.DB.prepare(`SELECT summary, logged_at FROM ${t} WHERE logged_at >= ?`).bind(since)),
  );
  const results = batches
    .flatMap((b) => b.results as { summary: string; logged_at: string }[])
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  if (!results.length) return "Nothing logged today.";
  return results
    .map((r) => {
      const t = new Date(Date.parse(r.logged_at) + 5.5 * 3600e3).toISOString().slice(11, 16);
      return `${t}  ${r.summary}`;
    })
    .join("\n");
}

// ---------- Handlers ----------
async function processText(env: Env, messageId: number, sentAtMs: number, text: string): Promise<string> {
  try {
    const { events, model } = await structure(env, text);
    console.log(`parsed ${events.length} event(s) with ${model}: ${events.map((e) => e.type).join(", ")}`);
    const lines = await saveEvents(env, messageId, sentAtMs, events);
    await env.DB.prepare(`UPDATE messages SET status = 'auto', model = ? WHERE id = ?`).bind(model, messageId).run();
    return lines.join("\n") || "✓ saved (no events found)";
  } catch (err) {
    await env.DB.prepare(`UPDATE messages SET status = 'needs_review' WHERE id = ?`).bind(messageId).run();
    return `⚠ saved raw, not structured (${(err as Error).message.slice(0, 120)}). Send /retry later.`;
  }
}

async function handleMessage(env: Env, msg: any) {
  const chatId = msg.chat.id;
  const text: string | undefined = msg.text;
  if (!text) {
    await send(env, chatId, "Text only for now. Use the keyboard mic to dictate.");
    return;
  }

  if (await handleLive(env, msg, text.trim())) return;

  if (text === "/today") {
    await send(env, chatId, await todayText(env));
    return;
  }

  if (text === "/undo") {
    const last = await env.DB.prepare(`SELECT id, text FROM messages ORDER BY id DESC LIMIT 1`).first<{ id: number; text: string }>();
    if (!last) return void (await send(env, chatId, "Nothing to undo."));
    const batch = await env.DB.prepare(`SELECT batch_id FROM batch_lines WHERE message_id = ?`).bind(last.id).first<{ batch_id: string }>();
    if (batch) {
      const { results } = await env.DB.prepare(`SELECT message_id FROM batch_lines WHERE batch_id = ?`).bind(batch.batch_id).all<{ message_id: number }>();
      for (const r of results) await deleteMessageRows(env, r.message_id);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM messages WHERE id IN (SELECT message_id FROM batch_lines WHERE batch_id = ?)`).bind(batch.batch_id),
        env.DB.prepare(`DELETE FROM batch_lines WHERE batch_id = ?`).bind(batch.batch_id),
      ]);
      await send(env, chatId, `↩ removed the last batch (${results.length} lines and everything parsed from them)`);
      return;
    }
    await deleteMessageRows(env, last.id);
    await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(last.id).run();
    await send(env, chatId, `↩ removed: "${last.text.slice(0, 80)}"`);
    return;
  }

  if (text === "/retry") {
    const { results } = await env.DB.prepare(
      `SELECT id, text, received_at FROM messages WHERE status = 'needs_review' ORDER BY id LIMIT 5`,
    ).all<{ id: number; text: string; received_at: string }>();
    if (!results.length) return void (await send(env, chatId, "Nothing waiting for review."));
    const out: string[] = [];
    for (const m of results) {
      await deleteMessageRows(env, m.id);
      out.push(`"${m.text.slice(0, 40)}"\n${await processText(env, m.id, Date.parse(m.received_at), m.text)}`);
    }
    await send(env, chatId, out.join("\n\n"));
    return;
  }

  await send(env, chatId, await logText(env, text, msg.date * 1000, msg.message_id));
}

// Shared by Telegram and the dashboard's quick capture.
export async function logText(env: Env, text: string, sentAtMs: number, tgMessageId: number | null): Promise<string> {
  if (isBatch(text)) return logBatch(env, text, sentAtMs, tgMessageId);
  // 1) store the raw message first, so nothing is ever lost
  const row = await env.DB.prepare(
    `INSERT INTO messages (tg_message_id, received_at, text, status) VALUES (?,?,?, 'needs_review') RETURNING id`,
  ).bind(tgMessageId, new Date(sentAtMs).toISOString(), text).first<{ id: number }>();
  // 2) structure it and write typed rows
  return processText(env, row!.id, sentAtMs, text);
}

// ---------- Batch notes (a whole workout pasted at once) ----------
const MAX_BATCH_LINES = 80;

async function logBatch(env: Env, text: string, sentAtMs: number, tgMessageId: number | null): Promise<string> {
  return logLines(env, parseBatch(text, sentAtMs), tgMessageId);
}

async function logLines(env: Env, all: BatchLine[], tgMessageId: number | null): Promise<string> {
  if (!all.length) return "Nothing to log.";
  const lines = all.slice(0, MAX_BATCH_LINES);
  const cut = all.length - lines.length;

  // 1) skip lines already logged (same minute + same text), so re-sending a note never duplicates
  const keys = lines.map(lineKey);
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT line_key FROM batch_lines WHERE line_key IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk).all<{ line_key: string }>();
    results.forEach((r) => seen.add(r.line_key));
  }
  const fresh = lines.filter((_, i) => !seen.has(keys[i]) && !keys.slice(0, i).includes(keys[i]));
  const dup = lines.length - fresh.length;
  if (!fresh.length) return `↺ All ${lines.length} lines were already logged. Nothing new saved.`;

  // 2) store every new line as its own raw message at its own time (nothing is lost even if parsing fails)
  const batchId = crypto.randomUUID();
  const ins = await env.DB.batch(fresh.map((l, i) =>
    env.DB.prepare(`INSERT INTO messages (tg_message_id, received_at, text, status) VALUES (?,?,?, 'needs_review') RETURNING id`)
      .bind(i === 0 ? tgMessageId : null, new Date(l.atMs).toISOString(), l.text)));
  const ids = ins.map((r) => (r.results[0] as { id: number }).id);
  await env.DB.batch(fresh.map((l, i) =>
    env.DB.prepare(`INSERT INTO batch_lines (line_key, batch_id, message_id, created_at) VALUES (?,?,?,?)`)
      .bind(lineKey(l), batchId, ids[i], new Date().toISOString())));

  // 3) one Gemini call for the whole batch
  const numbered = fresh.map((l, i) => `${i + 1}. [${hhmm(l.atMs)}] ${l.text}`).join("\n");
  let events: Ev[], model: string;
  try {
    ({ events, model } = await structure(env, numbered, BATCH_PROMPT, [25000, 25000]));
  } catch (err) {
    return `⚠ ${fresh.length} lines saved raw with their times, not structured yet (${(err as Error).message.slice(0, 100)}). Send /retry later.`;
  }

  // 4) attach each event to its line's time; fill rest from the gap between sets of the same exercise
  const byLine = new Map<number, Ev[]>();
  for (const e of events) {
    const n = e.line && e.line >= 1 && e.line <= fresh.length ? e.line : 1;
    byLine.set(n, [...(byLine.get(n) ?? []), e]);
  }
  const lastSet = new Map<string, number>();
  const stmts: D1PreparedStatement[] = [];
  const report: string[] = [];
  let sets = 0, volume = 0;
  const exercises = new Set<string>();
  let first = Infinity, last = -Infinity;
  fresh.forEach((l, i) => {
    const evs = byLine.get(i + 1) ?? [];
    if (!evs.length) { report.push(`· ${hhmm(l.atMs)} ${l.text.slice(0, 40)} → nothing stored`); return; }
    for (const e of evs) {
      if (e.type === "strength") {
        const k = (e.exercise ?? e.summary).toLowerCase();
        const prev = lastSet.get(k);
        const gap = prev != null ? Math.round((l.atMs - prev) / 1000) : null;
        if (e.rest_sec == null && gap != null && gap >= 15 && gap <= 900) e.rest_sec = gap;
        lastSet.set(k, l.atMs);
        sets += e.sets ?? 1;
        volume += strengthVolume(e) ?? 0;
        exercises.add(k);
        first = Math.min(first, l.atMs); last = Math.max(last, l.atMs);
      }
      const st = insertFor(env.DB, e, ids[i], new Date(l.atMs).toISOString());
      if (st) { stmts.push(st); report.push(`✓ ${hhmm(l.atMs)} ${e.summary}`); }
    }
  });
  if (stmts.length) await env.DB.batch(stmts);
  await env.DB.batch(ids.map((id) => env.DB.prepare(`UPDATE messages SET status = 'auto', model = ? WHERE id = ?`).bind(model, id)));

  const head = [`📒 ${fresh.length} new line${fresh.length === 1 ? "" : "s"} logged`];
  if (dup) head.push(`${dup} already logged, skipped`);
  if (cut) head.push(`${cut} over the ${MAX_BATCH_LINES}-line limit, send them separately`);
  const out = [head.join(" · "), ...report];
  if (sets) {
    const mins = Math.round((last - first) / 60e3);
    out.push("", `Session ${hhmm(first)}–${hhmm(last)}${mins ? ` (${mins} min)` : ""} · ${exercises.size} exercise${exercises.size === 1 ? "" : "s"} · ${sets} sets${volume ? ` · ${Math.round(volume).toLocaleString("en-IN")} kg volume` : ""}`);
  }
  out.push("Wrong? /undo removes this whole batch.");
  const msg = out.join("\n");
  return msg.length > 3900 ? msg.slice(0, 3880) + "\n… (more in the dashboard)" : msg;
}

// ---------- Gym mode: type sets one by one in Telegram; each is stamped with its send time; /done parses all at once ----------
const AUTO_CLOSE_MS = 3 * 3600e3;   // a session idle this long is closed and logged automatically

type Live = { started_at: string; label: string | null; last_at: string | null; n: number };

async function liveSession(env: Env): Promise<Live | null> {
  return env.DB.prepare(
    `SELECT s.started_at, s.label, (SELECT max(at) FROM live_lines) AS last_at, (SELECT count(*) FROM live_lines) AS n FROM live_session s WHERE s.id = 1`,
  ).first<Live>();
}

async function closeSession(env: Env): Promise<string> {
  const { results } = await env.DB.prepare(`SELECT at, text, tg_message_id FROM live_lines ORDER BY at, id`).all<{ at: string; text: string; tg_message_id: number | null }>();
  const lines: BatchLine[] = results.map((r, i) => ({ idx: i + 1, text: r.text, atMs: Date.parse(r.at), timed: true }));
  const reply = lines.length ? await logLines(env, lines, results[0]?.tg_message_id ?? null) : "Session was empty, nothing logged.";
  // clear the buffer only after logging: logLines already stored every line as a message, so nothing is lost
  await env.DB.batch([env.DB.prepare(`DELETE FROM live_lines`), env.DB.prepare(`DELETE FROM live_session`)]);
  return reply;
}

function react(env: Env, chatId: number | string, messageId: number, emoji = "✍") {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/setMessageReaction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] }),
  }).catch(() => undefined);
}

/** Returns true if the message was handled by gym mode. */
async function handleLive(env: Env, msg: any, text: string): Promise<boolean> {
  const chatId = msg.chat.id;
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "");
  if (cmd === "/gym" || cmd === "/session") {
    const live = await liveSession(env);
    if (live) return void (await send(env, chatId, `Already on: ${live.n} set${live.n === 1 ? "" : "s"} so far. /done to finish.`)), true;
    const label = text.split(/\s+/).slice(1).join(" ").slice(0, 60) || null;
    await env.DB.prepare(`INSERT INTO live_session (id, started_at, label) VALUES (1, ?, ?)`).bind(new Date(msg.date * 1000).toISOString(), label).run();
    await send(env, chatId, `🏋 Gym mode on${label ? `: ${label}` : ""}. Send each set as you do it, e.g. "bench 60x10". I'll stamp the time and react ✍.\n/done to log everything · /status · /undo removes the last set · /cancel discards`);
    return true;
  }
  const live = await liveSession(env);
  if (!live) {
    if (cmd === "/done" || cmd === "/cancel" || cmd === "/status") return void (await send(env, chatId, "No gym session running. Start one with /gym.")), true;
    return false;
  }
  // a session left open too long is closed first, then this message is handled normally
  const lastMs = Date.parse(live.last_at ?? live.started_at);
  if (msg.date * 1000 - lastMs > AUTO_CLOSE_MS) {
    await send(env, chatId, `⏱ Closed the open gym session (idle over 3 h):\n${await closeSession(env)}`);
    return false;
  }
  if (cmd === "/done") return void (await send(env, chatId, await closeSession(env))), true;
  if (cmd === "/cancel") {
    await env.DB.batch([env.DB.prepare(`DELETE FROM live_lines`), env.DB.prepare(`DELETE FROM live_session`)]);
    return void (await send(env, chatId, `🗑 Discarded ${live.n} unsent set${live.n === 1 ? "" : "s"}.`)), true;
  }
  if (cmd === "/status") {
    const { results } = await env.DB.prepare(`SELECT at, text FROM live_lines ORDER BY at, id`).all<{ at: string; text: string }>();
    const body = results.map((r) => `${hhmm(Date.parse(r.at))} ${r.text}`).join("\n") || "(nothing yet)";
    return void (await send(env, chatId, `🏋 Since ${hhmm(Date.parse(live.started_at))}, ${live.n} set${live.n === 1 ? "" : "s"}:\n${body}`.slice(0, 3900))), true;
  }
  if (cmd === "/undo") {
    const last = await env.DB.prepare(`SELECT id, text FROM live_lines ORDER BY at DESC, id DESC LIMIT 1`).first<{ id: number; text: string }>();
    if (!last) return void (await send(env, chatId, "No sets in this session yet.")), true;
    await env.DB.prepare(`DELETE FROM live_lines WHERE id = ?`).bind(last.id).run();
    return void (await send(env, chatId, `↩ removed "${last.text.slice(0, 60)}"`)), true;
  }
  if (text.startsWith("/")) return false;   // other commands (/today) work as usual
  // buffer: one row per line, stamped with Telegram's send time (seconds)
  const at = new Date(msg.date * 1000).toISOString();
  const parts = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
  await env.DB.batch(parts.map((p, i) =>
    env.DB.prepare(`INSERT INTO live_lines (at, text, tg_message_id) VALUES (?,?,?)`).bind(at, p, i === 0 ? msg.message_id : null)));
  await react(env, chatId, msg.message_id);
  return true;
}

// POST /ingest/log — log free text from an iPhone Shortcut (same parsing as Telegram; reply shown as a notification).
// Auth: X-Ryuk-Key = LOG_KEY. Body: {"text": "..."} or text/plain.
async function handleLog(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  if (!env.LOG_KEY) return json({ error: "LOG_KEY not configured" }, 503);
  if (!keyOk(req.headers.get("X-Ryuk-Key"), env.LOG_KEY)) return json({ error: "unauthorized" }, 401);
  const raw = (await req.text()).slice(0, 4096);
  let text = raw;
  if ((req.headers.get("content-type") || "").includes("json")) {
    try { text = String(JSON.parse(raw).text ?? ""); } catch { return json({ error: "invalid json" }, 400); }
  }
  text = text.trim().slice(0, 2000);
  if (!text) return json({ error: "empty text" }, 400);
  const reply = await logText(env, text, Date.now(), null);
  return json({ status: "logged", reply });
}

// Private RPC entrypoint: only reachable through a Service Binding (the dashboard), never from the internet.
export class RyukRPC extends WorkerEntrypoint<Env> {
  async capture(text: string): Promise<string> {
    const clean = String(text ?? "").trim().slice(0, 2000);
    if (!clean) return "Nothing to log.";
    return logText(this.env, clean, Date.now(), null);
  }
  // Log one line at a given time; returns the message id (used when a task on the page is ticked done).
  async captureOne(text: string, at: string): Promise<{ id: number; reply: string }> {
    const clean = String(text ?? "").trim().slice(0, 500);
    const atMs = Date.parse(at);
    if (!clean || !Number.isFinite(atMs)) throw new Error("text and a valid time are required");
    const row = await this.env.DB.prepare(`INSERT INTO messages (tg_message_id, received_at, text, status) VALUES (NULL, ?, ?, 'needs_review') RETURNING id`)
      .bind(new Date(atMs).toISOString(), clean).first<{ id: number }>();
    return { id: row!.id, reply: await processText(this.env, row!.id, atMs, clean) };
  }

  // Edit an already-logged line: new text and/or time; its rows are re-parsed at the new time.
  async relog(id: number, text: string, at: string): Promise<string> {
    const clean = String(text ?? "").trim().slice(0, 500);
    const atMs = Date.parse(at);
    if (!Number.isInteger(id) || !clean || !Number.isFinite(atMs)) throw new Error("id, text and a valid time are required");
    const iso = new Date(atMs).toISOString();
    const old = await this.env.DB.prepare(`SELECT id FROM messages WHERE id = ?`).bind(id).first();
    if (!old) throw new Error("entry not found");
    await deleteMessageRows(this.env, id);
    await this.env.DB.batch([
      this.env.DB.prepare(`UPDATE messages SET text = ?, received_at = ?, status = 'corrected' WHERE id = ?`).bind(clean, iso, id),
      // keep resend-dedupe in step with the new text/time
      this.env.DB.prepare(`UPDATE OR IGNORE batch_lines SET line_key = ? WHERE message_id = ?`).bind(lineKey({ idx: 1, text: clean, atMs, timed: true }), id),
    ]);
    const reply = await processText(this.env, id, atMs, clean);
    await this.env.DB.prepare(`UPDATE messages SET status = 'corrected' WHERE id = ? AND status = 'auto'`).bind(id).run();
    return reply;
  }

  // Dashboard notepad: each line carries the time it was written in the browser.
  async captureLines(lines: { text: string; at: string }[]): Promise<string> {
    const now = Date.now();
    const clean: BatchLine[] = (Array.isArray(lines) ? lines : [])
      .map((l) => ({ text: String(l?.text ?? "").trim().slice(0, 300), atMs: Date.parse(String(l?.at ?? "")) }))
      .filter((l) => l.text && Number.isFinite(l.atMs) && l.atMs <= now + 5 * 60e3 && now - l.atMs <= 7 * 86400e3)
      .sort((a, b) => a.atMs - b.atMs)
      .slice(0, MAX_BATCH_LINES)
      .map((l, i) => ({ idx: i + 1, text: l.text, atMs: l.atMs, timed: true }));
    if (!clean.length) return "Nothing to log (lines need text and a time from the last 7 days).";
    return logLines(this.env, clean, null);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/ingest/health") return handleHealth(req, env);
    if (path === "/ingest/log") return handleLog(req, env);
    if (path.startsWith("/ingest/")) return handleIngest(req, env);
    if (req.method !== "POST" || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("ok");
    }
    const update: any = await req.json();
    const msg = update.message;
    if (!msg) return new Response("ok");
    if (String(msg.chat.id) !== env.OWNER_CHAT_ID) {
      console.log(`ignored chat ${msg.chat.id} (OWNER_CHAT_ID mismatch)`);
      return new Response("ok");
    }
    // Process BEFORE answering Telegram (background work is cut off ~30 s after the response).
    console.log(`msg ${msg.message_id}: ${String(msg.text ?? "").slice(0, 60)}`);
    try {
      await handleMessage(env, msg);
      console.log(`msg ${msg.message_id}: done`);
    } catch (err) {
      console.log(`msg ${msg.message_id}: FAILED ${(err as Error).message}`);
      try { await send(env, msg.chat.id, `❌ failed: ${(err as Error).message.slice(0, 150)}`); } catch {}
    }
    return new Response("ok"); // always 200 so Telegram doesn't redeliver
  },

  // Daily summary at 22:00 IST (cron in wrangler.toml)
  async scheduled(_evt: ScheduledController, env: Env): Promise<void> {
    const live = await liveSession(env);
    if (live && Date.now() - Date.parse(live.last_at ?? live.started_at) > AUTO_CLOSE_MS) {
      await send(env, env.OWNER_CHAT_ID, `⏱ Closed the open gym session:\n${await closeSession(env)}`);
    }
    await send(env, env.OWNER_CHAT_ID, `📓 Today\n${await todayText(env)}\n\nSend energy and focus (1-5) if you haven't.`);
  },
};
