// Ingest tests: bank SMS regex parser, /ingest/finance, /ingest/health, /ingest/log.
// Runs the real bot Worker on a fake D1 (node:sqlite) with fetch stubbed (Gemini + Telegram).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const { parseBankSMS } = await import("../.wrangler/finance-test.mjs");
const bot = (await import("../.wrangler/bot-test.mjs")).default;

let fail = 0;
const ok = (n, c, extra = "") => { console.log((c ? "ok  " : "FAIL") + " " + n + (c ? "" : "  " + extra)); if (!c) fail++; };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ---------------- 1. parser ----------------
const P = (s) => parseBankSMS(s);
const pick = (t, keys) => t && Object.fromEntries(keys.map((k) => [k, t[k]]));
const K = ["type", "amount", "account_last4", "merchant", "channel"];

eq("1 HDFC debit", pick(P("Rs.500.00 debited from a/c **1234 on 14-MAY at SWIGGY"), [...K, "date_in_sms"]),
  { type: "debit", amount: 500, account_last4: "1234", merchant: "SWIGGY", channel: "bank", date_in_sms: "14-MAY" });
eq("2 HDFC credit", pick(P("Rs.50000 credited to a/c **1234 by NEFT"), K),
  { type: "credit", amount: 50000, account_last4: "1234", merchant: "NEFT", channel: "bank" });
eq("3 UPI debit", pick(P("Rs.250 paid from a/c **5678 to merchant@upi"), K),
  { type: "debit", amount: 250, account_last4: "5678", merchant: "merchant@upi", channel: "upi" });
eq("4 UPI credit without an account -> not a transaction", P("You have received Rs.500 from name@bank"), null);
eq("4b UPI credit with an account", pick(P("You have received Rs.500 in a/c XX9012 from name@bank"), K),
  { type: "credit", amount: 500, account_last4: "9012", merchant: "name@bank", channel: "upi" });
eq("5 card txn", pick(P("Card **1234 used for Rs.800 at AMAZON on 25-Nov"), [...K, "date_in_sms"]),
  { type: "debit", amount: 800, account_last4: "1234", merchant: "AMAZON", channel: "card", date_in_sms: "25-Nov" });
eq("6 auto-debit", pick(P("Rs.5000 auto-debited from a/c **1234 towards EMI"), K),
  { type: "debit", amount: 5000, account_last4: "1234", merchant: "EMI", channel: "auto_debit" });
eq("7 refund", pick(P("Rs.200 reversed to a/c **1234"), K),
  { type: "refund", amount: 200, account_last4: "1234", merchant: "", channel: "bank" });
eq("8 Indian grouping", pick(P("INR 1,00,500.50 debited from a/c XX1234"), ["amount", "account_last4"]), { amount: 100500.5, account_last4: "1234" });
eq("9 rupee symbol", pick(P("₹2,500 debited from a/c **5678 at BigBasket"), ["amount", "merchant"]), { amount: 2500, merchant: "BigBasket" });
eq("10 OTP -> null", P("123456 is your OTP for a txn of Rs.500 on a/c XX1234. Do not share."), null);
eq("11 PIN -> null", P("Your ATM PIN for card XX1234 was changed. Rs.0 charged."), null);
eq("12 no amount -> null", P("Your a/c XX1234 was debited today"), null);
eq("13 balance", pick(P("Rs.300 debited from a/c **1234 at CAFE. Avl bal Rs.12,540"), ["amount", "balance", "merchant"]),
  { amount: 300, balance: 12540, merchant: "CAFE" });
eq("14 VPA merchant", pick(P("Rs.120 sent from a/c XX4444 to grocery@paytm UPI Ref 412345678901"), ["merchant", "channel"]),
  { merchant: "grocery@paytm", channel: "upi" });
eq("15 SBI format", pick(P("debited by Rs.1500 from a/c XX4321 for UPI txn"), ["type", "amount", "account_last4", "channel"]),
  { type: "debit", amount: 1500, account_last4: "4321", channel: "upi" });
eq("shopping is not a PIN", P("Rs.999 spent on card XX7777 at SHOPPING MALL")?.merchant, "SHOPPING MALL");
eq("'credit card' is not a credit", P("Rs.450 spent on HDFC Bank Credit Card XX1111 at ZOMATO")?.type, "debit");
eq("6-digit tail keeps last 4 only", P("Rs.75 debited from a/c XX123456 at TEA")?.account_last4, "3456");
eq("long digit run never kept in merchant", /\d{6,}/.test(P("Rs.75 paid from a/c XX1234 to 9876543210@ybl")?.merchant ?? ""), false);

// ---------------- 2. endpoints ----------------
const sq = new DatabaseSync(":memory:");
sq.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  _run() { const p = sq.prepare(sql); return /^\s*(SELECT|WITH)|RETURNING/i.test(sql) ? { results: p.all(...args), success: true } : (p.run(...args), { results: [], success: true }); },
  async run() { return this._run(); }, async all() { return this._run(); }, async first() { return this._run().results[0] ?? null; },
});
const DB = { prepare: (s) => stmt(s), batch: async (arr) => arr.map((s) => s._run()) };
const q = (s, ...a) => sq.prepare(s).all(...a);

const telegram = []; let gemini = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("generativelanguage")) {
    gemini++;
    const events = [{ type: "strength", summary: "Bench press 3x10 at 60kg", exercise: "Bench press", sets: 3, reps: 10, weight_kg: 60 }];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events }) }] } }] }));
  }
  if (String(url).includes("api.telegram.org")) { telegram.push(JSON.parse(init.body).text); return new Response("{}"); }
  throw new Error("unexpected fetch " + url);
};
const env = { DB, TELEGRAM_TOKEN: "t", WEBHOOK_SECRET: "w", GEMINI_API_KEY: "k", OWNER_CHAT_ID: "42", GEMINI_MODEL: "m1", GEMINI_FALLBACK_MODEL: "m2",
  INGEST_KEY: "ik", HEALTH_KEY: "hk", LOG_KEY: "lk" };
const post = async (path, key, body, type = "application/json") => {
  const headers = { "content-type": type }; if (key) headers.authorization = `Bearer ${key}`;
  const r = await bot.fetch(new Request("https://x" + path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json().catch(() => null) };
};

// finance
const SMS = "Rs.500.00 debited from a/c **1234 on 14-MAY at SWIGGY. Avl bal Rs.9,500.00";
let r = await post("/ingest/finance", "ik", { text: SMS, source: "sms" });
eq("finance: recorded", [r.status, r.body.ok, r.body.status, r.body.type, r.body.amount, r.body.merchant], [200, true, "recorded", "debit", 500, "SWIGGY"]);
const row = q("SELECT * FROM finance_log")[0];
eq("finance: parsed fields stored", [row.type, row.amount, row.account_last4, row.merchant, row.balance, row.channel], ["debit", 500, "1234", "SWIGGY", 9500, "bank"]);
ok("finance: SMS text not stored anywhere", !JSON.stringify(q("SELECT * FROM finance_log")).includes("debited from"));
eq("finance: Telegram ping has no details", telegram.at(-1), "💰 Finance entry logged");
r = await post("/ingest/finance", "ik", { text: SMS });
eq("finance: same SMS twice -> duplicate", [r.body.status, q("SELECT COUNT(*) n FROM finance_log")[0].n], ["duplicate", 1]);
r = await post("/ingest", "ik", SMS.replace("500.00", "75"), "text/plain");
eq("finance: /ingest with text/plain works", r.body.status, "recorded");
r = await post("/ingest", "ik", { text: "Dinner was great, 2 roti and dal", source: "note" });
eq("finance: non-bank text on /ingest is ignored, never sent to Gemini", [r.body.status, gemini], ["ignored", 0]);
r = await post("/ingest/finance", "ik", { text: "123456 is your OTP for Rs.500 on a/c XX1234" });
eq("finance: OTP ignored and not stored", [r.body.status, q("SELECT COUNT(*) n FROM finance_log")[0].n], ["ignored", 2]);
eq("finance: wrong key -> 401", (await post("/ingest/finance", "nope", { text: SMS })).status, 401);
eq("finance: no key -> 401", (await post("/ingest/finance", null, { text: SMS })).status, 401);
eq("finance: empty text -> 400", (await post("/ingest/finance", "ik", { text: "  " })).status, 400);
const xr = await bot.fetch(new Request("https://x/ingest/sms", { method: "POST", headers: { "X-Ryuk-Key": "ik", "content-type": "text/plain" }, body: "Rs.60 paid from a/c XX2222 to chai@ybl" }), env);
eq("finance: old /ingest/sms + X-Ryuk-Key still work", (await xr.json()).status, "recorded");

// finance: filed on arrival (built-in lists, then your rules), all in plain code
eq("finance: SWIGGY filed as food automatically", q("SELECT category, invest_class, category_src FROM finance_log WHERE merchant = 'SWIGGY'")[0], { category: "food", invest_class: null, category_src: "auto" });
r = await post("/ingest/finance", "ik", { text: "Rs.5000.00 debited from a/c **1234 on 05-DEC at NIPPON INDIA MF SIP." });
eq("finance: MF SIP filed as investment", [r.body.category, q("SELECT invest_class FROM finance_log WHERE merchant LIKE 'NIPPON%'")[0]?.invest_class], ["investment", "mutual_fund"]);
sq.exec(`INSERT INTO finance_rules (pattern, category, invest_class) VALUES ('RAHULRENT', 'rent', NULL)`);
r = await post("/ingest/finance", "ik", { text: "Rs.22000 paid from a/c XX2222 to rahulrent@ybl" });
eq("finance: your rule wins", [r.body.status, r.body.category, q("SELECT category_src FROM finance_log WHERE merchant LIKE 'rahulrent%'")[0]?.category_src], ["recorded", "rent", "rule"]);
eq("finance: Gemini never called for SMS", gemini, 0);
{
  // a database that has not had migrations/003_money.sql yet still records (without a category)
  const old = new DatabaseSync(":memory:");
  old.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")
    .replace(/\n  category      TEXT,[^\n]*\n  invest_class  TEXT,[^\n]*\n  category_src  TEXT,[^\n]*\n  note          TEXT,/, "")
    .replace(/CREATE INDEX IF NOT EXISTS idx_finance_category[^\n]*\n/, "")
    .replace(/CREATE TABLE IF NOT EXISTS finance_rules \([\s\S]*?\);/, ""));
  const ost = (sql, args = []) => ({ bind: (...x) => ost(sql, x), _run() { const p = old.prepare(sql); return /^\s*(SELECT|WITH)|RETURNING/i.test(sql) ? { results: p.all(...args), success: true } : (p.run(...args), { results: [], success: true }); },
    async run() { return this._run(); }, async all() { return this._run(); }, async first() { return this._run().results[0] ?? null; } });
  const oenv = { ...env, DB: { prepare: (x) => ost(x), batch: async (arr) => arr.map((x) => x._run()) } };
  ok("finance: test db really is pre-migration", !old.prepare("PRAGMA table_info(finance_log)").all().some((c) => c.name === "category"));
  const res = await bot.fetch(new Request("https://x/ingest/finance", { method: "POST", headers: { authorization: "Bearer ik", "content-type": "application/json" }, body: JSON.stringify({ text: SMS }) }), oenv);
  eq("finance: pre-migration db still records", [res.status, (await res.json()).status, old.prepare("SELECT COUNT(*) n FROM finance_log").get().n], [200, "recorded", 1]);
}

// health
const before = telegram.length;
r = await post("/ingest/health", "hk", { date: "2026-11-20", steps: "8420", excerciseMinutes: "55", runningSpeed: "5.2", walkRunDistance: "3.5" });
eq("health: 200 with steps", [r.status, r.body.ok, r.body.date, r.body.steps], [200, true, "2026-11-20", 8420]);
let h = q("SELECT * FROM health_log WHERE date = '2026-11-20'")[0];
eq("health: strings parsed, camelCase normalised", [h.steps, h.exercise_minutes, h.running_speed, h.walk_run_distance], [8420, 55, 5.2, 3.5]);
eq("health: missing fields are null", [h.heart_rate_avg, h.sleep_minutes, h.weight_kg], [null, null, null]);
ok("health: raw payload kept for debugging", h.raw_json.includes("excerciseMinutes"));
r = await post("/ingest/health", "hk", { date: "2026-11-20", steps: "9,105", sleep: "7h 23m", heart_rate: ["60", "70", "80"], weight_kg: "72.4" });
h = q("SELECT * FROM health_log WHERE date = '2026-11-20'");
eq("health: same day -> one row (upsert)", h.length, 1);
eq("health: new values win, earlier ones kept", [h[0].steps, h[0].exercise_minutes, h[0].sleep_minutes, h[0].heart_rate_avg, h[0].weight_kg], [9105, 55, 443, 70, 72.4]);
r = await post("/ingest/health", "hk", { stepCount: "5" });
eq("health: unknown keys -> 200, today, all null", [r.status, r.body.steps], [200, null]);
eq("health: snake_case keys", (await post("/ingest/health", "hk", { date: "2026-11-21", exercise_minutes: "30", active_cal: "410.5" })).status, 200);
eq("health: snake_case stored", q("SELECT exercise_minutes, active_cal FROM health_log WHERE date = '2026-11-21'")[0], { exercise_minutes: 30, active_cal: 410.5 });
eq("health: wrong key -> 401", (await post("/ingest/health", "ik", { steps: "1" })).status, 401);
eq("health: empty body -> 400", (await post("/ingest/health", "hk", {})).status, 400);
eq("health: invalid json -> 400", (await post("/ingest/health", "hk", "{nope")).status, 400);
eq("health: nothing sent to Telegram or Gemini", [telegram.length - before, gemini], [0, 0]);

// log
r = await post("/ingest/log", "lk", { text: "bench 3x10 60" });
eq("log: classified", [r.status, r.body.ok, r.body.category, r.body.summary], [200, true, "strength", "Bench press 3x10 at 60kg"]);
eq("log: stored as a strength row", q("SELECT exercise, sets, reps, weight_kg FROM strength")[0], { exercise: "Bench press", sets: 3, reps: 10, weight_kg: 60 });
ok("log: reply sent to Telegram", telegram.at(-1)?.includes("Bench press"));
eq("log: empty text -> 400", (await post("/ingest/log", "lk", { text: "" })).status, 400);
eq("log: wrong key -> 401", (await post("/ingest/log", "hk", { text: "x" })).status, 401);

console.log(fail ? `\n${fail} FAILED` : "\nall ingest tests passed");
process.exit(fail ? 1 : 0);
