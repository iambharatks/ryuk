/**
 * Ryuk bot v2: Telegram -> Gemini (structure) -> Cloudflare D1 (typed tables)
 * Free stack: Cloudflare Workers + D1 + Gemini free tier.
 * Commands: /today  /undo  /retry
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { handleIngest } from "./ingest";

export interface Env {
  DB: D1Database;                  // D1 binding (wrangler.toml)
  TELEGRAM_TOKEN: string;          // secret
  WEBHOOK_SECRET: string;          // secret
  GEMINI_API_KEY: string;          // secret
  OWNER_CHAT_ID: string;           // var
  GEMINI_MODEL: string;            // var, primary model
  GEMINI_FALLBACK_MODEL?: string;  // var, used on 429 / 404 / 5xx / timeout
  INGEST_KEY?: string;             // secret, for /ingest/* (iPhone Shortcuts)
  LARGE_TXN_INR?: string;          // var, threshold for the "large" flag
  FINANCE_ALERTS?: string;         // var, "1" = detail-free Telegram ping for flagged transactions
}

// ---------- Event model (what Gemini returns) ----------
type EventType = "strength" | "cardio" | "meal" | "water" | "sleep" | "time" | "checkin" | "body" | "note";

type Ev = {
  type: EventType;
  summary: string;
  day_offset?: number | null;
  at_time?: string | null;     // "HH:MM" IST; overrides message send time when stated
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
   The app auto-derives these — do NOT fill them yourself: avg_pace_sec_km (derived from distance+duration if missing),
   avg_speed_kmh (cycling only, same), volume_kg (sets × reps × weight). Fill everything else the user states.
   Converting stated formats is EXPECTED, not "computing": "55:20" -> duration_min 55.33; "5:32/km" -> avg_pace_sec_km 332;
   "2h30m" -> duration_min 150. If the user states a pace explicitly ("avg 5:32"), fill avg_pace_sec_km 332.
4. day_offset: 0 normally, -1 for yesterday ("kal", "last night", "yesterday").
5. detail: short English extra info worth keeping; null if none.
6. summary: 3-8 word English title, e.g. "Bench press 3x10 at 60kg", "Run 5 km in 30 min".
7. CRITICAL — every number you put in the summary MUST also be in its structured field. "Bench press 3x10 at 60kg"
   -> sets=3, reps=10, weight_kg=60. "10 km run in 55 min 20 sec" -> distance_km=10, duration_min=55.33.
   Never leave a field null when you already extracted the value for the summary.
8. VOICE DICTATION — input may come from voice transcription. Common garbling: "5520" = "55:20" = 55.33 min;
   "532" = "5:32" = 332 sec/km pace; "contains"/"cadence" both mean cadence_spm; "or five 5158"/"hr 158" = avg_hr 158.
9. at_time: fill with "HH:MM" 24h IST when the user states or implies WHEN the activity happened (not message time).
   Stated: "ran at 7am" -> "07:00"; "9:30 baje" -> "09:30"; "evening run" -> "18:00".
   Hindi/Hinglish: "subah" -> "07:00", "dopahar" -> "13:00", "shaam" -> "18:00", "raat" -> "21:00".
   "just did it" / "right now" / no time mention -> null (app uses message time).
10. UNSTRUCTURED INPUT — be flexible; extract what you can, null the rest. "about / roughly / ~" -> use that number.
    Ranges like "3-4 sets" -> use the higher value (4). Missing units -> infer from context ("bench 60 4x10" = 60 kg).
    "chest day" alone -> one strength event per exercise mentioned. If only the muscle group is stated with no exercise,
    use muscle_group and leave exercise null.

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
"subah 7 baje ran 10k 55:20 avg 5:32 cadence 172 hr 158 max 176"
-> cardio Run outdoor 55.33 min 10 km, pace 332, cadence 172, avg_hr 158, max_hr 176, at_time "07:00"
"chest day, did roughly 4 sets bench around 60kg, 3-4 sets incline 50, khatam 9pm ke baad"
-> strength Bench press sets=4 reps=null weight_kg=60 at_time "21:00";
   strength Incline dumbbell press sets=4 reps=null weight_kg=50 at_time "21:00"`;

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

async function callGemini(env: Env, model: string, text: string, timeoutMs: number): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, { text: `Message: """${text}"""` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
}

async function structure(env: Env, text: string): Promise<{ events: Ev[]; model: string }> {
  const models = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter((m): m is string => !!m);
  let lastErr = "";
  for (const [i, model] of models.entries()) {
    let res: Response;
    try {
      res = await callGemini(env, model, text, TIMEOUTS_MS[Math.min(i, TIMEOUTS_MS.length - 1)]);
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
        // at_time is IST; build a UTC ms value for that clock time on the base date
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

  if (text === "/today") {
    await send(env, chatId, await todayText(env));
    return;
  }

  if (text === "/undo") {
    const last = await env.DB.prepare(`SELECT id, text FROM messages ORDER BY id DESC LIMIT 1`).first<{ id: number; text: string }>();
    if (!last) return void (await send(env, chatId, "Nothing to undo."));
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
  // 1) store the raw message first, so nothing is ever lost
  const row = await env.DB.prepare(
    `INSERT INTO messages (tg_message_id, received_at, text, status) VALUES (?,?,?, 'needs_review') RETURNING id`,
  ).bind(tgMessageId, new Date(sentAtMs).toISOString(), text).first<{ id: number }>();
  // 2) structure it and write typed rows
  return processText(env, row!.id, sentAtMs, text);
}

// Private RPC entrypoint: only reachable through a Service Binding (the dashboard), never from the internet.
export class RyukRPC extends WorkerEntrypoint<Env> {
  async capture(text: string): Promise<string> {
    const clean = String(text ?? "").trim().slice(0, 2000);
    if (!clean) return "Nothing to log.";
    return logText(this.env, clean, Date.now(), null);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/ingest/")) return handleIngest(req, env);
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
    await send(env, env.OWNER_CHAT_ID, `📓 Today\n${await todayText(env)}\n\nSend energy and focus (1-5) if you haven't.`);
  },
};
