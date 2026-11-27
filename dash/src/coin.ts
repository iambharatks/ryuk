/**
 * Money: the finance side of the dashboard, kept apart from the daily logs.
 *   GET    /api/coin?from=YYYY-MM-DD        transactions (default: last ~13 months), rules, budgets, all-time investment totals
 *   POST   /api/coin/txn                     add one by hand (cash, a transfer the bank never texted about)
 *   PATCH  /api/coin/txn                     file it: category / investment class / note / merchant / type / channel; remember=true makes a rule
 *   DELETE /api/coin/txn                     erase one
 *   POST   /api/coin/rules  DELETE /api/coin/rules
 *   PUT    /api/coin/budgets                 { category, monthly_limit } (null or 0 removes it)
 *   POST   /api/coin/reclassify              re-file everything not filed by hand
 *   GET    /api/coin/export?format=csv|json&from=&to=   a download
 * Everything here runs after the Access check in index.ts. Finance rows never leave this Worker except to your browser.
 */
import { CATEGORIES, INVEST_CLASSES, classify, isCategory, isInvestClass, type Rule } from "../../src/classify";
import { json } from "./extra";

type Env = { DB: D1Database };

const COLS = "id, date, time, type, amount, account_last4, merchant, balance, channel, raw_direction, date_in_sms, source, category, invest_class, category_src, note, created_at";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ["debit", "credit", "refund"];
const CHANNELS = ["bank", "upi", "card", "auto_debit", "cash", "netbanking", "other"];
const istToday = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 19800e3 - n * 86400e3).toISOString().slice(0, 10);
const cleanPattern = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, " ").trim().slice(0, 60);

/** category + class pair, validated; investment always carries a class. */
function filing(category: unknown, invest_class: unknown): { category: string | null; invest_class: string | null } | string {
  if (category === null || category === "") return { category: null, invest_class: null };
  if (!isCategory(category)) return "unknown category";
  if (category !== "investment") return { category, invest_class: null };
  if (invest_class != null && invest_class !== "" && !isInvestClass(invest_class)) return "unknown investment class";
  return { category, invest_class: isInvestClass(invest_class) ? invest_class : "other" };
}

async function rules(env: Env): Promise<(Rule & { id: number; created_at: string })[]> {
  return ((await env.DB.prepare(`SELECT * FROM finance_rules ORDER BY pattern`).all()).results ?? []) as any;
}

export async function coinData(env: Env, url: URL) {
  const f = url.searchParams.get("from");
  const from = f && DAY_RE.test(f) ? f : daysAgo(400);
  const [rows, rl, budgets, invest, first] = await env.DB.batch([
    env.DB.prepare(`SELECT ${COLS} FROM finance_log WHERE date >= ? ORDER BY date DESC, time DESC, id DESC LIMIT 20000`).bind(from),
    env.DB.prepare(`SELECT * FROM finance_rules ORDER BY pattern`),
    env.DB.prepare(`SELECT category, monthly_limit FROM finance_budgets ORDER BY category`),
    // all-time, net of redemptions (a credit filed as investment is money coming back out)
    env.DB.prepare(`SELECT invest_class, SUM(CASE WHEN type = 'debit' THEN amount ELSE -amount END) AS net, COUNT(*) AS n
                    FROM finance_log WHERE category = 'investment' GROUP BY invest_class`),
    env.DB.prepare(`SELECT MIN(date) AS first FROM finance_log`),
  ]);
  return json({
    from, rows: rows.results, rules: rl.results, budgets: budgets.results, invest_all: invest.results,
    first: (first.results[0] as any)?.first ?? null, categories: CATEGORIES, invest_classes: INVEST_CLASSES,
  });
}

/** Apply one rule to every row it matches that wasn't filed by hand. Returns how many rows changed. */
async function applyRule(env: Env, r: Rule): Promise<number> {
  const where = `UPPER(merchant) LIKE ? AND (category_src IS NULL OR category_src != 'manual')
                 AND NOT (IFNULL(category, '') = ? AND IFNULL(invest_class, '') = ?)`;
  const args = [`%${r.pattern}%`, r.category, r.invest_class ?? ""];
  const n = ((await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_log WHERE ${where}`).bind(...args).first()) as any)?.n ?? 0;
  if (n) await env.DB.prepare(`UPDATE finance_log SET category = ?, invest_class = ?, category_src = 'rule' WHERE ${where}`)
    .bind(r.category, r.invest_class, ...args).run();
  return n;
}

export async function addTxn(env: Env, b: any) {
  const date = String(b?.date ?? "");
  if (!DAY_RE.test(date) || date > istToday()) return json({ error: "date must be YYYY-MM-DD, not in the future" }, 400);
  const time = b?.time ? String(b.time) : null;
  if (time && !/^\d{2}:\d{2}$/.test(time)) return json({ error: "time must be HH:MM" }, 400);
  const type = String(b?.type ?? "debit");
  if (!TYPES.includes(type)) return json({ error: "type must be debit, credit or refund" }, 400);
  const amount = Math.round(Number(b?.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return json({ error: "amount must be a positive number" }, 400);
  const merchant = String(b?.merchant ?? "").trim().slice(0, 80) || null;
  const channel = String(b?.channel ?? "cash");
  if (!CHANNELS.includes(channel)) return json({ error: `channel must be one of ${CHANNELS.join(", ")}` }, 400);
  const last4 = String(b?.account_last4 ?? "").replace(/\D/g, "").slice(-4);   // never more than the last 4
  const note = String(b?.note ?? "").trim().slice(0, 300) || null;
  let fil: { category: string | null; invest_class: string | null }, src: string | null;
  if (b?.category) {
    const v = filing(b.category, b.invest_class);
    if (typeof v === "string") return json({ error: v }, 400);
    fil = v; src = "manual";
  } else {
    const auto = classify({ merchant, type, channel }, await rules(env));
    fil = { category: auto?.category ?? null, invest_class: auto?.invest_class ?? null }; src = auto?.src ?? null;
  }
  const row = await env.DB.prepare(
    `INSERT INTO finance_log (date, time, type, amount, account_last4, merchant, channel, source, category, invest_class, category_src, note)
     VALUES (?,?,?,?,?,?,?, 'manual', ?,?,?,?) RETURNING ${COLS}`,
  ).bind(date, time, type, amount, last4, merchant, channel, fil.category, fil.invest_class, src, note).first();
  return json({ row });
}

export async function editTxn(env: Env, b: any) {
  const id = b?.id;
  if (!Number.isInteger(id)) return json({ error: "bad id" }, 400);
  const cur = (await env.DB.prepare(`SELECT ${COLS} FROM finance_log WHERE id = ?`).bind(id).first()) as any;
  if (!cur) return json({ error: "not found" }, 404);
  const set: string[] = [], args: unknown[] = [];
  if ("category" in (b ?? {})) {
    const v = filing(b.category, b.invest_class);
    if (typeof v === "string") return json({ error: v }, 400);
    set.push("category = ?", "invest_class = ?", "category_src = ?"); args.push(v.category, v.invest_class, v.category ? "manual" : null);
  }
  if ("note" in (b ?? {})) { set.push("note = ?"); args.push(String(b.note ?? "").trim().slice(0, 300) || null); }
  if ("merchant" in (b ?? {})) { set.push("merchant = ?"); args.push(String(b.merchant ?? "").trim().slice(0, 80) || null); }
  if ("type" in (b ?? {})) { if (!TYPES.includes(b.type)) return json({ error: "type must be debit, credit or refund" }, 400); set.push("type = ?"); args.push(b.type); }
  if ("channel" in (b ?? {})) { if (!CHANNELS.includes(b.channel)) return json({ error: "bad channel" }, 400); set.push("channel = ?"); args.push(b.channel); }
  if (!set.length) return json({ error: "nothing to change" }, 400);
  await env.DB.prepare(`UPDATE finance_log SET ${set.join(", ")} WHERE id = ?`).bind(...args, id).run();
  const row = (await env.DB.prepare(`SELECT ${COLS} FROM finance_log WHERE id = ?`).bind(id).first()) as any;

  // "always file this merchant like this": a rule, applied to the past now and to every future SMS
  let rule = null, applied = 0;
  if (b?.remember && row.category && row.merchant) {
    const pattern = cleanPattern(row.merchant);
    await env.DB.prepare(`INSERT INTO finance_rules (pattern, category, invest_class) VALUES (?,?,?)
                          ON CONFLICT(pattern) DO UPDATE SET category = excluded.category, invest_class = excluded.invest_class`)
      .bind(pattern, row.category, row.invest_class).run();
    rule = await env.DB.prepare(`SELECT * FROM finance_rules WHERE pattern = ?`).bind(pattern).first();
    applied = await applyRule(env, { pattern, category: row.category, invest_class: row.invest_class });
  }
  return json({ row, rule, applied });
}

export async function deleteTxn(env: Env, b: any) {
  if (!Number.isInteger(b?.id)) return json({ error: "bad id" }, 400);
  await env.DB.prepare(`DELETE FROM finance_log WHERE id = ?`).bind(b.id).run();
  return json({ ok: true });
}

export async function addRule(env: Env, b: any) {
  const pattern = cleanPattern(b?.pattern);
  if (pattern.length < 2) return json({ error: "pattern needs at least 2 characters" }, 400);
  const v = filing(b?.category, b?.invest_class);
  if (typeof v === "string" || !v.category) return json({ error: typeof v === "string" ? v : "pick a category" }, 400);
  await env.DB.prepare(`INSERT INTO finance_rules (pattern, category, invest_class) VALUES (?,?,?)
                        ON CONFLICT(pattern) DO UPDATE SET category = excluded.category, invest_class = excluded.invest_class`)
    .bind(pattern, v.category, v.invest_class).run();
  const rule = await env.DB.prepare(`SELECT * FROM finance_rules WHERE pattern = ?`).bind(pattern).first();
  const applied = await applyRule(env, { pattern, category: v.category, invest_class: v.invest_class });
  return json({ rule, applied });
}

export async function deleteRule(env: Env, b: any) {
  if (!Number.isInteger(b?.id)) return json({ error: "bad id" }, 400);
  // rows it filed keep their category until you re-classify
  await env.DB.prepare(`DELETE FROM finance_rules WHERE id = ?`).bind(b.id).run();
  return json({ ok: true });
}

export async function setBudget(env: Env, b: any) {
  if (!isCategory(b?.category) || ["investment", "transfer", "income", "refund"].includes(b.category)) return json({ error: "budgets are for spending categories" }, 400);
  const limit = b?.monthly_limit == null || b.monthly_limit === "" ? 0 : Number(b.monthly_limit);
  if (!Number.isFinite(limit) || limit < 0 || limit > 1e9) return json({ error: "limit must be a positive number" }, 400);
  if (!limit) await env.DB.prepare(`DELETE FROM finance_budgets WHERE category = ?`).bind(b.category).run();
  else await env.DB.prepare(`INSERT INTO finance_budgets (category, monthly_limit) VALUES (?, ?)
                             ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit`).bind(b.category, limit).run();
  return json({ ok: true });
}

/** Re-run the rules and the keyword lists over every row not filed by hand. */
export async function reclassify(env: Env) {
  const rl = await rules(env);
  const { results } = await env.DB.prepare(
    `SELECT id, merchant, type, channel, category, invest_class FROM finance_log WHERE category_src IS NULL OR category_src != 'manual'`,
  ).all<{ id: number; merchant: string | null; type: string; channel: string | null; category: string | null; invest_class: string | null }>();
  const stmts: D1PreparedStatement[] = [];
  for (const r of results ?? []) {
    const f = classify(r, rl);
    const cat = f?.category ?? null, cls = f?.invest_class ?? null;
    if (cat === r.category && cls === r.invest_class) continue;
    stmts.push(env.DB.prepare(`UPDATE finance_log SET category = ?, invest_class = ?, category_src = ? WHERE id = ?`).bind(cat, cls, f?.src ?? null, r.id));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return json({ ok: true, changed: stmts.length, checked: results?.length ?? 0 });
}

const EXPORT_COLS = ["date", "time", "type", "amount", "merchant", "category", "invest_class", "channel", "account_last4", "balance", "note", "source"] as const;

/** CSV cell: quoted when needed; a leading = + - @ is defused so a spreadsheet never runs it as a formula. */
function cell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportTxns(env: Env, url: URL) {
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  const lo = from && DAY_RE.test(from) ? from : "0000-01-01", hi = to && DAY_RE.test(to) ? to : "9999-12-31";
  const { results } = await env.DB.prepare(`SELECT ${EXPORT_COLS.join(", ")} FROM finance_log WHERE date BETWEEN ? AND ? ORDER BY date, time, id`)
    .bind(lo, hi).all<Record<string, unknown>>();
  const rows = (results ?? []).map((r) => ({
    ...r,
    category_label: r.category ? (CATEGORIES as Record<string, string>)[String(r.category)] ?? r.category : "",
    invest_class_label: r.invest_class ? (INVEST_CLASSES as Record<string, string>)[String(r.invest_class)] ?? r.invest_class : "",
  }));
  const name = `ryuk-money-${from && DAY_RE.test(from) ? from : "start"}-to-${to && DAY_RE.test(to) ? to : istToday()}.${format}`;
  const headers = { "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" };
  if (format === "json") return new Response(JSON.stringify({ exported_at: new Date().toISOString(), from: lo, to: hi, rows }, null, 2), { headers: { ...headers, "content-type": "application/json" } });
  const cols = [...EXPORT_COLS, "category_label", "invest_class_label"];
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell((r as any)[c])).join(","))].join("\r\n");
  return new Response("﻿" + csv, { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
}
