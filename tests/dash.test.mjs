// Dashboard API end-to-end: real Access JWT check (locally generated key), fake D1 (node:sqlite),
// the real bot RPC behind the service binding (with a stubbed Gemini), and an in-memory R2.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const dash = (await import("../.wrangler/dash-test.mjs")).default;
const botMod = await import("../.wrangler/bot-test.mjs");

const sq = new DatabaseSync(":memory:");
sq.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  _run() { const p = sq.prepare(sql); return /^\s*(SELECT|WITH)|RETURNING/i.test(sql) ? { results: p.all(...args), success: true } : (p.run(...args), { results: [], success: true }); },
  async run() { return this._run(); }, async all() { return this._run(); }, async first() { return this._run().results[0] ?? null; },
});
const DB = { prepare: (s) => stmt(s), batch: async (arr) => arr.map((s) => s._run()) };

// in-memory R2 with range support
const store = new Map();
const FILES = {
  async put(key, body, opts) { const buf = new Uint8Array(await new Response(body).arrayBuffer()); store.set(key, { buf, meta: opts?.httpMetadata ?? {} }); return { size: buf.length }; },
  async delete(key) { store.delete(key); },
  async list({ prefix = "" } = {}) {
    const objects = [...store].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.buf.length }));
    return { objects, truncated: false };
  },
  async get(key, opts) {
    const o = store.get(key); if (!o) return null;
    const h = opts?.range; const rh = h?.get?.("range"); let range, data = o.buf;
    if (rh) { const m = rh.match(/bytes=(\d+)-(\d*)/); const off = +m[1]; const end = m[2] ? +m[2] : o.buf.length - 1; range = { offset: off, length: end - off + 1 }; data = o.buf.slice(off, end + 1); }
    return { size: o.buf.length, httpEtag: '"e"', range, body: new Blob([data]).stream(), writeHttpMetadata: (hd) => hd.set("content-type", o.meta.contentType) };
  },
};

// Access: sign our own JWT and serve its public key as the team's certs
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256" };
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwt = async (claims) => {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
};
const good = await jwt({ aud: ["AUD1"], email: "me@example.com", exp: Math.floor(Date.now() / 1000) + 3600 });

globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.endsWith("/cdn-cgi/access/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
  if (url.includes("generativelanguage")) {
    const msg = JSON.parse(init.body).contents[0].parts.at(-1).text;
    const m = msg.match(/(bench|squat|read)\w*\s+(\d+)x?(\d+)?/i);
    const events = m ? [{ type: "strength", summary: `${m[1]} ${m[2]}x${m[3] ?? 1}`, exercise: m[1], sets: 1, reps: +(m[3] ?? 1), weight_kg: +m[2] }] : [{ type: "note", summary: "note", text: msg }];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events }) }] } }] }));
  }
  if (url.includes("api.telegram.org")) return new Response("{}");
  if (url === "https://img.test/poster.png") return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), { headers: { "content-type": "image/png" } });
  if (url === "https://img.test/page.html") return new Response("<script>", { headers: { "content-type": "text/html" } });
  throw new Error("unexpected fetch " + url);
};

const botEnv = { DB, GEMINI_MODEL: "m", GEMINI_API_KEY: "k", TELEGRAM_TOKEN: "t", OWNER_CHAT_ID: "1" };
const BOT = new botMod.RyukRPC({}, botEnv);
const env = { DB, BOT, FILES, TEAM_DOMAIN: "team.cloudflareaccess.com", POLICY_AUD: "AUD1", ALLOWED_EMAIL: "me@example.com" };
const call = async (method, path, body, headers = {}, token = good) => {
  const init = { method, headers: { "Cf-Access-Jwt-Assertion": token, ...headers } };
  if (body !== undefined) { init.body = typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body); if (!headers["content-type"]) init.headers["content-type"] = "application/json"; }
  const res = await dash.fetch(new Request("https://dash.test" + path, init), env);
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, body: ct.includes("json") ? await res.json() : await res.text() };
};
let fail = 0; const ok = (n, c, extra = "") => { console.log((c ? "ok  " : "FAIL") + " " + n + (c ? "" : " " + JSON.stringify(extra).slice(0, 400))); if (!c) fail++; };
const q = (s) => sq.prepare(s).all();

// ---- access ----
let r = await call("GET", "/api/data", undefined, {}, "");
ok("no token -> Forbidden (no_access_token)", r.status === 403 && /no_access_token/.test(r.body), r);
r = await call("GET", "/api/data", undefined, {}, await jwt({ aud: ["OTHER"], email: "me@example.com", exp: Math.floor(Date.now() / 1000) + 3600 }));
ok("wrong AUD -> aud_mismatch", r.status === 403 && /aud_mismatch/.test(r.body), r);
r = await call("GET", "/api/data", undefined, {}, await jwt({ aud: ["AUD1"], email: "x@example.com", exp: Math.floor(Date.now() / 1000) + 3600 }));
ok("other email -> email_mismatch", r.status === 403 && /email_mismatch/.test(r.body), r);
r = await call("GET", "/");
ok("page loads with media CSP", r.status === 200 && /media-src 'self' blob:/.test(r.headers.get("content-security-policy")));

// ---- the daily page ----
const day = new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
const t0 = Date.now() - 3600e3;
await BOT.captureLines([{ text: "bench 60x10", at: new Date(t0).toISOString() }, { text: "felt strong today", at: new Date(t0 + 60e3).toISOString() }]);
r = await call("GET", `/api/page?day=${day}`);
ok("page lists today's entries with what was parsed", r.body.entries?.length === 2 && r.body.entries[0].parsed[0]?.table === "strength", r.body);
const e0 = r.body.entries[0];
r = await call("PATCH", "/api/entry", { id: e0.id, text: "bench 70x8", at: new Date(t0 - 600e3).toISOString() });
ok("edit entry re-parses it", /70x8/.test(r.body.reply ?? ""), r.body);
const st = q(`SELECT weight_kg, logged_at FROM strength WHERE message_id = ${e0.id}`);
ok("edited row has new values and time", st.length === 1 && st[0].weight_kg === 70 && st[0].logged_at === new Date(t0 - 600e3).toISOString(), st);
ok("edited message marked corrected", q(`SELECT status, text FROM messages WHERE id = ${e0.id}`)[0].status === "corrected");
r = await call("PATCH", "/api/entry", { id: e0.id, text: "", at: "nope" });
ok("bad edit rejected", r.status === 400);

// ---- tasks ----
r = await call("POST", "/api/tasks", { day, text: "squat 100x5" });
const task = r.body;
ok("task added", task?.id && !task.done_at, r.body);
r = await call("PATCH", "/api/tasks", { id: task.id, done: true });
ok("ticking a task logs it", r.body.task?.done_at && r.body.task?.message_id && q(`SELECT count(*) c FROM strength WHERE message_id = ${r.body.task.message_id}`)[0].c === 1, r.body);
const tmid = r.body.task.message_id;
r = await call("PATCH", "/api/tasks", { id: task.id, text: "squat 110x5" });
ok("editing a done task re-logs it", q(`SELECT weight_kg FROM strength WHERE message_id = ${tmid}`)[0]?.weight_kg === 110, q(`SELECT * FROM strength WHERE message_id = ${tmid}`));
r = await call("PATCH", "/api/tasks", { id: task.id, done: false });
ok("unticking removes the log", !r.body.task.done_at && q(`SELECT count(*) c FROM messages WHERE id = ${tmid}`)[0].c === 0);
r = await call("DELETE", "/api/tasks", { id: task.id });
ok("task deleted", r.body.ok && q("SELECT count(*) c FROM tasks")[0].c === 0);

// ---- shelf ----
r = await call("POST", "/api/library", { kind: "book", title: "Designing Data-Intensive Applications", creator: "Kleppmann", total: 590, progress: 120 });
const book = r.body;
ok("book added", book.id && book.progress === 120, r.body);
r = await call("POST", "/api/library/progress", { id: book.id, value: 150 });
ok("page 120 -> 150 logs 30 pages read", r.body.item.progress === 150 && q("SELECT pages FROM time_log WHERE detail = 'from the shelf'")[0]?.pages === 30, r.body);
r = await call("POST", "/api/library", { kind: "video", title: "MIT 6.824 Lecture 3", url: "https://www.youtube.com/watch?v=abc", total: 4800 });
const vid = r.body;
await call("POST", "/api/library/progress", { id: vid.id, value: 600 });
await call("POST", "/api/library/progress", { id: vid.id, value: 1500 });
const w = q("SELECT duration_min, kind FROM time_log WHERE kind = 'watch'");
ok("video timestamps log minutes watched", w.length === 2 && w[1].duration_min === 15, w);
r = await call("POST", "/api/library/progress", { id: vid.id, value: 4799 });
ok("reaching the end marks done", r.body.item.status === "done");
r = await call("POST", "/api/library", { kind: "link", title: "x", url: "javascript:alert(1)" });
ok("non-https link rejected", r.status === 400);
r = await call("PATCH", "/api/library", { id: book.id, note: "ch 5 replication", progress: 999 });
ok("edit keeps progress (progress only via /progress)", r.body.note === "ch 5 replication" && r.body.progress === 150, r.body);
r = await call("GET", "/api/data?days=30");
ok("library comes with /api/data", r.body.library?.length === 2 && r.body.uploads === true);

// ---- uploads ----
const pdf = new Uint8Array(1000).map((_, i) => i % 256);
r = await call("POST", "/api/upload", pdf, { "content-type": "application/pdf", "x-file-name": encodeURIComponent("My Notes (v2).pdf") });
ok("pdf upload", r.status === 200 && /^files\/[a-f0-9-]{36}\/My_Notes_v2_.pdf$/.test(r.body.key), r.body);
const key = r.body.key;
r = await call("GET", "/api/file/" + key);
ok("file served with type", r.status === 200 && r.headers.get("content-type") === "application/pdf" && r.headers.get("content-length") === "1000");
r = await call("GET", "/api/file/" + key, undefined, { range: "bytes=100-199" });
ok("range request -> 206", r.status === 206 && r.headers.get("content-range") === "bytes 100-199/1000" && r.headers.get("content-length") === "100", [r.status, r.headers.get("content-range")]);
r = await call("POST", "/api/upload", "<script>", { "content-type": "text/html", "x-file-name": "x.html" });
ok("html upload refused", r.status === 415);
r = await call("GET", "/api/file/files/../../secret");
ok("path tricks refused", r.status === 404);
r = await call("GET", "/api/file/" + key, undefined, {}, "");
ok("files need Access too", r.status === 403);
r = await call("POST", "/api/library", { kind: "pdf", title: "My notes", file_key: key, mime: "application/pdf", total: 40 });
const p = r.body;
r = await call("DELETE", "/api/library", { id: p.id });
ok("deleting an item deletes its file", r.body.ok && !store.has(key));
r = await call("PATCH", "/api/row", { table: "pins", id: 1, field: "image_url", value: "/api/file/files/00000000-0000-0000-0000-000000000000/a.png" });
ok("pins accept uploaded images", r.status === 200, r.body);

// ---- goals board ----
const today = new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
r = await call("POST", "/api/goals", { text: "  Deadlift   100x5 " });
const g1 = r.body;
ok("goal added for today", r.status === 200 && g1.date === today && g1.text === "Deadlift 100x5" && g1.done === 0, r.body);
ok("goal gets a sticky colour and a tilt within ±3°", /^#[0-9a-f]{6}$/.test(g1.color) && Math.abs(g1.rotation) <= 3, g1);
r = await call("POST", "/api/goals", { text: "Read 20 pages" });
ok("second goal has the next colour and position", r.body.color !== g1.color && r.body.position === g1.position + 1, r.body);
r = await call("POST", "/api/goals", { text: "" });
ok("empty goal refused", r.status === 400);
r = await call("POST", "/api/goals", { text: "x", date: "not-a-day" });
ok("bad date refused", r.status === 400);
r = await call("POST", "/api/goals", { text: "Old one", date: "2026-01-02" });
r = await call("GET", "/api/goals");
ok("today's board only (no carry-over)", r.body.date === today && r.body.goals.length === 2 && r.body.goals.every((g) => g.date === today), r.body);
r = await call("GET", "/api/goals?date=2026-01-02");
ok("another day's board by date", r.body.goals.length === 1 && r.body.goals[0].text === "Old one", r.body);
r = await call("PATCH", `/api/goals/${g1.id}`, { done: true });
ok("goal ticked", r.body.done === 1, r.body);
r = await call("PATCH", `/api/goals/${g1.id}`, { done: false, text: "Deadlift 105x5" });
ok("goal unticked and reworded", r.body.done === 0 && r.body.text === "Deadlift 105x5", r.body);
r = await call("PATCH", `/api/goals/${g1.id}`, {});
ok("empty patch refused", r.status === 400);
r = await call("PATCH", "/api/goals/999999", { done: true });
ok("missing goal -> 404", r.status === 404);
r = await call("DELETE", `/api/goals/${g1.id}`);
ok("goal removed", r.body.ok && !q(`SELECT 1 FROM daily_goals WHERE id = ${g1.id}`).length);
for (let i = 0; i < 11; i++) await call("POST", "/api/goals", { text: `filler ${i}` });
r = await call("POST", "/api/goals", { text: "one too many" });
ok("board holds 12 a day", r.status === 400 && q(`SELECT COUNT(*) AS n FROM daily_goals WHERE date = '${today}'`)[0].n === 12, r.body);
r = await call("GET", "/api/goals", undefined, {}, "");
ok("goals need Access", r.status === 403);

// ---- pin wall ----
r = await call("POST", "/api/pins", { title: "On the work", quote: "Fewer things, done slowly and well." });
const qp = r.body;
ok("quote pin stored in note", r.status === 200 && qp.note === "Fewer things, done slowly and well." && qp.image_url === null && qp.kind === "inspiration", r.body);
r = await call("POST", "/api/pins", { title: "10k under 60", image_url: "https://img.test/poster.png", link: "https://example.com/plan" });
const ip = r.body;
const ipKey = ip.image_url?.slice("/api/file/".length);
ok("linked image copied into R2", /^\/api\/file\/files\/[a-f0-9-]{36}\/poster\.png$/.test(ip.image_url) && store.has(ipKey) && ip.link === "https://example.com/plan", ip);
ok("pins are ordered", ip.position === qp.position + 1, ip);
r = await call("POST", "/api/pins", { title: "Not an image", image_url: "https://img.test/page.html" });
ok("non-image link kept as a link, not stored", r.body.image_url === "https://img.test/page.html", r.body);
r = await call("POST", "/api/pins", { title: "bad", image_url: "javascript:alert(1)" });
ok("non-https image refused", r.status === 400);
r = await call("POST", "/api/pins", { title: "bad", link: "http://x.test" });
ok("non-https link refused", r.status === 400);
r = await call("POST", "/api/pins", { quote: "no title" });
ok("pin needs a title", r.status === 400);
r = await call("GET", "/api/pins");
ok("pins listed in wall order", r.body.pins.length >= 3 && r.body.pins.findIndex((x) => x.id === qp.id) < r.body.pins.findIndex((x) => x.id === ip.id), r.body);
r = await call("PATCH", `/api/pins/${ip.id}`, { position: 0 });
ok("pin moved", r.body.position === 0);
r = await call("GET", "/api/pins");
ok("moved pin comes first", r.body.pins[0].id === ip.id, r.body.pins.map((x) => x.id));
r = await call("DELETE", `/api/pins/${ip.id}`);
ok("unpinning deletes its copied image", r.body.ok && !store.has(ipKey) && !q(`SELECT 1 FROM pins WHERE id = ${ip.id}`).length);
r = await call("DELETE", `/api/pins/${qp.id}`, undefined, {}, "");
ok("pins need Access", r.status === 403);

// ---- health and finance reads ----
sq.exec(`INSERT INTO health_log (date, steps, raw_json) VALUES ('${today}', 8420, '{"steps":"8420"}'), ('2020-01-01', 1, '{}')`);
sq.exec(`INSERT INTO finance_log (date, time, type, amount, account_last4, merchant, sms_hash) VALUES ('${today}', '10:00', 'debit', 500, '1234', 'SWIGGY', 'h1')`);
r = await call("GET", "/api/health?range=7d");
ok("/api/health returns the range", r.body.range === "7d" && r.body.rows.length === 1 && r.body.rows[0].steps === 8420, r.body);
ok("/api/health never returns the raw payload", !("raw_json" in r.body.rows[0]));
r = await call("GET", "/api/finance?range=30d");
ok("/api/finance returns parsed rows", r.body.rows.length === 1 && r.body.rows[0].merchant === "SWIGGY", r.body);
ok("/api/finance never returns the SMS hash", !("sms_hash" in r.body.rows[0]));
r = await call("GET", "/api/finance?range=nonsense");
ok("bad range falls back to the default", r.body.range === "30d", r.body);
r = await call("GET", "/api/finance", undefined, {}, "");
ok("finance needs Access", r.status === 403);
r = await call("PATCH", "/api/row", { table: "finance_log", id: 1, field: "amount", value: 1 });
ok("amounts can't be edited", r.status === 400);
r = await call("PATCH", "/api/row", { table: "finance_log", id: 1, field: "type", value: "bogus" });
ok("finance type must be debit/credit/refund", r.status === 400);

const noFiles = { ...env, FILES: undefined };
const r2 = await dash.fetch(new Request("https://dash.test/api/upload", { method: "POST", headers: { "Cf-Access-Jwt-Assertion": good, "content-type": "image/png" }, body: "x" }), noFiles);
ok("no bucket -> clear 501", r2.status === 501);
console.log(fail ? `${fail} FAILED` : "ALL PASS");
if (fail) process.exit(1);
