/**
 * ryuk-dash: private Ryuk dashboard.
 * Sign-in is a passkey (auth.ts): only devices you registered get a session. While Cloudflare Access is still
 * switched on in front, a valid Access JWT for ALLOWED_EMAIL also counts (verified here, not just trusted).
 * Nothing but the login page and the passkey ceremonies answers without one of the two.
 */
import PAGE from "./page.html";
import { addGoal, addPin, deleteGoal, deletePin, orderPins, editGoal, editPin, listGoals, listPins } from "./workspace";
import { type BotRPC, addLibrary, addTask, deleteLibrary, deleteTask, editEntry, editLibrary, editTask, getPage, libraryProgress, serveFile, upload } from "./extra";
import { type AuthEnv, type Who, crossSite, privateRoute, publicRoute, sessionFrom } from "./auth";
import { addRule, addTxn, coinData, deleteRule, deleteTxn, editTxn, exportTxns, reclassify, setBudget } from "./coin";

export interface Env extends AuthEnv {
  DB: D1Database;
  TEAM_DOMAIN: string;     // e.g. "yourteam.cloudflareaccess.com"
  POLICY_AUD: string;      // Access application "Application Audience (AUD) Tag"
  ALLOWED_EMAIL: string;   // the only email allowed in
  BOT?: BotRPC;            // Service Binding to the bot's RyukRPC entrypoint
  FILES?: R2Bucket;        // R2 bucket for shelf uploads (optional)
}

// ---------- Access JWT verification ----------
type Jwk = JsonWebKey & { kid: string };
let certCache: { keys: Jwk[]; at: number } | null = null;

const b64urlToBytes = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(env: Env): Promise<Jwk[]> {
  if (certCache && Date.now() - certCache.at < 3600e3) return certCache.keys;
  const res = await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`);
  const data: any = await res.json();
  certCache = { keys: data.keys, at: Date.now() };
  return data.keys;
}

// Returns the signed-in email, or a short reason code (shown on the Forbidden page; reveals no values).
async function verifyAccess(req: Request, env: Env): Promise<{ email?: string; reason?: string }> {
  if (!env.TEAM_DOMAIN || env.TEAM_DOMAIN.startsWith("REPLACE") || !env.POLICY_AUD || env.POLICY_AUD.startsWith("REPLACE")) return { reason: "config_missing" };
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { reason: "no_access_token" };
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return { reason: "bad_token" };
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  let keys: Jwk[];
  try { keys = await getKeys(env); } catch { return { reason: "team_domain_unreachable" }; }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { reason: "team_domain_mismatch" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return { reason: "bad_signature" };
  const aud: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.POLICY_AUD)) return { reason: "aud_mismatch" };
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return { reason: "expired" };
  // Service tokens (no email) are not accepted: the iOS app signs in with a passkey like everything else.
  if (env.ALLOWED_EMAIL && String(payload.email ?? "").toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return { reason: "email_mismatch" };
  return { email: payload.email as string };
}

// ---------- Data API ----------
// Columns the dashboard may edit, per table (anything else is rejected).
const EDITABLE: Record<string, string[]> = {
  strength: ["logged_at", "exercise", "muscle_group", "equipment", "sets", "reps", "weight_kg", "set_detail", "volume_kg", "rpe", "rest_sec", "detail"],
  cardio:   ["logged_at", "activity", "setting", "workout_type", "duration_min", "distance_km", "avg_pace_sec_km", "avg_speed_kmh",
             "cadence_spm", "avg_hr", "max_hr", "elevation_gain_m", "calories", "steps", "rpe", "splits", "detail"],
  meals:    ["logged_at", "meal_slot", "items", "source", "calories_est", "protein_g_est", "carbs_g_est", "fat_g_est", "fiber_g_est", "detail"],
  water:    ["logged_at", "ml"],
  sleep:    ["logged_at", "duration_min", "bed_time", "wake_time", "quality", "awakenings", "is_nap", "detail"],
  time_log: ["logged_at", "kind", "topic", "duration_min", "pages", "title", "start_time", "focus_quality", "output", "detail"],
  checkins: ["logged_at", "metric", "score"],
  body:     ["logged_at", "weight_kg", "body_fat_pct", "waist_cm", "resting_hr", "detail"],
  notes:    ["logged_at", "note_kind", "text"],
  messages: ["status"],
  pins:     ["kind", "title", "note", "image_url"],
  finance_log: ["merchant", "type", "channel"],   // amounts and accounts come only from the SMS
  health_log: [],     // read-only: comes from Apple Health
};
const NUMERIC = new Set(["sets", "reps", "weight_kg", "volume_kg", "rpe", "rest_sec", "duration_min", "distance_km",
  "avg_pace_sec_km", "avg_speed_kmh", "cadence_spm", "avg_hr", "max_hr", "elevation_gain_m", "calories", "steps",
  "calories_est", "protein_g_est", "carbs_g_est", "fat_g_est", "fiber_g_est", "ml", "quality", "awakenings", "is_nap",
  "pages", "focus_quality", "score", "body_fat_pct", "waist_cm", "resting_hr"]);
const TABLES = Object.keys(EDITABLE);
const EVENT_TABLES = ["strength", "cardio", "meals", "water", "sleep", "time_log", "checkins", "body", "notes"];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// explicit columns: the SMS hash and the raw health payload never leave the database
const FINANCE_COLS = "id, date, time, type, amount, account_last4, merchant, balance, channel, raw_direction, date_in_sms, source, category, invest_class, note, created_at";
const HEALTH_COLS = "id, date, steps, exercise_minutes, running_speed, walk_run_distance, heart_rate_avg, sleep_minutes, weight_kg, active_cal, stand_minutes, running_power, running_stride_length, created_at";
const istDate = (iso: string) => new Date(Date.parse(iso) + 19800e3).toISOString().slice(0, 10);

/** "7d", "30d", "12w", "3m" or a bare number of days -> days (1..3660). */
function rangeDays(v: string | null, fallback: number): number {
  const m = String(v ?? "").trim().match(/^(\d{1,4})\s*([dwm]?)$/i);
  if (!m) return fallback;
  const unit = m[2].toLowerCase();
  const n = Number(m[1]) * (unit === "w" ? 7 : unit === "m" ? 30 : 1);
  return Math.max(1, Math.min(3660, n));
}
async function rangeRows(env: Env, table: "finance_log" | "health_log", days: number) {
  const from = istDate(new Date(Date.now() - (days - 1) * 86400e3).toISOString());
  const cols = table === "finance_log" ? FINANCE_COLS : HEALTH_COLS;
  const order = table === "finance_log" ? "date DESC, time DESC" : "date DESC";
  const { results } = await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE date >= ? ORDER BY ${order} LIMIT 5000`).bind(from).all();
  return { range: `${days}d`, from, rows: results };
}

async function getData(env: Env, days: number) {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const out: Record<string, unknown[]> = {};
  const stmts = TABLES.map((t) =>
    t === "messages"
      ? env.DB.prepare(`SELECT id, received_at, text, status, model FROM messages WHERE received_at >= ? ORDER BY received_at DESC LIMIT 2000`).bind(since)
      : t === "pins"
        ? env.DB.prepare(`SELECT * FROM pins ORDER BY position IS NULL, position DESC, created_at DESC LIMIT 200`)
      : t === "finance_log"
        ? env.DB.prepare(`SELECT ${FINANCE_COLS} FROM finance_log WHERE date >= ? ORDER BY date DESC, time DESC LIMIT 5000`).bind(istDate(since))
      : t === "health_log"
        ? env.DB.prepare(`SELECT ${HEALTH_COLS} FROM health_log WHERE date >= ? ORDER BY date DESC LIMIT 1000`).bind(istDate(since))
        : env.DB.prepare(`SELECT * FROM ${t} WHERE logged_at >= ? ORDER BY logged_at DESC LIMIT 5000`).bind(since),
  );
  // 365-day activity counts per IST day, for the heatmap (one query per table; D1 limits UNIONs)
  const yearAgo = new Date(Date.now() - 366 * 86400e3).toISOString();
  const countStmts = EVENT_TABLES.map((t) =>
    env.DB.prepare(`SELECT date(logged_at, '+330 minutes') AS d, count(*) AS n FROM ${t} WHERE logged_at >= ? GROUP BY d`).bind(yearAgo),
  );
  const results = await env.DB.batch([...stmts, ...countStmts]);
  TABLES.forEach((t, i) => (out[t] = results[i].results));
  const counts = new Map<string, number>();
  results.slice(TABLES.length).forEach((r) =>
    (r.results as { d: string; n: number }[]).forEach(({ d, n }) => counts.set(d, (counts.get(d) || 0) + n)),
  );
  out.daily_counts = [...counts].map(([d, n]) => ({ d, n })).sort((a, b) => a.d.localeCompare(b.d));
  out.library = (await env.DB.prepare(`SELECT * FROM library ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'wishlist' THEN 2 ELSE 3 END, updated_at DESC LIMIT 500`).all()).results;
  (out as any).uploads = !!env.FILES;
  return out;
}

async function editRow(env: Env, body: any) {
  const { table, id, field } = body ?? {};
  if (!TABLES.includes(table) || !EDITABLE[table].includes(field) || !Number.isInteger(id)) return json({ error: "not editable" }, 400);
  let value = body.value;
  if (value === "" || value === undefined) value = null;
  if (value !== null && NUMERIC.has(field)) {
    value = Number(value);
    if (!Number.isFinite(value)) return json({ error: "not a number" }, 400);
  }
  if (field === "logged_at" && value !== null && Number.isNaN(Date.parse(value))) return json({ error: "bad date" }, 400);
  if (field === "image_url" && value !== null && !/^(https:\/\/[^\s"'<>]+|\/api\/file\/files\/[a-f0-9-]{36}\/[\w.\-]{1,120})$/i.test(String(value))) return json({ error: "image must be an https link or an upload" }, 400);
  if (table === "finance_log" && field === "type" && !["debit", "credit", "refund"].includes(String(value))) return json({ error: "type must be debit, credit or refund" }, 400);
  if (table === "finance_log" && field === "channel" && !["bank", "upi", "card", "auto_debit"].includes(String(value))) return json({ error: "channel must be bank, upi, card or auto_debit" }, 400);
  await env.DB.prepare(`UPDATE ${table} SET ${field} = ? WHERE id = ?`).bind(value, id).run();
  if (EVENT_TABLES.includes(table)) {
    // mark the source message as corrected so you know which rows were fixed by hand
    await env.DB.prepare(`UPDATE messages SET status = 'corrected' WHERE id = (SELECT message_id FROM ${table} WHERE id = ?)`).bind(id).run();
  }
  return json({ ok: true });
}

async function capture(env: Env, body: any) {
  const text = String(body?.text ?? "").trim();
  if (!text) return json({ error: "empty" }, 400);
  if (!env.BOT) return json({ error: "BOT service binding missing" }, 500);
  const reply = await env.BOT.capture(text);
  return json({ reply });
}

// Notepad: lines stamped in the browser as they were typed; the bot logs them in one batch (re-sending is safe).
async function notepad(env: Env, body: any) {
  const lines = Array.isArray(body?.lines) ? body.lines.slice(0, 80) : [];
  const clean = lines
    .map((l: any) => ({ text: String(l?.text ?? "").trim().slice(0, 300), at: String(l?.at ?? "") }))
    .filter((l: { text: string; at: string }) => l.text && !Number.isNaN(Date.parse(l.at)));
  if (!clean.length) return json({ error: "no lines" }, 400);
  if (!env.BOT) return json({ error: "BOT service binding missing" }, 500);
  return json({ reply: await env.BOT.captureLines(clean) });
}

async function deleteRow(env: Env, body: any) {
  const { table, id } = body ?? {};
  if (!TABLES.includes(table) || !Number.isInteger(id)) return json({ error: "bad request" }, 400);
  if (table === "messages") {
    const children = EVENT_TABLES;
    await env.DB.batch([
      ...children.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE message_id = ?`).bind(id)),
      env.DB.prepare(`DELETE FROM batch_lines WHERE message_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(id),
    ]);
  } else {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  }
  return json({ ok: true });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (crossSite(req, url)) return new Response("Forbidden (cross_site)", { status: 403, headers: { "cache-control": "no-store" } });

    // who is this: a passkey session, else (while Access is still on) the Access JWT Cloudflare attached
    let who: Who | null = await sessionFrom(req, env);
    let reason = "signed_out";
    if (!who && req.headers.get("Cf-Access-Jwt-Assertion")) {
      const a = await verifyAccess(req, env).catch(() => ({ reason: "verify_error" }) as { email?: string; reason?: string });
      if (a.email) who = { via: "access", email: a.email }; else reason = a.reason ?? "bad_token";
    }

    const open = await publicRoute(req, env, url, who);
    if (open) return open;
    if (!who) {
      if (reason !== "signed_out") return new Response(`Forbidden (${reason})`, { status: 403, headers: { "cache-control": "no-store" } });
      const page = req.method === "GET" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/");
      return page
        ? new Response(null, { status: 302, headers: { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`, "cache-control": "no-store" } })
        : json({ error: "signed out" }, 401);
    }
    const mine = await privateRoute(req, env, url, who);
    if (mine) return mine;

    if (url.pathname === "/" && req.method === "GET") {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        },
      });
    }
    if (url.pathname === "/api/data" && req.method === "GET") {
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
      return json(await getData(env, days));
    }
    if (url.pathname === "/api/health" && req.method === "GET") return json(await rangeRows(env, "health_log", rangeDays(url.searchParams.get("range"), 7)));
    if (url.pathname === "/api/finance" && req.method === "GET") return json(await rangeRows(env, "finance_log", rangeDays(url.searchParams.get("range"), 30)));
    // Money (finance), apart from the daily logs
    if (url.pathname === "/api/coin" && req.method === "GET") return coinData(env, url);
    if (url.pathname === "/api/coin/export" && req.method === "GET") return exportTxns(env, url);
    if (url.pathname === "/api/coin/txn" && req.method === "POST") return addTxn(env, await req.json());
    if (url.pathname === "/api/coin/txn" && req.method === "PATCH") return editTxn(env, await req.json());
    if (url.pathname === "/api/coin/txn" && req.method === "DELETE") return deleteTxn(env, await req.json());
    if (url.pathname === "/api/coin/rules" && req.method === "POST") return addRule(env, await req.json());
    if (url.pathname === "/api/coin/rules" && req.method === "DELETE") return deleteRule(env, await req.json());
    if (url.pathname === "/api/coin/budgets" && req.method === "PUT") return setBudget(env, await req.json());
    if (url.pathname === "/api/coin/reclassify" && req.method === "POST") return reclassify(env);
    if (url.pathname === "/api/row" && req.method === "PATCH") return editRow(env, await req.json());
    if (url.pathname === "/api/row" && req.method === "DELETE") return deleteRow(env, await req.json());
    if (url.pathname === "/api/pins" && req.method === "GET") return listPins(env);
    if (url.pathname === "/api/pins" && req.method === "POST") return addPin(env, await req.json());
    if (url.pathname === "/api/pins/order" && req.method === "PUT") return orderPins(env, await req.json());
    if (url.pathname === "/api/goals" && req.method === "GET") return listGoals(env, url.searchParams.get("date"));
    if (url.pathname === "/api/goals" && req.method === "POST") return addGoal(env, await req.json());
    const item = url.pathname.match(/^\/api\/(goals|pins)\/(\d{1,12})$/);
    if (item) {
      const id = Number(item[2]);
      if (item[1] === "goals" && req.method === "PATCH") return editGoal(env, id, await req.json());
      if (item[1] === "goals" && req.method === "DELETE") return deleteGoal(env, id);
      if (item[1] === "pins" && req.method === "PATCH") return editPin(env, id, await req.json());
      if (item[1] === "pins" && req.method === "DELETE") return deletePin(env, id);
    }
    if (url.pathname === "/api/capture" && req.method === "POST") return capture(env, await req.json());
    if (url.pathname === "/api/notepad" && req.method === "POST") return notepad(env, await req.json());
    if (url.pathname === "/api/page" && req.method === "GET") return getPage(env, url.searchParams.get("day") ?? "");
    if (url.pathname === "/api/entry" && req.method === "PATCH") return editEntry(env, await req.json());
    if (url.pathname === "/api/tasks" && req.method === "POST") return addTask(env, await req.json());
    if (url.pathname === "/api/tasks" && req.method === "PATCH") return editTask(env, await req.json());
    if (url.pathname === "/api/tasks" && req.method === "DELETE") return deleteTask(env, await req.json());
    if (url.pathname === "/api/library" && req.method === "POST") return addLibrary(env, await req.json());
    if (url.pathname === "/api/library" && req.method === "PATCH") return editLibrary(env, await req.json());
    if (url.pathname === "/api/library" && req.method === "DELETE") return deleteLibrary(env, await req.json());
    if (url.pathname === "/api/library/progress" && req.method === "POST") return libraryProgress(env, await req.json());
    if (url.pathname === "/api/upload" && req.method === "POST") return upload(req, env);
    if (url.pathname.startsWith("/api/file/") && (req.method === "GET" || req.method === "HEAD")) return serveFile(req, env, decodeURIComponent(url.pathname.slice("/api/file/".length)));
    return new Response("Not found", { status: 404 });
  },
};
