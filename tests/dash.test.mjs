// Dashboard API end-to-end: real Access JWT check (locally generated key), fake D1 (node:sqlite),
// the real bot RPC behind the service binding (with a stubbed Gemini), and an in-memory R2.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const env = { DB, BOT, FILES, TEAM_DOMAIN: "team.cloudflareaccess.com", POLICY_AUD: "AUD1", ALLOWED_EMAIL: "me@example.com", ALLOWED_SERVICE_TOKEN: "tok1.access" };
// "signed in" for the API tests: a session row seeded straight into D1 (the sign-in ceremonies are tested below)
const FIXTURE = "fixture-session-token-0123456789abcdef";
const SIGNED_IN = `__Host-ryuk=${FIXTURE}`;
const seedSession = () => {
  const now = Date.now(), hash = createHash("sha256").update(FIXTURE).digest("hex");
  sq.prepare(`INSERT OR REPLACE INTO auth_sessions (token_hash, credential_id, kind, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)`)
    .run(hash, "fixture", "browser", new Date(now).toISOString(), new Date(now + 30 * 86400e3).toISOString(), new Date(now).toISOString());
};
seedSession();
// token: good = signed in; "" = nobody; anything else = sent as a Cloudflare Access JWT (which no longer counts)
const call = async (method, path, body, headers = {}, token = good) => {
  const auth = token === good ? { cookie: SIGNED_IN } : token ? { "Cf-Access-Jwt-Assertion": token } : {};
  const init = { method, headers: { ...auth, ...headers } };
  if (body !== undefined) { init.body = typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body); if (!headers["content-type"]) init.headers["content-type"] = "application/json"; }
  const res = await dash.fetch(new Request("https://dash.test" + path, init), env);
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, body: ct.includes("json") ? await res.json() : await res.text() };
};
let fail = 0; const ok = (n, c, extra = "") => { console.log((c ? "ok  " : "FAIL") + " " + n + (c ? "" : " " + JSON.stringify(extra).slice(0, 400))); if (!c) fail++; };
const q = (s) => sq.prepare(s).all();

// ---- access ----
let r = await call("GET", "/api/data", undefined, {}, "");
ok("no sign-in at all -> 401 signed out", r.status === 401 && r.body.error === "signed out", r);
r = await call("GET", "/api/data", undefined, {}, good + "x");
ok("a Cloudflare Access JWT, even a valid one, no longer opens anything", r.status === 401, r);
r = await call("GET", "/api/data", undefined, {}, await jwt({ aud: ["AUD1"], common_name: "tok1.access", exp: Math.floor(Date.now() / 1000) + 3600 }));
ok("the old service token opens nothing", r.status === 401, r);
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

// open tasks carry forward; a kept one stays on the day it was kept and is gone the next
const yday = new Date(Date.now() + 19800e3 - 86400e3).toISOString().slice(0, 10);
const yAt = new Date(Date.parse(`${yday}T12:00:00+05:30`)).toISOString();
const ins = sq.prepare(`INSERT INTO tasks (day, text, created_at, done_at, position) VALUES (?, ?, ?, ?, 1)`);
ins.run(yday, "open from yesterday", yAt, null);
ins.run(yday, "kept yesterday", yAt, yAt);
r = await call("GET", `/api/page?day=${day}`);
const names = (r.body.tasks ?? []).map((t) => t.text);
ok("open task carries to the next day", names.includes("open from yesterday"), names);
ok("kept task is gone the next day", !names.includes("kept yesterday"), names);
r = await call("GET", `/api/page?day=${yday}`);
ok("kept task stays on the day it was kept", (r.body.tasks ?? []).some((t) => t.text === "kept yesterday"), r.body.tasks);
sq.prepare(`DELETE FROM tasks`).run();

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
ok("files need a sign-in too", r.status === 401);
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
r = await call("POST", "/api/goals", { text: "x".repeat(150) + "  overflow that is cut off at one hundred and sixty" });
ok("a longer note is allowed, capped at 160", r.status === 200 && r.body.text.length === 160, r.body.text?.length);
await call("DELETE", `/api/goals/${r.body.id}`);
r = await call("POST", "/api/goals", { text: "x", date: "not-a-day" });
ok("bad date refused", r.status === 400);
r = await call("POST", "/api/goals", { text: "Old one", date: "2026-01-02" });
r = await call("GET", "/api/goals");
ok("an open note from an earlier day carries forward", r.body.date === today && r.body.goals.length === 3 && r.body.goals.some((g) => g.text === "Old one"), r.body);
r = await call("GET", "/api/goals?date=2026-01-02");
ok("another day's board by date", r.body.goals.length === 1 && r.body.goals[0].text === "Old one", r.body);
r = await call("PATCH", `/api/goals/${g1.id}`, { done: true });
ok("goal ticked, with when", r.body.done === 1 && !Number.isNaN(Date.parse(r.body.done_at)), r.body);
r = await call("GET", "/api/goals");
ok("a note kept today stays on today's board", r.body.goals.some((g) => g.id === g1.id && g.done === 1), r.body);
sq.exec(`INSERT INTO daily_goals (date, text, done, done_at) VALUES ('2026-01-01', 'kept long ago', 1, '2026-01-03T06:00:00.000Z'), ('2026-01-01', 'kept, no stamp', 1, NULL)`);
r = await call("GET", "/api/goals");
ok("a note kept on an earlier day is gone", !r.body.goals.some((g) => g.text === "kept long ago" || g.text === "kept, no stamp"), r.body);
r = await call("GET", "/api/goals?date=2026-01-03");
ok("...but it was on the board the day it was kept", r.body.goals.some((g) => g.text === "kept long ago") && !r.body.goals.some((g) => g.text === "kept, no stamp"), r.body);
sq.exec(`DELETE FROM daily_goals WHERE text IN ('kept long ago', 'kept, no stamp')`);
r = await call("PATCH", `/api/goals/${g1.id}`, { done: false, text: "Deadlift 105x5" });
ok("goal unticked and reworded", r.body.done === 0 && r.body.done_at === null && r.body.text === "Deadlift 105x5", r.body);
r = await call("PATCH", `/api/goals/${g1.id}`, { x: 0.42, y: 180, z: 7 });
ok("a dragged note keeps its place", r.body.x === 0.42 && r.body.y === 180 && r.body.z === 7, r.body);
r = await call("PATCH", `/api/goals/${g1.id}`, { x: 1.5 });
ok("x outside the board refused", r.status === 400);
r = await call("PATCH", `/api/goals/${g1.id}`, { y: -3 });
ok("negative y refused", r.status === 400);
r = await call("PATCH", `/api/goals/${g1.id}`, { z: 1.5 });
ok("fractional z refused", r.status === 400);
r = await call("PATCH", `/api/goals/${g1.id}`, {});
ok("empty patch refused", r.status === 400);
r = await call("PATCH", "/api/goals/999999", { done: true });
ok("missing goal -> 404", r.status === 404);
r = await call("DELETE", `/api/goals/${g1.id}`);
ok("goal removed", r.body.ok && !q(`SELECT 1 FROM daily_goals WHERE id = ${g1.id}`).length);
for (let i = 0; i < 22; i++) await call("POST", "/api/goals", { text: `filler ${i}` });
r = await call("POST", "/api/goals", { text: "one too many" });
ok("board holds 24 notes at once", r.status === 400 && /tear one off/.test(r.body.error) && (await call("GET", "/api/goals")).body.goals.length === 24, r.body);
r = await call("GET", "/api/goals", undefined, {}, "");
ok("goals need a sign-in", r.status === 401);

// ---- pin wall ----
r = await call("POST", "/api/pins", { title: "On the work", quote: "Fewer things, done slowly and well." });
const qp = r.body;
ok("quote pin stored in note", r.status === 200 && qp.note === "Fewer things, done slowly and well." && qp.image_url === null && qp.kind === "inspiration", r.body);
r = await call("POST", "/api/pins", { title: "10k under 60", image_url: "https://img.test/poster.png", link: "https://example.com/plan" });
const ip = r.body;
const ipKey = ip.image_url?.slice("/api/file/".length);
ok("linked image copied into R2", /^\/api\/file\/files\/[a-f0-9-]{36}\/poster\.png$/.test(ip.image_url) && store.has(ipKey) && ip.link === "https://example.com/plan", ip);
ok("pins are ordered", ip.position === qp.position + 1, ip);
r = await call("GET", "/api/pins");
ok("newest pin first", r.body.pins[0].id === ip.id, r.body.pins.map((x) => x.id));
r = await call("POST", "/api/pins", { title: "Not an image", image_url: "https://img.test/page.html" });
ok("non-image link kept as a link, not stored", r.body.image_url === "https://img.test/page.html", r.body);
r = await call("POST", "/api/pins", { title: "bad", image_url: "javascript:alert(1)" });
ok("non-https image refused", r.status === 400);
r = await call("POST", "/api/pins", { title: "bad", link: "http://x.test" });
ok("non-https link refused", r.status === 400);
r = await call("POST", "/api/pins", { quote: "no title" });
ok("pin needs a title", r.status === 400);
r = await call("GET", "/api/pins");
const before = r.body.pins.map((x) => x.id);
const wanted = [qp.id, ...before.filter((i) => i !== qp.id)];
r = await call("PUT", "/api/pins/order", { ids: wanted });
ok("pins reordered", r.status === 200, r.body);
r = await call("GET", "/api/pins");
ok("wall keeps the order you dragged", r.body.pins.map((x) => x.id).join() === wanted.join(), r.body.pins.map((x) => x.id));
r = await call("GET", "/api/data?days=1");
ok("/api/data pins in the same order", r.body.pins.map((x) => x.id).join() === wanted.join(), r.body.pins.map((x) => x.id));
r = await call("PUT", "/api/pins/order", { ids: [qp.id, qp.id] });
ok("duplicate ids refused", r.status === 400);
r = await call("PUT", "/api/pins/order", { ids: ["1; DROP TABLE pins"] });
ok("non-integer ids refused", r.status === 400);
r = await call("PUT", "/api/pins/order", { ids: [qp.id] }, {}, "");
ok("reordering needs a sign-in", r.status === 401);
r = await call("DELETE", `/api/pins/${ip.id}`);
ok("unpinning deletes its copied image", r.body.ok && !store.has(ipKey) && !q(`SELECT 1 FROM pins WHERE id = ${ip.id}`).length);
r = await call("DELETE", `/api/pins/${qp.id}`, undefined, {}, "");
ok("pins need a sign-in", r.status === 401);

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
ok("finance needs a sign-in", r.status === 401);
r = await call("PATCH", "/api/row", { table: "finance_log", id: 1, field: "amount", value: 1 });
ok("amounts can't be edited", r.status === 400);
r = await call("PATCH", "/api/row", { table: "finance_log", id: 1, field: "type", value: "bogus" });
ok("finance type must be debit/credit/refund", r.status === 400);

// ---- Money (/api/coin) ----
sq.exec(`INSERT INTO finance_log (date, time, type, amount, account_last4, merchant, sms_hash) VALUES
  ('${today}', '09:00', 'debit', 5000, '1234', 'PPFAS MUTUAL FUND', 'h2'), ('${today}', '09:30', 'debit', 300, '1234', 'RAJU TEA STALL', 'h3'),
  ('${today}', '10:30', 'credit', 90000, '1234', 'ACME SALARY', 'h4'), ('${today}', '11:00', 'debit', 120, '1234', 'RAJU TEA STALL', 'h5')`);
r = await call("GET", "/api/coin");
ok("/api/coin returns rows, rules, budgets, labels", r.status === 200 && r.body.rows.length === 5 && Array.isArray(r.body.rules) && r.body.categories.food && r.body.invest_classes.gold, r.body);
ok("/api/coin never returns the SMS hash", !("sms_hash" in r.body.rows[0]));
r = await call("GET", "/api/coin", undefined, {}, "");
ok("/api/coin needs a sign-in", r.status === 401);
r = await call("POST", "/api/coin/reclassify");
const filed = (m) => sq.prepare("SELECT category, invest_class, category_src FROM finance_log WHERE merchant = ? ORDER BY id").all(m);
ok("re-file: built-in lists file the MF, salary and SWIGGY", r.body.changed >= 3 && filed("PPFAS MUTUAL FUND")[0].invest_class === "mutual_fund" && filed("ACME SALARY")[0].category === "income" && filed("SWIGGY")[0].category === "food", [r.body, filed("PPFAS MUTUAL FUND")]);
const teaId = sq.prepare("SELECT id FROM finance_log WHERE merchant = 'RAJU TEA STALL' ORDER BY id").all()[0].id;
r = await call("PATCH", "/api/coin/txn", { id: teaId, category: "food", note: "chai", remember: true });
ok("file by hand + remember makes a rule and files the other one", r.status === 200 && r.body.row.category_src === "manual" && r.body.row.note === "chai" && r.body.applied === 1 && filed("RAJU TEA STALL")[1].category === "food", r.body);
ok("rule stored upper-case", sq.prepare("SELECT pattern FROM finance_rules").all().some((x) => x.pattern === "RAJU TEA STALL"));
r = await call("PATCH", "/api/coin/txn", { id: teaId, category: "investment" });
ok("investment always gets a class", r.body.row.invest_class === "other", r.body);
r = await call("PATCH", "/api/coin/txn", { id: teaId, category: "bogus" });
ok("unknown category rejected", r.status === 400);
r = await call("PATCH", "/api/coin/txn", { id: teaId, amount: 1 });
ok("amount can't be changed", r.status === 400);
r = await call("POST", "/api/coin/rules", { pattern: "raju", category: "investment", invest_class: "gold" });
ok("a rule never overrides a hand-filed row", r.status === 200 && filed("RAJU TEA STALL")[0].category === "investment" && filed("RAJU TEA STALL")[0].invest_class === "other" && filed("RAJU TEA STALL")[1].invest_class === "gold", [r.body, filed("RAJU TEA STALL")]);
r = await call("POST", "/api/coin/rules", { pattern: "x", category: "food" });
ok("rule pattern needs 2+ chars", r.status === 400);
r = await call("POST", "/api/coin/txn", { date: today, type: "debit", amount: 250, merchant: "Barber", channel: "cash", account_last4: "1234567890" });
ok("add by hand: auto-filed, last 4 only", r.status === 200 && r.body.row.source === "manual" && r.body.row.category === "personal" && r.body.row.account_last4 === "7890", r.body);
const manualId = r.body.row?.id;
r = await call("POST", "/api/coin/txn", { date: "2999-01-01", type: "debit", amount: 1 });
ok("add: future date rejected", r.status === 400);
r = await call("POST", "/api/coin/txn", { date: today, type: "debit", amount: -5 });
ok("add: negative amount rejected", r.status === 400);
r = await call("PUT", "/api/coin/budgets", { category: "food", monthly_limit: 6000 });
ok("budget saved", r.status === 200 && sq.prepare("SELECT monthly_limit FROM finance_budgets WHERE category = 'food'").get()?.monthly_limit === 6000);
r = await call("PUT", "/api/coin/budgets", { category: "investment", monthly_limit: 6000 });
ok("no budgets on investments", r.status === 400);
r = await call("PUT", "/api/coin/budgets", { category: "food", monthly_limit: null });
ok("budget cleared", !sq.prepare("SELECT * FROM finance_budgets").all().length);
r = await call("GET", "/api/coin");
ok("all-time investment totals", r.body.invest_all.some((c) => c.invest_class === "mutual_fund" && c.net === 5000), r.body.invest_all);
sq.exec(`INSERT INTO finance_log (date, type, amount, account_last4, merchant, sms_hash) VALUES ('${today}', 'debit', 1, '1234', '=HYPERLINK("x")', 'h6')`);
let ex = await dash.fetch(new Request(`https://dash.test/api/coin/export?format=csv&from=${today}&to=${today}`, { headers: { cookie: SIGNED_IN } }), env);
let csv = await ex.text();
ok("export csv: attachment with a header row", ex.headers.get("content-disposition")?.includes(`ryuk-money-${today}-to-${today}.csv`) && csv.split("\r\n")[0].includes("date,time,type,amount,merchant,category"), csv.slice(0, 200));
ok("export csv: formulas defused", csv.includes(`"'=HYPERLINK(""x"")"`) && !/(^|,)=HYPERLINK/m.test(csv), csv);
ok("export never includes the SMS hash", !csv.includes("sms_hash") && !csv.includes("h2"));
ex = await dash.fetch(new Request("https://dash.test/api/coin/export?format=json", { headers: { cookie: SIGNED_IN } }), env);
const exj = await ex.json();
ok("export json: every row, labels included", exj.rows.length === sq.prepare("SELECT COUNT(*) n FROM finance_log").get().n && exj.rows.some((x) => x.category_label === "Food & dining"), exj.rows.slice(0, 2));
ex = await dash.fetch(new Request("https://dash.test/api/coin/export?format=csv", { headers: {} }), env);
ok("export needs a sign-in", ex.status === 401);
r = await call("DELETE", "/api/coin/txn", { id: manualId });
ok("erase a transaction", r.status === 200 && !sq.prepare("SELECT 1 FROM finance_log WHERE id = ?").get(manualId));

// ---- sign-in: website passkeys ----
const { softKey, der } = await import("./softkey.mjs");
const ORIGIN = "https://dash.test";
const SETUP = "setup-code-0123456789abcdef";
const aenv = { ...env, AUTH_SETUP_CODE: SETUP };
const go = async (method, path, body, { cookie, origin = method === "GET" ? undefined : ORIGIN, e = aenv } = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await dash.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" }), e);
  const text = await res.text();
  let parsed = text; try { parsed = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body: parsed, headers: res.headers, text };
};
const cookieFrom = (res) => (res.headers.get("set-cookie") ?? "").split(";")[0];

r = await go("GET", "/");
ok("signed out: the page sends you to /login", r.status === 302 && r.headers.get("location") === "/login?next=%2F", r.headers.get("location"));
r = await go("GET", "/api/data?days=1");
ok("signed out: the API answers 401", r.status === 401 && r.body.error === "signed out", r.body);
r = await go("GET", "/login", undefined, { e: env });
ok("login page with no passkey and no setup code says to set it", r.status === 200 && /AUTH_SETUP_CODE/.test(r.text) && !/Cloudflare|Google/i.test(r.text) && /frame-ancestors 'none'/.test(r.headers.get("content-security-policy")), r.text.slice(0, 200));
ok("login page script runs only with its nonce", /script-src 'nonce-[\w-]+'/.test(r.headers.get("content-security-policy")));
r = await go("POST", "/auth/setup/options", { code: SETUP }, { e: env });
ok("setup refused when AUTH_SETUP_CODE isn't set", r.status === 403);
r = await go("POST", "/auth/setup/options", { code: "wrong-code-wrong-code" });
ok("wrong setup code refused", r.status === 403 && /wrong/.test(r.body.error), r.body);

const phone = await softKey();
r = await go("POST", "/auth/setup/options", { code: SETUP });
ok("setup options: passkey, UV required, this host", r.status === 200 && r.body.rp.id === "dash.test" && r.body.authenticatorSelection.userVerification === "required" && r.body.authenticatorSelection.residentKey === "required", r.body);
let regResp = await phone.register(r.body, ORIGIN);
r = await go("POST", "/auth/setup/verify", { code: SETUP, name: "iPhone <script>", next: "//evil.example/x", response: regResp });
const c1 = cookieFrom(r);
ok("setup: passkey stored, signed in, cookie hardened", r.status === 200 && /^__Host-ryuk=[\w-]{20,}$/.test(c1) && /HttpOnly/.test(r.headers.get("set-cookie")) && /Secure/.test(r.headers.get("set-cookie")) && /SameSite=Lax/.test(r.headers.get("set-cookie")), [r.status, r.body, r.headers.get("set-cookie")]);
ok("setup: an off-site next is ignored", r.body.redirect === "/", r.body);
ok("setup: device name cleaned", q("SELECT name FROM auth_credentials")[0].name === "iPhone script", q("SELECT name FROM auth_credentials"));
ok("the session cookie itself is never stored", !JSON.stringify(q("SELECT * FROM auth_sessions")).includes(c1.split("=")[1]));
r = await go("POST", "/auth/setup/verify", { code: SETUP, response: regResp });
ok("setup closes once a passkey exists", r.status === 403, r.body);
r = await go("POST", "/auth/setup/options", { code: SETUP });
ok("setup options also closed", r.status === 403);

r = await go("GET", "/api/data?days=1", undefined, { cookie: c1 });
ok("the session opens the API", r.status === 200 && Array.isArray(r.body.pins), r.status);
r = await go("GET", "/", undefined, { cookie: c1 });
ok("...and the page", r.status === 200 && /frame-ancestors 'none'/.test(r.headers.get("content-security-policy")));
r = await go("GET", "/login?next=%2F%23money", undefined, { cookie: c1 });
ok("visiting /login while signed in goes straight through", r.status === 302 && r.headers.get("location") === "https://dash.test/#money", r.headers.get("location"));
r = await go("GET", "/api/data?days=1", undefined, { cookie: "__Host-ryuk=forgedforgedforgedforgedforged" });
ok("a made-up cookie is refused", r.status === 401);
r = await go("POST", "/api/goals", { text: "from another site" }, { cookie: c1, origin: "https://evil.example" });
ok("a cross-site write is refused even with the cookie", r.status === 403 && /cross_site/.test(r.text), r.text);

r = await go("POST", "/auth/login/options");
ok("login options: no credential list handed out", r.status === 200 && Array.isArray(r.body.allowCredentials) && r.body.allowCredentials.length === 0 && r.body.userVerification === "required", r.body);
let asResp = await phone.assert(r.body, ORIGIN);
r = await go("POST", "/auth/login/verify", { response: asResp, next: "/#page" });
const c2 = cookieFrom(r);
ok("sign in with the passkey", r.status === 200 && r.body.redirect === "/#page" && /^__Host-ryuk=/.test(c2) && c2 !== c1, r.body);
ok("the sign counter is kept", q("SELECT counter FROM auth_credentials")[0].counter === 1);
r = await go("POST", "/auth/login/verify", { response: asResp });
ok("the same signed response can't be replayed", r.status === 400, r.body);
r = await go("POST", "/auth/login/options");
r = await go("POST", "/auth/login/verify", { response: await phone.assert(r.body, "https://evil.example") });
ok("a response signed for another site is refused", r.status === 401, r.body);
r = await go("POST", "/auth/login/options");
r = await go("POST", "/auth/login/verify", { response: await phone.assert(r.body, ORIGIN, { uv: false }) });
ok("without Face ID / passcode (no user verification) it's refused", r.status === 401, r.body);
const stranger = await softKey();
r = await go("POST", "/auth/login/options");
r = await go("POST", "/auth/login/verify", { response: await stranger.assert(r.body, ORIGIN) });
ok("someone else's passkey is refused", r.status === 401 && /isn't registered/.test(r.body.error), r.body);

r = await go("GET", "/auth/me", undefined, { cookie: c2 });
ok("/auth/me lists passkeys", r.status === 200 && r.body.passkeys.length === 1 && r.body.current === phone.id && Array.isArray(r.body.devices), r.body);
const mac = await softKey();
r = await go("POST", "/auth/register/options", {}, { cookie: c2 });
ok("signed in: add another device", r.status === 200 && r.body.excludeCredentials.length === 1, r.body);
r = await go("POST", "/auth/register/verify", { name: "Mac", response: await mac.register(r.body, ORIGIN) }, { cookie: c2 });
ok("second passkey registered", r.status === 200 && q("SELECT COUNT(*) n FROM auth_credentials")[0].n === 2, r.body);
r = await go("POST", "/auth/register/options", {});
ok("adding a device needs a session", r.status === 401);
r = await go("DELETE", "/auth/passkeys", { id: mac.id }, { cookie: c2 });
ok("remove a passkey", r.status === 200 && q("SELECT COUNT(*) n FROM auth_credentials")[0].n === 1);
r = await go("DELETE", "/auth/passkeys", { id: phone.id }, { cookie: c2 });
ok("the last passkey can't be removed", r.status === 400 && /only passkey/.test(r.body.error), r.body);

// ---- sign-in: the iOS app's Secure Enclave key ----
const enc8 = new TextEncoder();
const devKp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const devPub = Buffer.from(await crypto.subtle.exportKey("raw", devKp.publicKey)).toString("base64url");
const devSign = async (msg, kp = devKp) => Buffer.from(der(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, enc8.encode(msg))))).toString("base64url");
const native = { origin: "" };   // the app's own requests carry no Origin

r = await go("POST", "/auth/pair/start", {});
ok("a pairing code needs a signed-in website", r.status === 401);
r = await go("POST", "/auth/pair/start", {}, { cookie: c2 });
const pairCode = r.body.code;
ok("pairing code: 6 digits, 5 minutes", r.status === 200 && /^\d{6}$/.test(pairCode) && r.body.expires_in === 300, r.body);
ok("the code itself isn't stored", !JSON.stringify(q("SELECT * FROM auth_pairings")).includes(pairCode));
r = await go("GET", "/auth/me", undefined, { cookie: c2 });
ok("/auth/me shows a pairing waiting", r.body.pairing === true, r.body);
const wrongCode = pairCode === "000000" ? "000001" : "000000";
r = await go("POST", "/auth/device/pair", { code: wrongCode, public_key: devPub, signature: await devSign(`ryuk-pair\n${wrongCode}\n${devPub}`), name: "iPhone" }, native);
ok("a wrong pairing code is refused", r.status === 403, r.body);
r = await go("POST", "/auth/device/pair", { code: pairCode, public_key: devPub, signature: await devSign("something else"), name: "iPhone" }, native);
ok("pairing needs proof the app holds the key", r.status === 400 && /could not be verified/.test(r.body.error), r.body);
r = await go("POST", "/auth/device/pair", { code: pairCode, public_key: devPub, signature: await devSign(`ryuk-pair\n${pairCode}\n${devPub}`), name: "Bharat's iPhone" }, native);
const deviceId = r.body.device_id;
ok("the app pairs with the code and its key", r.status === 200 && /^[\w-]{16,}$/.test(deviceId) && q("SELECT name FROM auth_devices")[0].name === "Bharat's iPhone", r.body);
r = await go("POST", "/auth/device/pair", { code: pairCode, public_key: devPub, signature: await devSign(`ryuk-pair\n${pairCode}\n${devPub}`) }, native);
ok("a pairing code works once", r.status === 403, r.body);

const deviceLogin = async (kp = devKp, id = deviceId) => {
  const ch = (await go("POST", "/auth/device/challenge", {}, native)).body.challenge;
  return { ch, res: await go("POST", "/auth/device/login", { device_id: id, challenge: ch, signature: await devSign(`ryuk-device-login\n${ch}\n${id}`, kp) }, native) };
};
let dl = await deviceLogin();
const a1 = cookieFrom(dl.res);
ok("the app signs in with Face ID + its key: a session cookie", dl.res.status === 200 && /^__Host-ryuk=/.test(a1) && q("SELECT COUNT(*) n FROM auth_sessions WHERE kind = 'app'")[0].n === 1, dl.res.body);
r = await go("GET", "/api/data?days=1", undefined, { cookie: a1 });
ok("the app's session opens the dashboard", r.status === 200);
r = await go("POST", "/auth/device/login", { device_id: deviceId, challenge: dl.ch, signature: await devSign(`ryuk-device-login\n${dl.ch}\n${deviceId}`) }, native);
ok("a device challenge can't be reused", r.status === 400, r.body);
const otherKp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
dl = await deviceLogin(otherKp);
ok("another key can't sign in as the paired iPhone", dl.res.status === 401, dl.res.body);
dl = await deviceLogin();
const a2 = cookieFrom(dl.res);
r = await go("GET", "/api/data?days=1", undefined, { cookie: a1 });
ok("each app sign-in replaces its previous session", dl.res.status === 200 && r.status === 401 && q("SELECT COUNT(*) n FROM auth_sessions WHERE kind = 'app'")[0].n === 1);
r = await go("GET", "/auth/me", undefined, { cookie: c2 });
ok("/auth/me lists the app device", r.body.devices.length === 1 && r.body.devices[0].id === deviceId && r.body.pairing === false, r.body);
r = await go("DELETE", "/auth/devices", { id: deviceId }, { cookie: c2 });
r = await go("GET", "/api/data?days=1", undefined, { cookie: a2 });
dl = await deviceLogin();
ok("removing the device signs the app out and stops it signing in", r.status === 401 && dl.res.status === 401 && dl.res.body.code === "unpaired", dl.res.body);

// sessions end
const oldTok = "old-session-token-0123456789abcdef";
sq.prepare(`INSERT INTO auth_sessions (token_hash, credential_id, kind, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)`)
  .run(createHash("sha256").update(oldTok).digest("hex"), phone.id, "browser", new Date(Date.now() - 91 * 86400e3).toISOString(), new Date(Date.now() + 86400e3).toISOString(), new Date().toISOString());
r = await go("GET", "/api/data?days=1", undefined, { cookie: `__Host-ryuk=${oldTok}` });
ok("a session older than 90 days ends, however busy", r.status === 401);
r = await go("POST", "/auth/logout", {}, { cookie: c2 });
ok("sign out clears the cookie", r.status === 200 && /Max-Age=0/.test(r.headers.get("set-cookie")));
r = await go("GET", "/api/data?days=1", undefined, { cookie: c2 });
ok("...and the session is gone", r.status === 401);
r = await go("GET", "/api/data?days=1", undefined, { cookie: c1 });
ok("other sessions keep working", r.status === 200);
r = await go("POST", "/auth/logout-all", {}, { cookie: c1 });
r = await go("GET", "/api/data?days=1", undefined, { cookie: c1 });
ok("sign out everywhere ends every session", r.status === 401);
seedSession();

const noFiles = { ...env, FILES: undefined };
const r2 = await dash.fetch(new Request("https://dash.test/api/upload", { method: "POST", headers: { cookie: SIGNED_IN, "content-type": "image/png" }, body: "x" }), noFiles);
ok("no bucket -> clear 501", r2.status === 501);
console.log(fail ? `${fail} FAILED` : "ALL PASS");
if (fail) process.exit(1);
