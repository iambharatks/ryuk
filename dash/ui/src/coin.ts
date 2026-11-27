/**
 * Money: types, the API client, an in-memory demo with the same interface, and the sums the view draws.
 * Categories and investment classes come from the bot's own classifier (src/classify.ts) so both sides agree.
 */
import { CATEGORIES, INVEST_CLASSES, NOT_SPEND, classify, type Rule as CRule } from "../../../src/classify";

export { CATEGORIES, INVEST_CLASSES, NOT_SPEND };
export type CatKey = keyof typeof CATEGORIES;
export type ClassKey = keyof typeof INVEST_CLASSES;

export type Txn = {
  id: number; date: string; time: string | null; type: "debit" | "credit" | "refund"; amount: number; account_last4: string;
  merchant: string | null; balance: number | null; channel: string | null; raw_direction?: string | null; date_in_sms?: string | null;
  source: string | null; category: string | null; invest_class: string | null; category_src: string | null; note: string | null; created_at?: string;
};
export type Rule = { id: number; pattern: string; category: string; invest_class: string | null; created_at?: string };
export type Budget = { category: string; monthly_limit: number };
export type CoinData = { from: string; rows: Txn[]; rules: Rule[]; budgets: Budget[]; invest_all: { invest_class: string | null; net: number; n: number }[]; first: string | null };
export type NewTxn = { date: string; time?: string; type: Txn["type"]; amount: number; merchant?: string; channel?: string; category?: string; invest_class?: string; note?: string };
export type TxnPatch = { category?: string | null; invest_class?: string | null; note?: string; merchant?: string; type?: string; channel?: string; remember?: boolean };

export interface CoinStore {
  demo: boolean;
  load(): Promise<CoinData>;
  add(t: NewTxn): Promise<Txn>;
  edit(id: number, p: TxnPatch): Promise<{ row: Txn; applied: number }>;
  remove(id: number): Promise<void>;
  addRule(r: { pattern: string; category: string; invest_class?: string | null }): Promise<{ applied: number }>;
  deleteRule(id: number): Promise<void>;
  setBudget(category: string, limit: number | null): Promise<void>;
  reclassify(): Promise<{ changed: number }>;
  /** download the rows between from and to (inclusive, YYYY-MM-DD; omit for everything) */
  exportFile(format: "csv" | "json", from?: string, to?: string): Promise<void>;
}

export const CHANNELS = ["upi", "card", "bank", "netbanking", "auto_debit", "cash", "other"] as const;
export const SPEND_CATS = (Object.keys(CATEGORIES) as CatKey[]).filter((c) => !NOT_SPEND.includes(c));
export const catLabel = (c: string | null) => (c ? (CATEGORIES as Record<string, string>)[c] ?? c : "Uncategorised");
export const classLabel = (c: string | null) => (c ? (INVEST_CLASSES as Record<string, string>)[c] ?? c : "Other");
export const inr = (n: number, frac = false) => "₹" + (frac ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString("en-IN"));
export const inrShort = (n: number) => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)}Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)}L` : a >= 1e4 ? `${s}₹${(a / 1e3).toFixed(1)}k` : `${s}₹${Math.round(a).toLocaleString("en-IN")}`; };
export const istToday = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10);

/** What a row means for the totals. */
export function kindOf(t: Txn): "spend" | "income" | "invest" | "redeem" | "transfer" | "refund" {
  if (t.category === "investment") return t.type === "debit" ? "invest" : "redeem";
  if (t.category === "transfer") return "transfer";
  if (t.type === "refund" || t.category === "refund") return "refund";
  // money back filed under a spending category (a friend paying their share) offsets that category
  if (t.type === "credit") return t.category && (SPEND_CATS as string[]).includes(t.category) ? "refund" : "income";
  return "spend";
}

export type Totals = { spent: number; refunds: number; received: number; invested: number; redeemed: number; netInvested: number; left: number; saveRate: number | null };
export function totals(rows: Txn[]): Totals {
  let spent = 0, refunds = 0, received = 0, invested = 0, redeemed = 0;
  for (const t of rows) {
    const k = kindOf(t);
    if (k === "spend") spent += t.amount; else if (k === "refund") refunds += t.amount;
    else if (k === "income") received += t.amount; else if (k === "invest") invested += t.amount; else if (k === "redeem") redeemed += t.amount;
  }
  const net = spent - refunds, netInvested = invested - redeemed;
  return { spent: net, refunds, received, invested, redeemed, netInvested, left: received - net - netInvested, saveRate: received > 0 ? (received - net) / received : null };
}

/** Spending per category (refunds credited back to the category they were filed under, else to "refund"). */
export function byCategory(rows: Txn[]): { category: string | null; amount: number; n: number }[] {
  const m = new Map<string | null, { amount: number; n: number }>();
  for (const t of rows) {
    const k = kindOf(t);
    const back = k === "refund" && t.category && (SPEND_CATS as string[]).includes(t.category);
    if (k !== "spend" && !back) continue;
    const e = m.get(t.category) ?? { amount: 0, n: 0 };
    e.amount += back ? -t.amount : t.amount; if (!back) e.n++; m.set(t.category, e);
  }
  return [...m].map(([category, v]) => ({ category, ...v })).filter((c) => c.amount > 0.5).sort((a, b) => b.amount - a.amount);
}

export function byMerchant(rows: Txn[], kind: ReturnType<typeof kindOf> = "spend") {
  const m = new Map<string, { amount: number; n: number; category: string | null }>();
  for (const t of rows) {
    if (kindOf(t) !== kind) continue;
    const k = (t.merchant || "—").toUpperCase();
    const e = m.get(k) ?? { amount: 0, n: 0, category: t.category };
    e.amount += t.amount; e.n++; m.set(k, e);
  }
  return [...m].map(([merchant, v]) => ({ merchant, ...v })).sort((a, b) => b.amount - a.amount);
}

/** Money put in (net of redemptions) per investment class. */
export function byClass(rows: Txn[]) {
  const m = new Map<string, { amount: number; n: number }>();
  for (const t of rows) {
    const k = kindOf(t);
    if (k !== "invest" && k !== "redeem") continue;
    const key = t.invest_class || "other";
    const e = m.get(key) ?? { amount: 0, n: 0 };
    e.amount += k === "invest" ? t.amount : -t.amount; e.n++; m.set(key, e);
  }
  return [...m].map(([cls, v]) => ({ cls, ...v })).sort((a, b) => b.amount - a.amount);
}

/** Recurring investments: the same merchant, about the same amount, in two or more different months. */
export function recurring(rows: Txn[]) {
  const groups = new Map<string, Txn[]>();
  for (const t of rows) if (kindOf(t) === "invest") {
    const k = `${(t.merchant || "—").toUpperCase()}|${Math.round(t.amount / 50) * 50}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()]
    .map((g) => ({ merchant: g[0].merchant || "—", cls: g[0].invest_class, amount: g[0].amount, months: new Set(g.map((t) => t.date.slice(0, 7))).size, last: g.map((t) => t.date).sort().at(-1)!, day: Number(g[0].date.slice(8, 10)) }))
    .filter((r) => r.months >= 2)
    .sort((a, b) => b.amount - a.amount);
}

/** YYYY-MM keys, oldest first, ending with `end`. */
export function lastMonths(end: string, n: number): string[] {
  let [y, m] = end.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); m--; if (!m) { m = 12; y--; } }
  return out;
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}${res.status === 403 ? " (signed out? reload the page)" : ""}`);
  return out as T;
}

export function apiCoin(): CoinStore {
  return {
    demo: false,
    load: () => call("GET", "/api/coin"),
    add: async (t) => (await call<{ row: Txn }>("POST", "/api/coin/txn", t)).row,
    edit: (id, p) => call("PATCH", "/api/coin/txn", { id, ...p }),
    remove: async (id) => { await call("DELETE", "/api/coin/txn", { id }); },
    addRule: (r) => call("POST", "/api/coin/rules", r),
    deleteRule: async (id) => { await call("DELETE", "/api/coin/rules", { id }); },
    setBudget: async (category, monthly_limit) => { await call("PUT", "/api/coin/budgets", { category, monthly_limit }); },
    reclassify: () => call("POST", "/api/coin/reclassify"),
    exportFile: async (format, from, to) => {
      // fetched (not a plain link) so an expired Access session shows an error instead of a login page saved as a file
      const q = new URLSearchParams({ format, ...(from ? { from } : {}), ...(to ? { to } : {}) });
      const res = await fetch(`/api/coin/export?${q}`);
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}${res.status === 403 ? " (signed out? reload the page)" : ""}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `ryuk-money.${format}`;
      download(name, res.headers.get("content-type") ?? "text/plain", await res.text());
    },
  };
}

// ---------- demo: three months of made-up transactions, filed by the real classifier ----------
export function demoCoin(): CoinStore {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const day = (ago: number) => new Date(Date.now() + 19800e3 - ago * 86400e3).toISOString().slice(0, 10);
  let id = 1;
  const rules: Rule[] = [{ id: 1, pattern: "RAHUL SHARMA", category: "rent", invest_class: null }];
  const budgets: Budget[] = [{ category: "food", monthly_limit: 6000 }, { category: "shopping", monthly_limit: 5000 }, { category: "transport", monthly_limit: 3000 }];
  const rows: Txn[] = [];
  const push = (ago: number, type: Txn["type"], amount: number, merchant: string, channel = "upi", hh = 8 + Math.floor(rnd() * 13)) => {
    const f = classify({ merchant, type, channel }, rules as CRule[]);
    rows.push({ id: id++, date: day(ago), time: `${String(hh).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}`, type, amount, account_last4: "4821",
      merchant, balance: null, channel, source: "sms", category: f?.category ?? null, invest_class: f?.invest_class ?? null, category_src: f?.src ?? null, note: null });
  };
  const spends: [string, number, number][] = [["SWIGGY", 180, 650], ["ZOMATO", 220, 700], ["BLINKIT", 150, 900], ["UBER INDIA", 120, 480], ["RAPIDO", 40, 160],
    ["AMAZON PAY", 300, 2500], ["STARBUCKS", 280, 520], ["HPCL PETROL", 500, 1500], ["APOLLO PHARMACY", 120, 900], ["RAJU TEA STALL", 20, 60], ["BOOKMYSHOW", 300, 900]];
  for (let ago = 95; ago >= 0; ago--) {
    const n = Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) { const [m, lo, hi] = spends[Math.floor(rnd() * spends.length)]; push(ago, "debit", Math.round(lo + rnd() * (hi - lo)), m); }
    const dom = Number(day(ago).slice(8));
    if (dom === 1) push(ago, "credit", 125000, "ACME TECH SALARY", "bank", 10);
    if (dom === 3) push(ago, "debit", 22000, "RAHUL SHARMA", "upi", 9);
    if (dom === 5) { push(ago, "debit", 10000, "PPFAS MUTUAL FUND SIP", "auto_debit", 6); push(ago, "debit", 5000, "NIPPON INDIA MF SIP", "auto_debit", 6); }
    if (dom === 7) push(ago, "debit", 2000, "SAFEGOLD DIGITAL GOLD", "upi", 11);
    if (dom === 10) push(ago, "debit", 649, "NETFLIX", "card", 2);
    if (dom === 12) push(ago, "debit", 799, "AIRTEL POSTPAID", "upi", 12);
    if (dom === 15) push(ago, "debit", 8000, "ZERODHA BROKING", "netbanking", 15);
    if (dom === 20) push(ago, "debit", 18500, "CRED CLUB CREDIT CARD", "upi", 19);
    if (dom === 25) push(ago, "debit", 1500, "PPF ACCOUNT", "netbanking", 10);
  }
  rows.sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? "")));
  const find = (i: number) => { const r = rows.find((t) => t.id === i); if (!r) throw new Error("not found"); return r; };
  const apply = (r: Rule) => {
    let n = 0;
    for (const t of rows) if (t.category_src !== "manual" && (t.merchant ?? "").toUpperCase().includes(r.pattern) && (t.category !== r.category || t.invest_class !== r.invest_class)) {
      t.category = r.category; t.invest_class = r.invest_class; t.category_src = "rule"; n++;
    }
    return n;
  };
  const exportRows = (from?: string, to?: string) => rows.filter((t) => (!from || t.date >= from) && (!to || t.date <= to)).slice().reverse();
  return {
    demo: true,
    load: async () => ({
      from: day(400), rows: rows.map((r) => ({ ...r })), rules: rules.map((r) => ({ ...r })), budgets: budgets.map((b) => ({ ...b })), first: rows.at(-1)?.date ?? null,
      invest_all: byClass(rows).map((c) => ({ invest_class: c.cls, net: c.amount, n: c.n })),
    }),
    add: async (t) => {
      const f = t.category ? { category: t.category, invest_class: t.category === "investment" ? t.invest_class || "other" : null, src: "manual" } : classify({ merchant: t.merchant, type: t.type, channel: t.channel }, rules as CRule[]);
      const row: Txn = { id: id++, date: t.date, time: t.time || null, type: t.type, amount: t.amount, account_last4: "", merchant: t.merchant || null, balance: null, channel: t.channel || "cash",
        source: "manual", category: f?.category ?? null, invest_class: f?.invest_class ?? null, category_src: f?.src ?? null, note: t.note || null };
      rows.unshift(row); rows.sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? "")));
      return { ...row };
    },
    edit: async (i, p) => {
      const r = find(i);
      if ("category" in p) { r.category = p.category || null; r.invest_class = p.category === "investment" ? p.invest_class || "other" : null; r.category_src = p.category ? "manual" : null; }
      if (p.note !== undefined) r.note = p.note || null;
      if (p.merchant !== undefined) r.merchant = p.merchant || null;
      if (p.type) r.type = p.type as Txn["type"];
      if (p.channel) r.channel = p.channel;
      let applied = 0;
      if (p.remember && r.category && r.merchant) {
        const pattern = r.merchant.toUpperCase().trim();
        const ex = rules.find((x) => x.pattern === pattern);
        if (ex) { ex.category = r.category; ex.invest_class = r.invest_class; } else rules.push({ id: rules.length + 100, pattern, category: r.category, invest_class: r.invest_class });
        applied = apply({ id: 0, pattern, category: r.category, invest_class: r.invest_class });
      }
      return { row: { ...r }, applied };
    },
    remove: async (i) => { const k = rows.findIndex((t) => t.id === i); if (k >= 0) rows.splice(k, 1); },
    addRule: async (r) => {
      const pattern = r.pattern.toUpperCase().replace(/\s+/g, " ").trim();
      if (pattern.length < 2) throw new Error("pattern needs at least 2 characters");
      const rule: Rule = { id: rules.length + 100, pattern, category: r.category, invest_class: r.category === "investment" ? r.invest_class || "other" : null };
      const k = rules.findIndex((x) => x.pattern === pattern); if (k >= 0) rules[k] = rule; else rules.push(rule);
      return { applied: apply(rule) };
    },
    deleteRule: async (i) => { const k = rules.findIndex((r) => r.id === i); if (k >= 0) rules.splice(k, 1); },
    setBudget: async (category, limit) => {
      const k = budgets.findIndex((b) => b.category === category);
      if (!limit) { if (k >= 0) budgets.splice(k, 1); } else if (k >= 0) budgets[k].monthly_limit = limit; else budgets.push({ category, monthly_limit: limit });
    },
    reclassify: async () => {
      let changed = 0;
      for (const t of rows) if (t.category_src !== "manual") {
        const f = classify(t, rules as CRule[]);
        if ((f?.category ?? null) !== t.category || (f?.invest_class ?? null) !== t.invest_class) { t.category = f?.category ?? null; t.invest_class = f?.invest_class ?? null; t.category_src = f?.src ?? null; changed++; }
      }
      return { changed };
    },
    exportFile: async (format, from, to) => {
      const out = exportRows(from, to);
      const cols = ["date", "time", "type", "amount", "merchant", "category", "invest_class", "channel", "account_last4", "balance", "note", "source"] as const;
      const name = `ryuk-money-demo-${from ?? "start"}-to-${to ?? istToday()}.${format}`;
      if (format === "json") return download(name, "application/json", JSON.stringify({ demo: true, rows: out }, null, 2));
      const cell = (v: unknown) => { if (v == null) return ""; let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      download(name, "text/csv", [cols.join(","), ...out.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n"));
    },
  };
}
