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
const noFiles = { ...env, FILES: undefined };
const r2 = await dash.fetch(new Request("https://dash.test/api/upload", { method: "POST", headers: { "Cf-Access-Jwt-Assertion": good, "content-type": "image/png" }, body: "x" }), noFiles);
ok("no bucket -> clear 501", r2.status === 501);
console.log(fail ? `${fail} FAILED` : "ALL PASS");
if (fail) process.exit(1);
