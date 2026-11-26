/**
 * POST /ingest/health — daily Apple Health numbers from the "Health Watcher" iPhone Shortcut.
 * Auth: "Authorization: Bearer <HEALTH_KEY>" (X-Ryuk-Key also accepted). Not behind Cloudflare Access.
 * Body: a Shortcuts Dictionary, e.g. {"steps":"8420","excerciseMinutes":"55","runningSpeed":"5.2","walkRunDistance":"3.5"}.
 * Values arrive as strings; any may be missing. camelCase or snake_case keys both work.
 * One row per IST day: a second sync the same day fills in / updates values, it never blanks one.
 * Plain code only: health data never goes to Gemini, Telegram or the logs.
 */
import { authOk, istDateTime, json } from "./ingest";

export interface HealthEnv { DB: D1Database; HEALTH_KEY?: string }

/** Incoming key (any case, with or without _ - or spaces) -> health_log column. Add a mapping in one line. */
const KEY_MAP: Record<string, string> = {
  steps: "steps",
  excerciseminutes: "exercise_minutes",   // the Shortcut's spelling
  exerciseminutes: "exercise_minutes",
  runningspeed: "running_speed",
  walkrundistance: "walk_run_distance",
  heartrate: "heart_rate_avg",
  heartrateavg: "heart_rate_avg",
  sleep: "sleep_minutes",
  sleepminutes: "sleep_minutes",
  weightkg: "weight_kg",
  weight: "weight_kg",
  activecal: "active_cal",
  activecalories: "active_cal",
  standminutes: "stand_minutes",
  runningpower: "running_power",
  runningstridelength: "running_stride_length",
};

export const HEALTH_COLUMNS = ["steps", "exercise_minutes", "running_speed", "walk_run_distance", "heart_rate_avg", "sleep_minutes",
  "weight_kg", "active_cal", "stand_minutes", "running_power", "running_stride_length"] as const;
const INTEGER_COLS = new Set(["steps", "exercise_minutes", "sleep_minutes", "stand_minutes"]);

const canon = (k: string) => k.replace(/[\s_\-]/g, "").toLowerCase();

/** "8,420" -> 8420, "5.2 km/h" -> 5.2; null for anything without a number. */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Shortcuts may send a list of samples (array, or one per line): average them. */
function average(v: unknown): number | null {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n;]+/) : [v];
  const nums = parts.map(toNum).filter((n): n is number => n != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** "7h 23m" -> 443, "7:23" -> 443, "443" -> 443 (minutes), "7.5 h" -> 450. */
export function sleepMinutes(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  const hm = s.match(/(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m)?/);
  if (hm) return Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0));
  const colon = s.match(/^(\d{1,2}):(\d{2})/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  return toNum(s);
}

export function normalizeHealth(body: Record<string, unknown>): Record<string, number | null> {
  const out: Record<string, number | null> = Object.fromEntries(HEALTH_COLUMNS.map((c) => [c, null]));
  for (const [k, v] of Object.entries(body)) {
    const col = KEY_MAP[canon(k)];
    if (!col) continue;
    let n = col === "sleep_minutes" ? sleepMinutes(v) : col === "heart_rate_avg" ? average(v) : toNum(v);
    if (n == null || n < 0) continue;
    n = INTEGER_COLS.has(col) ? Math.round(n) : Math.round(n * 100) / 100;
    out[col] = n;
  }
  return out;
}

function dayFor(v: unknown): string | null {
  if (v == null || v === "") return istDateTime(Date.now()).date;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);          // 26/11/2026, day first
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

export async function handleHealth(req: Request, env: HealthEnv): Promise<Response> {
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  if (!env.HEALTH_KEY) return json({ error: "HEALTH_KEY not configured" }, 503);
  if (!authOk(req, env.HEALTH_KEY)) return json({ error: "unauthorized" }, 401);

  const raw = (await req.text()).slice(0, 8192);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length) return json({ error: "empty body" }, 400);
  const b = body as Record<string, unknown>;

  // today in IST unless the Shortcut sends a "date" (useful to back-fill a missed day)
  const date = dayFor(b.date);
  if (!date) return json({ error: "bad date" }, 400);
  const vals = normalizeHealth(b);
  const cols = [...HEALTH_COLUMNS];

  await env.DB.prepare(
    `INSERT INTO health_log (date, ${cols.join(", ")}, raw_json) VALUES (?, ${cols.map(() => "?").join(", ")}, ?)
     ON CONFLICT(date) DO UPDATE SET ${cols.map((c) => `${c} = COALESCE(excluded.${c}, health_log.${c})`).join(", ")}, raw_json = excluded.raw_json`,
  ).bind(date, ...cols.map((c) => vals[c]), raw).run();

  const row = await env.DB.prepare(`SELECT steps FROM health_log WHERE date = ?`).bind(date).first<{ steps: number | null }>();
  return json({ ok: true, status: "recorded", date, steps: row?.steps ?? null });
}
