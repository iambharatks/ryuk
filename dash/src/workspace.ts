/**
 * Gaze workspace: the daily goals board (sticky notes) and the pin wall (posters).
 * Runs after the Access check in index.ts.
 *
 * Goals are per IST day and never carried over: each day starts with an empty board.
 * Pins reuse the existing `pins` table: quote text lives in `note`; `position` and `link` were added by migration 002.
 */
import { type ExtraEnv, json, saveFile } from "./extra";

const STICKY_COLORS = ["#f5e6a3", "#f5c6c6", "#c6d8f5", "#c6f5d0"];
const MAX_GOALS = 12;        // the board shows ~10; this stops a runaway client
const MAX_PINS = 24;         // the wall shows 12
const MAX_IMAGE = 10 * 1024 * 1024;

const istDay = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
/** a steady tilt in [-max, max] degrees, one decimal */
const tilt = (seed: string, max: number) => Math.round(((hash(seed) % 1000) / 1000 * 2 - 1) * max * 10) / 10;
const isHttps = (s: string) => /^https:\/\/[^\s"'<>]+$/i.test(s);
const isUpload = (s: string) => /^\/api\/file\/files\/[a-f0-9-]{36}\/[\w.\-]{1,120}$/i.test(s);

// ---------------- goals ----------------
export async function listGoals(env: ExtraEnv, day: string | null) {
  const d = day && isDay(day) ? day : istDay();
  const { results } = await env.DB.prepare(`SELECT * FROM daily_goals WHERE date = ? ORDER BY position, id`).bind(d).all();
  return json({ date: d, goals: results });
}

export async function addGoal(env: ExtraEnv, body: any) {
  const text = String(body?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text) return json({ error: "a goal needs words" }, 400);
  const date = body?.date == null ? istDay() : body.date;
  if (!isDay(date)) return json({ error: "bad date" }, 400);
  const c = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS p FROM daily_goals WHERE date = ?`).bind(date).first<{ n: number; p: number }>();
  if ((c?.n ?? 0) >= MAX_GOALS) return json({ error: `the board holds ${MAX_GOALS} a day` }, 400);
  const row = await env.DB.prepare(`INSERT INTO daily_goals (date, text, done, color, rotation, position) VALUES (?,?,0,?,?,?) RETURNING *`)
    .bind(date, text, STICKY_COLORS[(c?.n ?? 0) % STICKY_COLORS.length], tilt(`${date}|${text}|${c?.n ?? 0}`, 3), (c?.p ?? 0) + 1).first();
  return json(row);
}

export async function editGoal(env: ExtraEnv, id: number, body: any) {
  const sets: string[] = [], vals: unknown[] = [];
  if (body?.done != null) { sets.push("done = ?"); vals.push(body.done === true || body.done === 1 || body.done === "1" ? 1 : 0); }
  if (body?.text != null) {
    const text = String(body.text).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text) return json({ error: "a goal needs words" }, 400);
    sets.push("text = ?"); vals.push(text);
  }
  if (body?.position != null) {
    if (!Number.isInteger(body.position)) return json({ error: "position must be a whole number" }, 400);
    sets.push("position = ?"); vals.push(body.position);
  }
  if (!sets.length) return json({ error: "nothing to change" }, 400);
  const row = await env.DB.prepare(`UPDATE daily_goals SET ${sets.join(", ")} WHERE id = ? RETURNING *`).bind(...vals, id).first();
  return row ? json(row) : json({ error: "not found" }, 404);
}

export async function deleteGoal(env: ExtraEnv, id: number) {
  await env.DB.prepare(`DELETE FROM daily_goals WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// ---------------- pins ----------------
export async function listPins(env: ExtraEnv) {
  const { results } = await env.DB.prepare(`SELECT * FROM pins ORDER BY COALESCE(position, 1000000), created_at DESC LIMIT ${MAX_PINS}`).all();
  return json({ pins: results });
}

/** Copy a linked image into R2 so the wall doesn't hotlink. Keeps the original link if R2 is off or the copy fails. */
async function copyImage(env: ExtraEnv, url: string): Promise<string> {
  if (!env.FILES) return url;
  try {
    const r = await fetch(url, { headers: { accept: "image/*" }, redirect: "follow" });
    const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!r.ok || !type.startsWith("image/") || Number(r.headers.get("content-length") || 0) > MAX_IMAGE) return url;
    const buf = await r.arrayBuffer();
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image");
    const s = await saveFile(env, buf, buf.byteLength, type, name, MAX_IMAGE);
    return s.ok ? `/api/file/${s.key}` : url;
  } catch {
    return url;
  }
}

function cleanPin(body: any, partial: boolean): { ok: true; v: Record<string, unknown> } | { ok: false; error: string } {
  const v: Record<string, unknown> = {};
  if (!partial || body?.title != null) {
    const title = String(body?.title ?? "").trim().slice(0, 120);
    if (!title) return { ok: false, error: "title required" };
    v.title = title;
  }
  const quote = body?.quote ?? body?.note;
  if (quote !== undefined) v.note = quote === null || String(quote).trim() === "" ? null : String(quote).trim().slice(0, 500);
  if (body?.link !== undefined) {
    const link = body.link ? String(body.link).trim() : null;
    if (link && !isHttps(link)) return { ok: false, error: "link must be an https address" };
    v.link = link;
  }
  if (body?.image_url !== undefined) {
    const img = body.image_url ? String(body.image_url).trim() : null;
    if (img && !isHttps(img) && !isUpload(img)) return { ok: false, error: "image must be an https link or an upload" };
    v.image_url = img;
  }
  if (body?.position !== undefined) {
    if (body.position !== null && !Number.isInteger(body.position)) return { ok: false, error: "position must be a whole number" };
    v.position = body.position;
  }
  if (body?.kind !== undefined) v.kind = ["goal", "inspiration", "media"].includes(body.kind) ? body.kind : "inspiration";
  return { ok: true, v };
}

export async function addPin(env: ExtraEnv, body: any) {
  const c = cleanPin(body, false);
  if (!c.ok) return json({ error: c.error }, 400);
  const n = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS p FROM pins`).first<{ n: number; p: number }>();
  if ((n?.n ?? 0) >= MAX_PINS) return json({ error: `the wall holds ${MAX_PINS} pins; unpin one first` }, 400);
  const v = c.v;
  if (typeof v.image_url === "string" && isHttps(v.image_url)) v.image_url = await copyImage(env, v.image_url);
  const row = await env.DB.prepare(`INSERT INTO pins (created_at, kind, title, note, image_url, link, position) VALUES (?,?,?,?,?,?,?) RETURNING *`)
    .bind(new Date().toISOString(), v.kind ?? (v.image_url ? "media" : "inspiration"), v.title, v.note ?? null, v.image_url ?? null, v.link ?? null, (n?.p ?? 0) + 1).first();
  return json(row);
}

export async function editPin(env: ExtraEnv, id: number, body: any) {
  const c = cleanPin(body, true);
  if (!c.ok) return json({ error: c.error }, 400);
  const cols = Object.keys(c.v);
  if (!cols.length) return json({ error: "nothing to change" }, 400);
  if (typeof c.v.image_url === "string" && isHttps(c.v.image_url)) c.v.image_url = await copyImage(env, c.v.image_url);
  const row = await env.DB.prepare(`UPDATE pins SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ? RETURNING *`).bind(...cols.map((k) => c.v[k]), id).first();
  return row ? json(row) : json({ error: "not found" }, 404);
}

export async function deletePin(env: ExtraEnv, id: number) {
  const pin = await env.DB.prepare(`SELECT image_url FROM pins WHERE id = ?`).bind(id).first<{ image_url: string | null }>();
  await env.DB.prepare(`DELETE FROM pins WHERE id = ?`).bind(id).run();
  // an uploaded image goes with its pin, unless something else still uses it
  const key = pin?.image_url && isUpload(pin.image_url) ? pin.image_url.slice("/api/file/".length) : null;
  if (key && env.FILES) {
    const used = await env.DB.prepare(`SELECT 1 FROM pins WHERE image_url = ? UNION ALL SELECT 1 FROM library WHERE file_key = ? LIMIT 1`).bind(pin!.image_url, key).first();
    if (!used) await env.FILES.delete(key);
  }
  return json({ ok: true });
}
