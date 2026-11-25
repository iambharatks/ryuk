/**
 * Dashboard routes for the daily page, tasks, the shelf and file uploads.
 * Everything here runs after the Access check in index.ts.
 */

export type BotRPC = {
  capture(text: string): Promise<string>;
  captureLines(lines: { text: string; at: string }[]): Promise<string>;
  captureOne(text: string, at: string): Promise<{ id: number; reply: string }>;
  relog(id: number, text: string, at: string): Promise<string>;
};

export interface ExtraEnv {
  DB: D1Database;
  BOT?: BotRPC;
  FILES?: R2Bucket;                 // optional R2 bucket for uploads
}

export const EVENT_TABLES = ["strength", "cardio", "meals", "water", "sleep", "time_log", "checkins", "body", "notes"];

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const istRange = (day: string) => {
  const start = Date.parse(`${day}T00:00:00+05:30`);
  return [new Date(start).toISOString(), new Date(start + 86400e3).toISOString()];
};
const validAt = (v: unknown) => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) && t <= Date.now() + 10 * 60e3 && Date.now() - t <= 400 * 86400e3 ? new Date(t).toISOString() : null;
};
const istDay = (iso: string) => new Date(Date.parse(iso) + 19800e3).toISOString().slice(0, 10);

// ---------- the daily page ----------
export async function getPage(env: ExtraEnv, day: string) {
  if (!DAY_RE.test(day)) return json({ error: "bad day" }, 400);
  const [from, to] = istRange(day);
  const inDay = `SELECT id FROM messages WHERE received_at >= ? AND received_at < ?`;
  const res = await env.DB.batch([
    env.DB.prepare(`SELECT id, received_at, text, status FROM messages WHERE received_at >= ? AND received_at < ? ORDER BY received_at, id`).bind(from, to),
    env.DB.prepare(`SELECT * FROM tasks WHERE day = ? ORDER BY position, id`).bind(day),
    ...EVENT_TABLES.map((t) => env.DB.prepare(`SELECT message_id, summary FROM ${t} WHERE message_id IN (${inDay})`).bind(from, to)),
  ]);
  const parsed = new Map<number, { table: string; summary: string }[]>();
  EVENT_TABLES.forEach((t, i) => {
    for (const r of res[i + 2].results as { message_id: number; summary: string }[]) {
      parsed.set(r.message_id, [...(parsed.get(r.message_id) ?? []), { table: t, summary: r.summary }]);
    }
  });
  const entries = (res[0].results as { id: number; received_at: string; text: string; status: string }[])
    .map((m) => ({ ...m, parsed: parsed.get(m.id) ?? [] }));
  return json({ day, entries, tasks: res[1].results });
}

export async function editEntry(env: ExtraEnv, body: any) {
  const id = Number(body?.id);
  const text = String(body?.text ?? "").trim();
  const at = validAt(body?.at);
  if (!Number.isInteger(id) || !text || !at) return json({ error: "id, text and a valid time are required" }, 400);
  if (!env.BOT) return json({ error: "BOT service binding missing" }, 500);
  return json({ reply: await env.BOT.relog(id, text, at) });
}

// ---------- tasks ----------
async function unlog(env: ExtraEnv, messageId: number) {
  await env.DB.batch([
    ...EVENT_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE message_id = ?`).bind(messageId)),
    env.DB.prepare(`DELETE FROM batch_lines WHERE message_id = ?`).bind(messageId),
    env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(messageId),
  ]);
}

export async function addTask(env: ExtraEnv, body: any) {
  const day = String(body?.day ?? "");
  const text = String(body?.text ?? "").trim().slice(0, 300);
  if (!DAY_RE.test(day) || !text) return json({ error: "day and text are required" }, 400);
  const at = validAt(body?.at) ?? new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO tasks (day, text, created_at, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE day = ?)) RETURNING *`,
  ).bind(day, text, at, day).first();
  return json(row);
}

export async function editTask(env: ExtraEnv, body: any) {
  const id = Number(body?.id);
  const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first<{ id: number; text: string; done_at: string | null; message_id: number | null }>();
  if (!task) return json({ error: "task not found" }, 404);
  let reply: string | undefined;
  const text = body?.text != null ? String(body.text).trim().slice(0, 300) : task.text;
  if (!text) return json({ error: "empty text" }, 400);
  if (body?.text != null) await env.DB.prepare(`UPDATE tasks SET text = ? WHERE id = ?`).bind(text, id).run();

  if (body?.done === true) {
    const at = validAt(body?.at) ?? new Date().toISOString();
    if (!env.BOT) return json({ error: "BOT service binding missing" }, 500);
    if (task.message_id) reply = await env.BOT.relog(task.message_id, text, at);
    else {
      const r = await env.BOT.captureOne(text, at);
      await env.DB.prepare(`UPDATE tasks SET message_id = ? WHERE id = ?`).bind(r.id, id).run();
      reply = r.reply;
    }
    await env.DB.prepare(`UPDATE tasks SET done_at = ? WHERE id = ?`).bind(at, id).run();
  } else if (body?.done === false) {
    if (task.message_id) await unlog(env, task.message_id);
    await env.DB.prepare(`UPDATE tasks SET done_at = NULL, message_id = NULL WHERE id = ?`).bind(id).run();
  } else if (task.done_at && task.message_id && (body?.text != null || body?.at != null)) {
    // a done task edited: re-log its line
    const at = validAt(body?.at) ?? task.done_at;
    if (env.BOT) reply = await env.BOT.relog(task.message_id, text, at);
    await env.DB.prepare(`UPDATE tasks SET done_at = ? WHERE id = ?`).bind(at, id).run();
  }
  return json({ task: await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first(), reply });
}

export async function deleteTask(env: ExtraEnv, body: any) {
  const id = Number(body?.id);
  const task = await env.DB.prepare(`SELECT message_id FROM tasks WHERE id = ?`).bind(id).first<{ message_id: number | null }>();
  if (!task) return json({ error: "task not found" }, 404);
  if (task.message_id && body?.keepLog !== true) await unlog(env, task.message_id);
  await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// ---------- the shelf ----------
const KINDS = ["book", "pdf", "video", "audio", "image", "link"];
const STATUSES = ["active", "paused", "done", "wishlist"];
const LIB_TEXT = ["title", "creator", "url", "note", "kind", "status", "file_key", "mime"];
const LIB_NUM = ["total", "progress"];

function cleanLib(body: any, partial: boolean): { ok: true; v: Record<string, unknown> } | { ok: false; error: string } {
  const v: Record<string, unknown> = {};
  for (const k of LIB_TEXT) if (body?.[k] !== undefined) v[k] = body[k] === null || body[k] === "" ? null : String(body[k]).trim().slice(0, k === "note" ? 2000 : 500);
  for (const k of LIB_NUM) if (body?.[k] !== undefined) {
    if (body[k] === null || body[k] === "") { v[k] = null; continue; }
    const n = Number(body[k]); if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${k} must be a number` }; v[k] = n;
  }
  if (!partial && !v.title) return { ok: false, error: "title is required" };
  if (v.kind != null && !KINDS.includes(String(v.kind))) return { ok: false, error: "unknown kind" };
  if (v.status != null && !STATUSES.includes(String(v.status))) return { ok: false, error: "unknown status" };
  if (v.url != null && !/^https:\/\/[^\s"'<>]+$/i.test(String(v.url))) return { ok: false, error: "link must start with https://" };
  if (v.file_key != null && !/^files\/[a-f0-9-]{36}\/[\w.\-]{1,120}$/.test(String(v.file_key))) return { ok: false, error: "bad file" };
  return { ok: true, v };
}

export async function addLibrary(env: ExtraEnv, body: any) {
  const c = cleanLib(body, false);
  if (!c.ok) return json({ error: c.error }, 400);
  const now = new Date().toISOString();
  const v = { kind: "link", status: "active", ...c.v, created_at: now, updated_at: now };
  const cols = Object.keys(v);
  const row = await env.DB.prepare(`INSERT INTO library (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING *`)
    .bind(...cols.map((k) => (v as any)[k])).first();
  return json(row);
}

export async function editLibrary(env: ExtraEnv, body: any) {
  const id = Number(body?.id);
  const c = cleanLib(body, true);
  if (!c.ok) return json({ error: c.error }, 400);
  delete c.v.progress;   // progress goes through /api/library/progress so it is recorded
  const cols = Object.keys(c.v);
  if (!Number.isInteger(id) || !cols.length) return json({ error: "nothing to change" }, 400);
  await env.DB.prepare(`UPDATE library SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((k) => c.v[k]), new Date().toISOString(), id).run();
  return json(await env.DB.prepare(`SELECT * FROM library WHERE id = ?`).bind(id).first());
}

const fmtSec = (s: number) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };

/** New page / timestamp. Moving forward is also written to time_log (pages read / minutes watched). */
export async function libraryProgress(env: ExtraEnv, body: any) {
  const id = Number(body?.id);
  const value = Number(body?.value);
  if (!Number.isInteger(id) || !Number.isFinite(value) || value < 0) return json({ error: "id and a value are required" }, 400);
  const item = await env.DB.prepare(`SELECT * FROM library WHERE id = ?`).bind(id).first<{ kind: string; title: string; progress: number | null; total: number | null; status: string }>();
  if (!item) return json({ error: "not found" }, 404);
  const at = validAt(body?.at) ?? new Date().toISOString();
  const from = item.progress ?? 0;
  const timed = item.kind === "video" || item.kind === "audio";
  const done = item.total != null && value >= item.total - (timed ? 5 : 0);
  const stmts = [
    env.DB.prepare(`UPDATE library SET progress = ?, status = ?, updated_at = ? WHERE id = ?`).bind(value, done ? "done" : item.status === "wishlist" ? "active" : item.status, at, id),
    env.DB.prepare(`INSERT INTO library_events (item_id, at, from_value, to_value, note) VALUES (?,?,?,?,?)`).bind(id, at, item.progress, value, body?.note ? String(body.note).slice(0, 300) : null),
  ];
  const delta = value - from;
  // only count forward movement of a sensible size as reading / watching time
  if (delta > 0 && (timed ? delta >= 30 && delta <= 6 * 3600 : delta <= 400)) {
    const kind = timed ? (item.kind === "audio" ? "listen" : "watch") : "read";
    const summary = timed ? `${kind === "listen" ? "Listened" : "Watched"} ${item.title} to ${fmtSec(value)}` : `Read ${delta} pages of ${item.title} (to p. ${value})`;
    stmts.push(env.DB.prepare(`INSERT INTO time_log (message_id, logged_at, kind, topic, duration_min, pages, title, detail, summary) VALUES (NULL,?,?,?,?,?,?,?,?)`)
      .bind(at, kind, "other", timed ? Math.round(delta / 6) / 10 : null, timed ? null : delta, item.title, "from the shelf", summary));
  }
  await env.DB.batch(stmts);
  return json({ item: await env.DB.prepare(`SELECT * FROM library WHERE id = ?`).bind(id).first(), logged: delta > 0 });
}

export async function deleteLibrary(env: ExtraEnv, body: any) {
  const id = Number(body?.id);
  const item = await env.DB.prepare(`SELECT file_key FROM library WHERE id = ?`).bind(id).first<{ file_key: string | null }>();
  if (!item) return json({ error: "not found" }, 404);
  if (item.file_key && env.FILES) await env.FILES.delete(item.file_key);
  await env.DB.batch([env.DB.prepare(`DELETE FROM library_events WHERE item_id = ?`).bind(id), env.DB.prepare(`DELETE FROM library WHERE id = ?`).bind(id)]);
  return json({ ok: true });
}

// ---------- files (R2) ----------
const MAX_UPLOAD = 95 * 1024 * 1024;   // Workers accept request bodies up to 100 MB on the free plan
const STORAGE_QUOTA = 7 * 1024 * 1024 * 1024; // 7 GB — stay well under the 10 GB R2 free tier
const CLASS_A_LIMIT = 900_000;  // free tier 1M; 100k buffer
const CLASS_B_LIMIT = 9_000_000; // free tier 10M; 1M buffer
const ALLOWED_MIME = /^(image\/(png|jpe?g|gif|webp|heic|heif|avif)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|aac|wav|ogg|x-m4a))$/;

function currentMonth() { return new Date().toISOString().slice(0, 7); }

async function checkOps(db: D1Database, classA: number, classB: number): Promise<string | null> {
  const m = currentMonth();
  const row = await db.prepare("SELECT class_a, class_b FROM r2_ops WHERE month = ?").bind(m).first<{ class_a: number; class_b: number }>();
  const a = (row?.class_a ?? 0) + classA;
  const b = (row?.class_b ?? 0) + classB;
  if (a > CLASS_A_LIMIT) return `R2 Class A ops limit reached for ${m} (${row?.class_a ?? 0} / ${CLASS_A_LIMIT}). Resets next month.`;
  if (b > CLASS_B_LIMIT) return `R2 Class B ops limit reached for ${m} (${row?.class_b ?? 0} / ${CLASS_B_LIMIT}). Resets next month.`;
  return null;
}

async function trackOps(db: D1Database, classA: number, classB: number) {
  const m = currentMonth();
  await db.prepare(
    "INSERT INTO r2_ops (month, class_a, class_b) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET class_a = class_a + excluded.class_a, class_b = class_b + excluded.class_b"
  ).bind(m, classA, classB).run();
}

export async function upload(req: Request, env: ExtraEnv) {
  if (!env.FILES) return json({ error: "Uploads need the R2 bucket. See README: Shelf uploads." }, 501);
  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.test(type)) return json({ error: `file type not allowed: ${type || "unknown"}` }, 415);
  const size = Number(req.headers.get("content-length") || 0);
  if (size > MAX_UPLOAD) return json({ error: "file is over 95 MB" }, 413);
  // estimate Class A ops: ~1 list page per 1000 files + 1 put
  const opsErr = await checkOps(env.DB, 3, 0);
  if (opsErr) return json({ error: opsErr }, 429);
  let used = 0, listPages = 0;
  let cursor: string | undefined;
  do {
    const list = await env.FILES.list({ prefix: "files/", cursor });
    used += list.objects.reduce((sum, o) => sum + o.size, 0);
    cursor = list.truncated ? list.cursor : undefined;
    listPages++;
  } while (cursor);
  if (used + size > STORAGE_QUOTA) return json({ error: `Storage quota reached (${(used / 1e9).toFixed(1)} / 7.0 GB). Delete files to free space.` }, 507);
  const raw = decodeURIComponent(req.headers.get("x-file-name") || "file");
  const name = raw.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/^[._]+/, "").slice(-100) || "file";
  const key = `files/${crypto.randomUUID()}/${name}`;
  const obj = await env.FILES.put(key, req.body, { httpMetadata: { contentType: type, contentDisposition: "inline" } });
  if (obj.size > MAX_UPLOAD) { await env.FILES.delete(key); await trackOps(env.DB, listPages + 2, 0); return json({ error: "file is over 95 MB" }, 413); }
  await trackOps(env.DB, listPages + 1, 0);
  return json({ key, size: obj.size, mime: type, url: `/api/file/${key}` });
}

export async function serveFile(req: Request, env: ExtraEnv, key: string) {
  if (!env.FILES) return new Response("Not found", { status: 404 });
  if (!/^files\/[a-f0-9-]{36}\/[\w.\-]{1,120}$/.test(key)) return new Response("Not found", { status: 404 });
  const opsErr = await checkOps(env.DB, 0, 1);
  if (opsErr) return new Response(opsErr, { status: 429 });
  const obj = await env.FILES.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response("Not found", { status: 404 });
  await trackOps(env.DB, 0, 1);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (req.headers.get("range") && r) {
    const offset = r.suffix != null ? obj.size - r.suffix : r.offset ?? 0;
    const length = r.suffix != null ? r.suffix : r.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
