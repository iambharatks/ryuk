/**
 * POST /ingest/health — daily Apple Health totals from an iPhone Shortcut.
 * Auth: header X-Ryuk-Key must equal the HEALTH_KEY secret (separate from the SMS key).
 * Body (JSON, every field optional except that at least one metric is present):
 *   {"date":"2026-11-25","steps":8432,"active_kcal":512,"exercise_min":41,"distance_km":6.2,
 *    "resting_hr":58,"hrv_ms":46,"sleep_min":402,"weight_kg":72.4, ...}
 * Values arrive as numbers or strings ("8,432", "58 BPM"); out-of-range values are dropped.
 * Plain code only: health data never goes to Gemini or Telegram.
 */
import { json, keyOk } from "./ingest";

export interface HealthEnv { DB: D1Database; HEALTH_KEY?: string }

// field -> [min, max, integer?]
export const HEALTH_FIELDS: Record<string, [number, number, boolean]> = {
  steps: [0, 200000, true], distance_km: [0, 300, false], flights: [0, 1000, true],
  active_kcal: [0, 15000, false], resting_kcal: [0, 6000, false], exercise_min: [0, 1440, false],
  stand_hours: [0, 24, true], avg_hr: [20, 250, false], resting_hr: [20, 200, false], walking_hr: [20, 250, false],
  hrv_ms: [1, 400, false], vo2max: [5, 100, false], respiratory_rate: [3, 60, false], spo2_pct: [50, 100, false],
  sleep_min: [0, 1440, false], in_bed_min: [0, 1440, false], weight_kg: [20, 400, false],
  body_fat_pct: [1, 80, false], mindful_min: [0, 1440, false],
};

export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function cleanHealth(body: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, [lo, hi, isInt]] of Object.entries(HEALTH_FIELDS)) {
    let n = toNum(body[k]);
    if (n == null) continue;
    if (k === "spo2_pct" && n > 0 && n <= 1) n *= 100;           // Health sometimes gives 0.97
    if (k === "body_fat_pct" && n > 0 && n < 1) n *= 100;
    if (n < lo || n > hi) continue;
    out[k] = isInt ? Math.round(n) : Math.round(n * 100) / 100;
  }
  return out;
}

const istToday = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10);

export function normDate(v: unknown): string | null {
  if (v == null || v === "") return istToday();
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);           // 25/11/2026 (day first, Indian format)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t + 19800e3).toISOString().slice(0, 10);
}

export async function handleHealth(req: Request, env: HealthEnv): Promise<Response> {
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  if (!env.HEALTH_KEY) return json({ error: "HEALTH_KEY not configured" }, 503);
  if (!keyOk(req.headers.get("X-Ryuk-Key"), env.HEALTH_KEY)) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = JSON.parse((await req.text()).slice(0, 8192)); } catch { return json({ error: "invalid json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "invalid json" }, 400);

  const date = normDate(body.date);
  if (!date) return json({ error: "bad date" }, 400);
  const today = istToday();
  if (date > today || Date.parse(today) - Date.parse(date) > 400 * 86400e3) return json({ error: "date out of range" }, 400);

  const vals = cleanHealth(body);
  const cols = Object.keys(vals);
  if (!cols.length) return json({ status: "ignored", reason: "no_valid_metrics" });

  const all = [...cols, "source", "updated_at"];
  const sql = `INSERT INTO health_daily (date, ${all.join(", ")}) VALUES (?, ${all.map(() => "?").join(", ")})
    ON CONFLICT(date) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}, source = excluded.source, updated_at = excluded.updated_at`;
  await env.DB.prepare(sql).bind(date, ...cols.map((c) => vals[c]), String(body.source ?? "iphone-shortcut").slice(0, 40), new Date().toISOString()).run();
  return json({ status: "recorded", date, fields: cols.length, dropped: Object.keys(body).filter((k) => k in HEALTH_FIELDS && !(k in vals)) });
}
