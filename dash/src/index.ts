/**
 * ryuk-dash: private Ryuk dashboard.
 * Cloudflare Access sits in front of this Worker; the Worker ALSO verifies the Access JWT itself,
 * so the data stays private even if Access is ever switched off by mistake.
 */
import PAGE from "./page.html";
import { type BotRPC, addLibrary, addTask, deleteLibrary, deleteTask, editEntry, editLibrary, editTask, getPage, libraryProgress, serveFile, upload } from "./extra";

export interface Env {
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
  transactions: ["counterparty", "category", "kind", "purpose", "status", "note"],
  merchant_rules: ["display_name", "category", "kind", "ignore"],
  health_daily: [],   // read-only: comes from Apple Health
};
const NUMERIC = new Set(["ignore", "sets", "reps", "weight_kg", "volume_kg", "rpe", "rest_sec", "duration_min", "distance_km",
  "avg_pace_sec_km", "avg_speed_kmh", "cadence_spm", "avg_hr", "max_hr", "elevation_gain_m", "calories", "steps",
  "calories_est", "protein_g_est", "carbs_g_est", "fat_g_est", "fiber_g_est", "ml", "quality", "awakenings", "is_nap",
  "pages", "focus_quality", "score", "body_fat_pct", "waist_cm", "resting_hr"]);
const TABLES = Object.keys(EDITABLE);
const EVENT_TABLES = ["strength", "cardio", "meals", "water", "sleep", "time_log", "checkins", "body", "notes"];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function getData(env: Env, days: number) {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const out: Record<string, unknown[]> = {};
  const stmts = TABLES.map((t) =>
    t === "messages"
      ? env.DB.prepare(`SELECT id, received_at, text, status, model FROM messages WHERE received_at >= ? ORDER BY received_at DESC LIMIT 2000`).bind(since)
      : t === "pins"
        ? env.DB.prepare(`SELECT * FROM pins ORDER BY created_at DESC LIMIT 200`)
      : t === "transactions"
        ? env.DB.prepare(`SELECT * FROM transactions WHERE txn_at >= ? ORDER BY txn_at DESC LIMIT 5000`).bind(since)
      : t === "merchant_rules"
        ? env.DB.prepare(`SELECT * FROM merchant_rules ORDER BY created_at DESC LIMIT 1000`)
      : t === "health_daily"
        ? env.DB.prepare(`SELECT rowid AS id, * FROM health_daily WHERE date >= ? ORDER BY date DESC LIMIT 1000`).bind(since.slice(0, 10))
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
  await env.DB.prepare(`UPDATE ${table} SET ${field} = ? WHERE id = ?`).bind(value, id).run();
  if (table === "transactions" && ["counterparty", "category", "kind"].includes(field)) {
    // Teach once: remember the correction for this merchant and apply it to its other, unconfirmed rows.
    const row = await env.DB.prepare(`SELECT counterparty_key, vpa FROM transactions WHERE id = ?`).bind(id).first<{ counterparty_key: string | null; vpa: string | null }>();
    const key = row?.counterparty_key || row?.vpa;
    if (key) {
      const col = field === "counterparty" ? "display_name" : field;
      await env.DB.prepare(`INSERT INTO merchant_rules (match_key, ${col}, created_at) VALUES (?,?,?) ON CONFLICT(match_key) DO UPDATE SET ${col} = excluded.${col}`)
        .bind(key, value, new Date().toISOString()).run();
      await env.DB.prepare(`UPDATE transactions SET ${field} = ? WHERE counterparty_key = ? AND id != ? AND status != 'confirmed'`).bind(value, key, id).run();
    }
    await env.DB.prepare(`UPDATE transactions SET status = 'confirmed' WHERE id = ? AND status != 'ignored'`).bind(id).run();
  }
  if (table !== "messages" && table !== "pins" && table !== "transactions" && table !== "merchant_rules") {
    // mark the source message as corrected so you know which rows were fixed by hand
    await env.DB.prepare(`UPDATE messages SET status = 'corrected' WHERE id = (SELECT message_id FROM ${table} WHERE id = ?)`).bind(id).run();
  }
  return json({ ok: true });
}

async function addPin(env: Env, body: any) {
  const kind = ["goal", "inspiration", "media"].includes(body?.kind) ? body.kind : "goal";
  const title = String(body?.title ?? "").trim().slice(0, 200);
  const note = body?.note ? String(body.note).trim().slice(0, 1000) : null;
  let image = body?.image_url ? String(body.image_url).trim() : null;
  if (!title) return json({ error: "title required" }, 400);
  if (image && !/^https:\/\/[^\s"'<>]+$/i.test(image)) return json({ error: "image must be an https link" }, 400);
  const row = await env.DB.prepare(`INSERT INTO pins (created_at, kind, title, note, image_url) VALUES (?,?,?,?,?) RETURNING *`)
    .bind(new Date().toISOString(), kind, title, note, image).first();
  return json(row);
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
    const idCol = table === "health_daily" ? "rowid" : "id";
    await env.DB.prepare(`DELETE FROM ${table} WHERE ${idCol} = ?`).bind(id).run();
  }
  return json({ ok: true });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const auth = await verifyAccess(req, env).catch(() => ({ reason: "verify_error" }) as { email?: string; reason?: string });
    if (!auth.email) return new Response(`Forbidden (${auth.reason})`, { status: 403, headers: { "cache-control": "no-store" } });

    const url = new URL(req.url);
    if (url.pathname === "/" && req.method === "GET") {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'",
        },
      });
    }
    if (url.pathname === "/api/data" && req.method === "GET") {
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
      return json(await getData(env, days));
    }
    if (url.pathname === "/api/row" && req.method === "PATCH") return editRow(env, await req.json());
    if (url.pathname === "/api/row" && req.method === "DELETE") return deleteRow(env, await req.json());
    if (url.pathname === "/api/pins" && req.method === "POST") return addPin(env, await req.json());
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
