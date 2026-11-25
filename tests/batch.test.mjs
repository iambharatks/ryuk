import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const botMod = await import("../.wrangler/bot-test.mjs");
const bot = botMod.default;
// ---- fake D1 on node:sqlite ----
const sq = new DatabaseSync(":memory:");
sq.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  _run() { const p = sq.prepare(sql); return /^\s*(SELECT|WITH)|RETURNING/i.test(sql) ? { results: p.all(...args), success: true } : (p.run(...args), { results: [], success: true }); },
  async run() { return this._run(); }, async all() { return this._run(); },
  async first() { return this._run().results[0] ?? null; },
});
const DB = { prepare: (s) => stmt(s), batch: async (arr) => arr.map((s) => s._run()) };
// ---- stub fetch: Gemini returns canned events per line; Telegram sendMessage captured ----
const sent = []; const reactions = [];
let geminiCalls = 0, lastPrompt = "";
globalThis.fetch = async (url, init) => {
  if (String(url).includes("generativelanguage")) {
    geminiCalls++;
    const body = JSON.parse(init.body); lastPrompt = body.contents[0].parts.at(-1).text;
    const lines = [...lastPrompt.matchAll(/(\d+)\. \[(\d\d:\d\d)\] (.*)$/gm)];
    const events = lines.flatMap(([, n, , t]) => {
      const m = t.match(/(bench|squat|row)\w*\s+(\d+)x(\d+)/i);
      if (m) return [{ type: "strength", line: +n, summary: `${m[1]} ${m[2]}x${m[3]}`, exercise: m[1][0].toUpperCase() + m[1].slice(1), sets: 1, reps: +m[3], weight_kg: +m[2] }];
      if (/ran|run/.test(t)) return [{ type: "cardio", line: +n, summary: "Run", activity: "Run", distance_km: 2, duration_min: 12 }];
      return [];
    });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events }) }] } }] }), { status: 200 });
  }
  if (String(url).includes("setMessageReaction")) { reactions.push(JSON.parse(init.body).message_id); return new Response("{}"); }
  if (String(url).includes("api.telegram.org")) { sent.push(JSON.parse(init.body).text); return new Response("{}"); }
  throw new Error("unexpected fetch " + url);
};
const env = { DB, TELEGRAM_TOKEN: "t", WEBHOOK_SECRET: "w", GEMINI_API_KEY: "k", OWNER_CHAT_ID: "42", GEMINI_MODEL: "m1", GEMINI_FALLBACK_MODEL: "m2", LOG_KEY: "lk" };
const now = Math.floor(Date.parse("2026-11-25T20:00:00+05:30") / 1000);
const tg = (text, id = 1, date = now) => bot.fetch(new Request("https://x/", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "w" },
  body: JSON.stringify({ message: { message_id: id, date, chat: { id: 42 }, text } }) }), env);
let fail = 0; const ok = (n, c, extra = "") => { console.log((c ? "ok  " : "FAIL") + " " + n + (c ? "" : " " + extra)); if (!c) fail++; };
const q = (s) => sq.prepare(s).all();

const note = `Gym
18:02 bench 60x10
18:05 bench 65x8
- 18:09 bench 70x6
18:15 squat 80x5
18:18 squat 80x5
rest
18:40 ran 2km 12 min`;
await tg(note, 10);
const r1 = sent.at(-1);

ok("one gemini call for the whole note", geminiCalls === 1);
ok("8 line messages stored", q("SELECT count(*) c FROM messages")[0].c === 8, JSON.stringify(q("SELECT text,received_at FROM messages")));
const st = q("SELECT exercise, weight_kg, reps, rest_sec, logged_at FROM strength ORDER BY logged_at");
ok("5 sets stored", st.length === 5, JSON.stringify(st));
ok("per-line timestamps", st[0].logged_at === "2026-11-25T12:32:00.000Z" && st[3].logged_at === "2026-11-25T12:45:00.000Z", JSON.stringify(st.map(s=>s.logged_at)));
ok("rest from gaps", st[0].rest_sec === null && st[1].rest_sec === 180 && st[2].rest_sec === 240 && st[4].rest_sec === 180, JSON.stringify(st.map(s=>s.rest_sec)));
ok("cardio at its line time", q("SELECT logged_at FROM cardio")[0]?.logged_at === "2026-11-25T13:10:00.000Z");
ok("'Gym' header and 'rest' kept as raw lines", q("SELECT count(*) c FROM messages WHERE text IN ('Gym','rest')")[0].c === 2);
ok("untimed line inherits previous time", q("SELECT received_at FROM messages WHERE text='rest'")[0].received_at === "2026-11-25T12:48:00.000Z");
ok("summary line in reply", /Session 18:02–18:18 \(16 min\) · 2 exercises · 5 sets · 2,[0-9]{3} kg volume/.test(r1));

// resend the same note + 2 new lines -> only the new ones
await tg(note + "\n18:50 row 40x12\n18:53 row 40x12", 11);
const r2 = sent.at(-1);
ok("resend: only new lines logged", /2 new lines logged · 8 already logged, skipped/.test(r2), r2);
ok("resend: no duplicate sets", q("SELECT count(*) c FROM strength")[0].c === 7, JSON.stringify(q("SELECT exercise,logged_at FROM strength")));
ok("resend: gemini saw only the new lines", !/bench/.test(lastPrompt) && /row 40x12/.test(lastPrompt));
await tg(note, 12);
ok("full resend -> nothing new", /All 8 lines were already logged/.test(sent.at(-1)), sent.at(-1));

// undo removes the last batch only
await tg("/undo", 13);
ok("undo message", /removed the last batch \(2 lines/.test(sent.at(-1)), sent.at(-1));
ok("undo removed rows", q("SELECT count(*) c FROM strength")[0].c === 5 && q("SELECT count(*) c FROM messages")[0].c === 8);
await tg("18:50 row 40x12\n18:53 row 40x12", 14);
ok("after undo the lines can be logged again", /2 new lines logged/.test(sent.at(-1)), sent.at(-1));

// single line still uses the normal path
const before = geminiCalls;
await tg("bench 3x10 60", 15);
ok("single line -> normal path", geminiCalls === before + 1 && !/new line/.test(sent.at(-1)), sent.at(-1));

// gemini failure -> raw lines kept with times
const realFetch = globalThis.fetch;
globalThis.fetch = (orig => async (url, init) => String(url).includes("generativelanguage") ? new Response("busy", { status: 503 }) : orig(url, init))(globalThis.fetch);
await tg("19:30 bench 50x15\n19:33 bench 50x15", 16);
ok("gemini down -> saved raw", /2 lines saved raw with their times/.test(sent.at(-1)), sent.at(-1));
ok("raw lines have their times", q("SELECT received_at FROM messages WHERE status='needs_review' ORDER BY id")[0]?.received_at === "2026-11-25T14:00:00.000Z");

// via the Shortcut endpoint
const res = await bot.fetch(new Request("https://x/ingest/log", { method: "POST", headers: { "X-Ryuk-Key": "lk", "content-type": "text/plain" }, body: "20:01 squat 60x5\n20:04 squat 60x5" }), env);
ok("/ingest/log accepts a batch", (await res.json()).reply?.includes("2 lines saved raw"));


// ---- gym mode: time comes from each Telegram message, nothing typed ----
globalThis.fetch = realFetch;
const T0 = Math.floor(Date.parse("2026-11-26T07:00:00+05:30") / 1000);
const strengthBefore = q("SELECT count(*) c FROM strength")[0].c;
const callsBefore = geminiCalls;
await tg("/gym push", 100, T0);
ok("gym on", /Gym mode on: push/.test(sent.at(-1)), sent.at(-1));
await tg("bench 60x10", 101, T0 + 30);
await tg("bench 65x8", 102, T0 + 210);
await tg("bench 70x6", 103, T0 + 420);
await tg("squat 80x5", 104, T0 + 600);
await tg("squat 90x3", 105, T0 + 800);
ok("sets are buffered, no gemini yet", geminiCalls === callsBefore && q("SELECT count(*) c FROM live_lines")[0].c === 5);
ok("each set gets a ✍ reaction, no reply spam", reactions.length === 5 && /Gym mode on/.test(sent.at(-1)));
await tg("/undo", 106, T0 + 805);
ok("undo removes last set only", /removed "squat 90x3"/.test(sent.at(-1)) && q("SELECT count(*) c FROM live_lines")[0].c === 4);
await tg("/status", 107, T0 + 810);
ok("status lists sets with times", /07:00 bench 60x10[\s\S]*07:10 squat 80x5/.test(sent.at(-1)), sent.at(-1));
await tg("/done", 108, T0 + 900);
const rd = sent.at(-1);
ok("done -> one gemini call", geminiCalls === callsBefore + 1);
ok("done -> 4 sets stored", q("SELECT count(*) c FROM strength")[0].c === strengthBefore + 4, rd);
const g = q("SELECT logged_at, rest_sec FROM strength ORDER BY id DESC LIMIT 4").reverse();
ok("times from telegram, to the second", g[0].logged_at === "2026-11-26T01:30:30.000Z" && g[1].logged_at === "2026-11-26T01:33:30.000Z", JSON.stringify(g));
ok("rest from the gaps", g[1].rest_sec === 180 && g[2].rest_sec === 210, JSON.stringify(g));
ok("summary", /Session 07:00–07:10 \(10 min\) · 2 exercises · 4 sets/.test(rd), rd);
ok("buffer cleared", q("SELECT count(*) c FROM live_lines")[0].c === 0 && q("SELECT count(*) c FROM live_session")[0].c === 0);
await tg("/done", 109, T0 + 950);
ok("done without session", /No gym session running/.test(sent.at(-1)));
// an abandoned session is closed automatically before the next normal message
await tg("/gym", 110, T0 + 1000);
await tg("row 40x12", 111, T0 + 1060);
await tg("lunch dal chawal", 112, T0 + 1060 + 4 * 3600);
ok("auto-close after 3h idle", sent.some((m) => /Closed the open gym session/.test(m)) && q("SELECT count(*) c FROM live_session")[0].c === 0);
await tg("/gym", 113, T0 + 20000);
await tg("/cancel", 114, T0 + 20010);
ok("cancel discards", /Discarded 0 unsent sets/.test(sent.at(-1)), sent.at(-1));


// ---- dashboard notepad: lines with browser timestamps through the RPC ----
const rpc = new botMod.RyukRPC({}, env);
const T1 = Date.parse("2026-11-25T18:30:00+05:30");
const sBefore = q("SELECT count(*) c FROM strength")[0].c;
const nowReal = Date.now; Date.now = () => T1 + 600e3;
let rr = await rpc.captureLines([{ text: "bench 60x10", at: new Date(T1).toISOString() }, { text: "bench 62x8", at: new Date(T1 + 150e3).toISOString() },
  { text: "", at: new Date(T1).toISOString() }, { text: "bench 64x6", at: "not a date" }, { text: "old", at: "2020-01-01T00:00:00Z" }]);
ok("notepad: valid lines logged, bad ones dropped", /2 new lines logged/.test(rr) && q("SELECT count(*) c FROM strength")[0].c === sBefore + 2, rr);
ok("notepad: rest from browser stamps", q("SELECT rest_sec FROM strength ORDER BY id DESC LIMIT 1")[0].rest_sec === 150);
rr = await rpc.captureLines([{ text: "bench 60x10", at: new Date(T1).toISOString() }, { text: "bench 62x8", at: new Date(T1 + 150e3).toISOString() }]);
ok("notepad: resend after a network error is skipped", /All 2 lines were already logged/.test(rr), rr);
rr = await rpc.captureLines([]);
ok("notepad: empty", /Nothing to log/.test(rr));
Date.now = nowReal;

// ---- parser unit checks ----
const { parseBatch } = await import("../.wrangler/batch-test.mjs");
const at = (ms) => new Date(ms + 19800e3).toISOString().slice(0, 16).replace("T", " ");
const N = Date.parse("2026-11-25T20:00:00+05:30");
let p = parseBatch("6:40 pm squat 80x5\n6:45 PM squat 80x5", N);
ok("am/pm", at(p[0].atMs) === "2026-11-25 18:40" && at(p[1].atMs) === "2026-11-25 18:45", p.map((l) => at(l.atMs)).join());
p = parseBatch("11:50 bench\n12:10 bench\n1:05 squat", N);
ok("12h without pm after noon", at(p[2].atMs) === "2026-11-25 13:05", at(p[2].atMs));
p = parseBatch("kal\n18:00 bench 60x10", N);
ok("date header kal", at(p[0].atMs) === "2026-11-24 18:00", at(p[0].atMs));
p = parseBatch("24/11\n18:00 bench 60x10", N);
ok("date header dd/mm", at(p[0].atMs) === "2026-11-24 18:00");
p = parseBatch("23:10 bench 60x10\n23:40 squat 80x5", Date.parse("2026-11-26T00:20:00+05:30"));
ok("sent after midnight -> previous day", at(p[0].atMs) === "2026-11-25 23:10", at(p[0].atMs));
p = parseBatch("Push day\n18:02 bench 60x10\n• 18:05 [18:05] bench", N);
ok("title takes first time, bullets stripped", at(p[0].atMs) === "2026-11-25 18:02" && p[2].text === "[18:05] bench", JSON.stringify(p));
console.log(fail ? `${fail} FAILED` : "ALL PASS");
if (fail) process.exit(1);
