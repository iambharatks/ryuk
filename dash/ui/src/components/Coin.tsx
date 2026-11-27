import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Repeat, Search, Trash2, Wand2, X } from "lucide-react";
import { Card } from "./ui";
import {
  CATEGORIES, CHANNELS, INVEST_CLASSES, SPEND_CATS, byCategory, byClass, byMerchant, catLabel, classLabel, inr, inrShort, istToday, kindOf,
  lastMonths, recurring, totals, type Budget, type CoinData, type CoinStore, type Txn,
} from "../coin";

/* ================= Money: finance on its own, away from the daily logs ================= */

type Mode = "month" | "year";
type Tab = "overview" | "txns" | "invest" | "rules";
type Filter = "all" | "spend" | "income" | "invest" | "transfer" | "uncat";

const CLASS_COLOR: Record<string, string> = { mutual_fund: "#F4F4F6", stocks: "#C84B31", gold: "#D9A441", fd_rd: "#8E8E9A", retirement: "#B5B5C0", crypto: "#D9846F", real_estate: "#5E5E6A", other: "#41414C" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayLabel = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const shift = (mode: Mode, key: string, by: number) => {
  if (mode === "year") return String(Number(key) + by);
  let [y, m] = key.split("-").map(Number); m += by;
  while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
};
const rangeOf = (mode: Mode, key: string) => mode === "year" ? [`${key}-01-01`, `${key}-12-31`] : [`${key}-01`, `${key}-31`];
const sign = (t: Txn) => (t.type === "debit" ? "−" : "+");

export function Coin({ store }: { store: CoinStore }) {
  const [data, setData] = useState<CoinData | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<Mode>("month");
  const [key, setKey] = useState(istToday().slice(0, 7));
  const [tab, setTab] = useState<Tab>(() => (["overview", "txns", "invest", "rules"].includes(sessionStorage.getItem("ryuk.coin.tab") ?? "") ? sessionStorage.getItem("ryuk.coin.tab") as Tab : "overview"));
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Txn | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");

  const load = () => store.load().then((d) => { setData(d); setErr(""); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [store]);
  useEffect(() => { sessionStorage.setItem("ryuk.coin.tab", tab); }, [tab]);
  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(""), 3200); };

  const switchMode = (m: Mode) => { setMode(m); setKey(m === "year" ? key.slice(0, 4) : key.length === 4 ? (key === istToday().slice(0, 4) ? istToday().slice(0, 7) : `${key}-12`) : key); };
  const [from, to] = rangeOf(mode, key);
  const rows = useMemo(() => (data?.rows ?? []).filter((t) => t.date >= from && t.date <= to), [data, from, to]);
  const prevRows = useMemo(() => { const [a, b] = rangeOf(mode, shift(mode, key, -1)); return (data?.rows ?? []).filter((t) => t.date >= a && t.date <= b); }, [data, mode, key]);
  const tot = useMemo(() => totals(rows), [rows]);
  const prev = useMemo(() => totals(prevRows), [prevRows]);
  const atEnd = mode === "year" ? key >= istToday().slice(0, 4) : key >= istToday().slice(0, 7);
  const uncat = rows.filter((t) => !t.category && kindOf(t) === "spend").length;

  const replace = (row: Txn) => setData((d) => d && { ...d, rows: d.rows.map((t) => (t.id === row.id ? row : t)) });

  if (err && !data) return (
    <Card className="p-8 text-center">
      <p className="font-serif text-2xl text-ink">The ledger of coin could not be opened.</p>
      <p className="mt-2 font-mono text-xs text-slate">{err}</p>
      {/no such (table|column)/i.test(err) && <p className="mx-auto mt-3 max-w-md text-[13px] text-slate">The database needs the Money migration: <code className="font-mono text-ink">npx wrangler d1 execute ryuk --remote --file=migrations/003_money.sql</code></p>}
      <button className="btn mx-auto mt-5" onClick={load}>Try again</button>
    </Card>
  );
  if (!data) return <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card h-28 animate-pulse" />)}</div>;

  return (
    <div className="space-y-6">
      {/* period + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn !p-2" onClick={() => setKey(shift(mode, key, -1))} aria-label="Previous period"><ChevronLeft size={15} /></button>
          <div className="min-w-[120px] text-center font-serif text-[22px] leading-none text-ink">{mode === "year" ? key : monthName(key)}</div>
          <button className="btn !p-2 disabled:opacity-30" disabled={atEnd} onClick={() => setKey(shift(mode, key, 1))} aria-label="Next period"><ChevronRight size={15} /></button>
          <div className="ml-1 flex rounded-xl border border-hairline p-0.5">
            {(["month", "year"] as Mode[]).map((m) => (
              <button key={m} onClick={() => switchMode(m)} className={`rounded-lg px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] ${mode === m ? "bg-raised text-ink" : "text-slate"}`}>{m}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => setAdding(true)}><Plus size={14} />Add</button>
          <ExportMenu onExport={(f, all) => store.exportFile(f, all ? undefined : from, all ? undefined : to).catch((e) => flash((e as Error).message))} label={mode === "year" ? key : monthName(key)} />
        </div>
      </div>

      {/* the four numbers */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Tile label="Spent" value={tot.spent} prev={prev.spent} badWhenUp hint={tot.refunds ? `after ${inrShort(tot.refunds)} back` : undefined} />
        <Tile label="Received" value={tot.received} prev={prev.received} />
        <Tile label="Invested" value={tot.netInvested} prev={prev.netInvested} accent hint={tot.redeemed ? `${inrShort(tot.redeemed)} taken out` : undefined} />
        <Tile label="Left over" value={tot.left} hint={tot.saveRate != null ? `${Math.round(tot.saveRate * 100)}% of income kept or invested` : "no income this period"} />
      </div>

      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {([["overview", "Overview"], ["txns", "Transactions"], ["invest", "Investments"], ["rules", "Rules & budgets"]] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`chip !px-3 !py-1.5 ${tab === t ? "!border-apple/60 !text-ink" : ""}`}>
            {l}{t === "txns" && uncat > 0 && <span className="ml-1.5 text-apple">· {uncat} to file</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview rows={rows} mode={mode} keyStr={key} budgets={data.budgets} uncat={uncat} onFile={() => { setFilter("uncat"); setTab("txns"); }} onOpen={setEditing} />}
      {tab === "txns" && <Transactions rows={rows} filter={filter} setFilter={setFilter} onOpen={setEditing} />}
      {tab === "invest" && <Investments all={data} rows={rows} keyStr={key} mode={mode} onOpen={setEditing} />}
      {tab === "rules" && <RulesBudgets data={data} store={store} monthRows={(data.rows ?? []).filter((t) => t.date.startsWith(istToday().slice(0, 7)))} onChanged={load} flash={flash} />}

      {editing && <TxnEditor txn={editing} store={store} onClose={() => setEditing(null)} flash={flash}
        onSaved={(row, applied) => { if (applied) { load(); flash(`Filed ${applied} more from ${row.merchant} the same way`); } else replace(row); setEditing(null); }}
        onDeleted={(id) => { setData((d) => d && { ...d, rows: d.rows.filter((t) => t.id !== id) }); setEditing(null); }} />}
      {adding && <AddTxn store={store} onClose={() => setAdding(false)} onAdded={(row) => { setData((d) => d && { ...d, rows: [row, ...d.rows].sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? ""))) }); setAdding(false); flash("Added"); }} />}
      <div role="status" className={`fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-hairline bg-raised px-4 py-2 font-mono text-[11px] text-ink transition-opacity ${note ? "opacity-100" : "pointer-events-none opacity-0"}`} style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>{note}</div>
    </div>
  );
}

function Tile({ label, value, prev, hint, accent, badWhenUp }: { label: string; value: number; prev?: number; hint?: string; accent?: boolean; badWhenUp?: boolean }) {
  const delta = prev != null && prev > 0 ? (value - prev) / prev : null;
  const up = delta != null && delta > 0.005, down = delta != null && delta < -0.005;
  const bad = badWhenUp ? up : down;
  return (
    <Card className="p-4 md:p-5">
      <div className="eyebrow">{label}</div>
      <div className={`mt-2 font-mono text-[22px] leading-none tabular-nums md:text-[28px] ${accent ? "text-apple" : value < 0 ? "text-apple" : "text-ink"}`}>{inrShort(value)}</div>
      <div className="mt-2 min-h-[16px] text-[12px] text-slate">
        {delta != null && (up || down) && <span className={bad ? "text-apple" : "text-[#8fbf9a]"}>{up ? "▲" : "▼"} {Math.abs(Math.round(delta * 100))}% </span>}
        {delta != null && (up || down) && <span className="text-slate-dim">vs last{hint ? " · " : ""}</span>}
        {hint}
      </div>
    </Card>
  );
}

function ExportMenu({ onExport, label }: { onExport: (f: "csv" | "json", all: boolean) => void; label: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const c = () => setOpen(false); setTimeout(() => window.addEventListener("click", c), 0); return () => window.removeEventListener("click", c); }, [open]);
  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Download size={14} />Export</button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-hairline bg-raised py-1 shadow-[0_12px_30px_-8px_rgba(0,0,0,.9)]">
          {([[false, "csv"], [false, "json"], [true, "csv"], [true, "json"]] as [boolean, "csv" | "json"][]).map(([all, f]) => (
            <button key={`${all}${f}`} role="menuitem" onClick={() => onExport(f, all)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] text-ink hover:bg-apple/10">
              <span>{all ? "Everything" : label}</span><span className="font-mono text-[10.5px] uppercase text-slate">{f}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- overview ---------- */
function Overview({ rows, mode, keyStr, budgets, uncat, onFile, onOpen }: { rows: Txn[]; mode: Mode; keyStr: string; budgets: Budget[]; uncat: number; onFile: () => void; onOpen: (t: Txn) => void }) {
  const cats = byCategory(rows);
  const total = cats.reduce((s, c) => s + c.amount, 0);
  const limit = (c: string | null) => { const b = budgets.find((x) => x.category === c); return b ? b.monthly_limit * (mode === "year" ? 12 : 1) : null; };
  const merchants = byMerchant(rows).slice(0, 6);
  // spending per day (month) or per month (year)
  const buckets = mode === "month"
    ? Array.from({ length: new Date(Number(keyStr.slice(0, 4)), Number(keyStr.slice(5, 7)), 0).getDate() }, (_, i) => `${keyStr}-${String(i + 1).padStart(2, "0")}`)
    : Array.from({ length: 12 }, (_, i) => `${keyStr}-${String(i + 1).padStart(2, "0")}`);
  const per = new Map<string, number>();
  for (const t of rows) if (kindOf(t) === "spend") { const k = mode === "month" ? t.date : t.date.slice(0, 7); per.set(k, (per.get(k) ?? 0) + t.amount); }
  const big = rows.filter((t) => kindOf(t) === "spend").sort((a, b) => b.amount - a.amount).slice(0, 4);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card className="p-5 md:p-6 lg:self-start">
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Where it went</div>
          {uncat > 0 && <button onClick={onFile} className="font-mono text-[11px] text-apple hover:underline">{uncat} not filed yet →</button>}
        </div>
        {cats.length ? (
          <ul className="mt-4 space-y-3.5">
            {cats.map((c) => {
              const lim = limit(c.category), over = lim != null && c.amount > lim;
              const w = lim ? Math.min(100, (c.amount / lim) * 100) : total ? (c.amount / cats[0].amount) * 100 : 0;
              return (
                <li key={c.category ?? "none"}>
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className={c.category ? "text-ink" : "italic text-slate"}>{catLabel(c.category)} <span className="font-mono text-[10.5px] text-slate-dim">{c.n}</span></span>
                    <span className="font-mono text-[13px] tabular-nums text-ink">{inr(c.amount)}
                      <span className="ml-2 text-[11px] text-slate-dim">{lim ? `of ${inrShort(lim)}` : `${Math.round((c.amount / total) * 100)}%`}</span></span>
                  </div>
                  <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-hairline">
                    <div className={`h-full rounded-full ${over ? "bg-apple" : lim ? "bg-[#8fbf9a]" : "bg-ink/70"}`} style={{ width: `${Math.max(2, w)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-6 text-[15px] text-slate">No spending recorded in this period.</p>}
      </Card>

      <div className="space-y-5">
        <Card className="p-5 md:p-6">
          <div className="eyebrow">{mode === "month" ? "Spent per day" : "Spent per month"}</div>
          <Bars keys={buckets} values={buckets.map((k) => per.get(k) ?? 0)} label={(k) => (mode === "month" ? String(Number(k.slice(8))) : MONTHS[Number(k.slice(5, 7)) - 1])} />
        </Card>
        <Card className="p-5 md:p-6">
          <div className="eyebrow">Most paid to</div>
          <ul className="mt-3 divide-y divide-hairline">
            {merchants.map((m) => (
              <li key={m.merchant} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
                <span className="min-w-0 truncate text-ink">{m.merchant} <span className="font-mono text-[10.5px] text-slate-dim">×{m.n}</span></span>
                <span className="font-mono text-[13px] tabular-nums text-ink">{inr(m.amount)}</span>
              </li>
            ))}
            {!merchants.length && <li className="py-2 text-[14px] text-slate">Nobody yet.</li>}
          </ul>
        </Card>
        {big.length > 0 && (
          <Card className="p-5 md:p-6">
            <div className="eyebrow">Biggest spends</div>
            <ul className="mt-3 divide-y divide-hairline">
              {big.map((t) => (
                <li key={t.id}><button onClick={() => onOpen(t)} className="flex w-full items-baseline justify-between gap-3 py-2 text-left text-[14px] hover:text-apple">
                  <span className="min-w-0 truncate">{t.merchant || "—"} <span className="font-mono text-[10.5px] text-slate-dim">{t.date.slice(8)}/{t.date.slice(5, 7)}</span></span>
                  <span className="font-mono text-[13px] tabular-nums">{inr(t.amount)}</span>
                </button></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Bars({ keys, values, label, color = "#F4F4F6" }: { keys: string[]; values: number[]; label: (k: string) => string; color?: string }) {
  const max = Math.max(1, ...values);
  const [hover, setHover] = useState<number | null>(null);
  const step = Math.max(1, Math.ceil(keys.length / 8));
  return (
    <div className="mt-4">
      <div className="h-5 font-mono text-[11px] text-slate">{hover != null ? <>{label(keys[hover])} · <span className="text-ink">{inr(values[hover])}</span></> : <>peak <span className="text-ink">{inr(max)}</span></>}</div>
      <div className="mt-1 flex h-[110px] items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => (
          <button key={keys[i]} aria-label={`${label(keys[i])}: ${inr(v)}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} className="group flex h-full flex-1 items-end">
            <span className="block w-full rounded-t-[2px] transition-opacity" style={{ height: `${v ? Math.max(3, (v / max) * 100) : 1}%`, background: v ? color : "#24242C", opacity: hover == null || hover === i ? 1 : 0.45 }} />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] font-mono text-[9.5px] text-slate-dim">
        {keys.map((k, i) => <span key={k} className="flex-1 text-center">{i % step === 0 ? label(k) : ""}</span>)}
      </div>
    </div>
  );
}

/* ---------- transactions ---------- */
function Transactions({ rows, filter, setFilter, onOpen }: { rows: Txn[]; filter: Filter; setFilter: (f: Filter) => void; onOpen: (t: Txn) => void }) {
  const [q, setQ] = useState("");
  const match = (t: Txn) => {
    const k = kindOf(t);
    if (filter === "spend" && k !== "spend") return false;
    if (filter === "income" && k !== "income" && k !== "refund") return false;
    if (filter === "invest" && k !== "invest" && k !== "redeem") return false;
    if (filter === "transfer" && k !== "transfer") return false;
    if (filter === "uncat" && t.category) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [t.merchant, catLabel(t.category), t.note, t.channel, String(t.amount), t.account_last4].some((v) => String(v ?? "").toLowerCase().includes(s));
  };
  const shown = rows.filter(match);
  const days = new Map<string, Txn[]>();
  for (const t of shown) days.set(t.date, [...(days.get(t.date) ?? []), t]);
  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {([["all", "All"], ["spend", "Spent"], ["income", "Received"], ["invest", "Invested"], ["transfer", "Transfers"], ["uncat", "Not filed"]] as [Filter, string][]).map(([f, l]) => (
            <button key={f} onClick={() => setFilter(f)} className={`chip !px-3 !py-1.5 ${filter === f ? "!border-apple/60 !text-ink" : ""}`}>{l}</button>
          ))}
        </div>
        <label className="relative md:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
          <input className="field !pl-9" placeholder="Merchant, category, note, amount" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <p className="mt-3 font-mono text-[10.5px] text-slate-dim">Tap a transaction to file it, mark it as an investment, or add a note.</p>
      <div className="mt-4 space-y-5">
        {[...days].map(([d, ts]) => {
          const out = ts.filter((t) => kindOf(t) === "spend").reduce((s, t) => s + t.amount, 0);
          return (
            <section key={d}>
              <div className="mb-1.5 flex items-baseline justify-between border-b border-hairline pb-1.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-slate">{dayLabel(d)}</span>
                {out > 0 && <span className="font-mono text-[11px] tabular-nums text-slate">spent {inr(out)}</span>}
              </div>
              <ul>
                {ts.map((t) => {
                  const k = kindOf(t);
                  return (
                    <li key={t.id}>
                      <button onClick={() => onOpen(t)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-raised/60 md:grid-cols-[52px_minmax(0,1fr)_minmax(0,220px)_110px]">
                        <span className="hidden font-mono text-[11px] tabular-nums text-slate-dim md:block">{t.time ?? ""}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] text-ink">{t.merchant || <span className="italic text-slate">no merchant</span>}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-slate-dim">
                            <span className="md:hidden">{t.time ?? ""}</span>
                            <span>{t.channel ?? ""}{t.account_last4 ? ` ··${t.account_last4}` : ""}</span>
                            {t.source === "manual" && <span>added by hand</span>}
                            {t.note && <span className="truncate italic text-slate">“{t.note}”</span>}
                            <span className="md:hidden"><CatChip t={t} /></span>
                          </span>
                        </span>
                        <span className="hidden min-w-0 justify-end md:flex"><CatChip t={t} /></span>
                        <span className={`text-right font-mono text-[14px] tabular-nums ${k === "income" || k === "refund" || k === "redeem" ? "text-[#8fbf9a]" : k === "invest" ? "text-apple" : k === "transfer" ? "text-slate" : "text-ink"}`}>
                          {sign(t)}{inr(t.amount, t.amount % 1 !== 0)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!shown.length && <Card className="px-4 py-10 text-center text-slate">{filter === "uncat" ? "Everything in this period is filed." : "Nothing here."}</Card>}
      </div>
    </div>
  );
}

function CatChip({ t }: { t: Txn }) {
  if (!t.category) return <span className="chip !border-dashed !text-apple/90">not filed</span>;
  const inv = t.category === "investment";
  return (
    <span className={`chip inline-block max-w-full truncate ${inv ? "!border-apple/50 !text-apple" : ""} ${t.category_src === "manual" ? "!border-ink/30" : ""}`}
      title={t.category_src === "manual" ? "filed by you" : t.category_src === "rule" ? "filed by one of your rules" : "filed automatically"}>
      {inv ? classLabel(t.invest_class) : catLabel(t.category)}
    </span>
  );
}

/* ---------- investments ---------- */
function Investments({ all, rows, keyStr, mode, onOpen }: { all: CoinData; rows: Txn[]; keyStr: string; mode: Mode; onOpen: (t: Txn) => void }) {
  const period = byClass(rows);
  const periodTotal = period.reduce((s, c) => s + c.amount, 0);
  const lifetime = all.invest_all.map((c) => ({ cls: c.invest_class || "other", amount: c.net, n: c.n })).sort((a, b) => b.amount - a.amount);
  const lifeTotal = lifetime.reduce((s, c) => s + c.amount, 0);
  const sips = recurring(all.rows);
  const end = mode === "year" ? (keyStr === istToday().slice(0, 4) ? istToday().slice(0, 7) : `${keyStr}-12`) : keyStr;
  const months = lastMonths(end, 12);
  const perMonth = months.map((m) => byClass(all.rows.filter((t) => t.date.startsWith(m))).reduce((s, c) => s + c.amount, 0));
  const list = rows.filter((t) => { const k = kindOf(t); return k === "invest" || k === "redeem"; });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5 md:p-6">
          <div className="flex items-baseline justify-between">
            <div className="eyebrow">Put away, all time</div>
            <div className="font-mono text-[20px] tabular-nums text-apple">{inr(lifeTotal)}</div>
          </div>
          <ClassBars items={lifetime} total={lifeTotal} />
          <p className="mt-4 text-[12px] text-slate-dim">Money in, minus anything taken back out. It is what you invested, not what it is worth today.</p>
        </Card>
        <Card className="p-5 md:p-6">
          <div className="flex items-baseline justify-between">
            <div className="eyebrow">{mode === "year" ? keyStr : monthName(keyStr)}</div>
            <div className="font-mono text-[20px] tabular-nums text-ink">{inr(periodTotal)}</div>
          </div>
          {period.length ? <ClassBars items={period} total={periodTotal} /> : <p className="mt-5 text-[14px] text-slate">Nothing invested in this period.</p>}
          <div className="mt-5 eyebrow">Invested per month</div>
          <Bars keys={months} values={perMonth.map((v) => Math.max(0, v))} label={(k) => MONTHS[Number(k.slice(5, 7)) - 1]} color="#C84B31" />
        </Card>
      </div>

      <Card className="p-5 md:p-6">
        <div className="flex items-center gap-2"><Repeat size={14} className="text-apple" /><div className="eyebrow">Recurring (SIPs and the like)</div></div>
        {sips.length ? (
          <ul className="mt-3 divide-y divide-hairline">
            {sips.map((s) => (
              <li key={`${s.merchant}${s.amount}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2.5 text-[14px] md:grid-cols-[minmax(0,1fr)_160px_190px_auto]">
                <span className="min-w-0 truncate text-ink">{s.merchant}</span>
                <span className="hidden text-slate md:block">{classLabel(s.cls)}</span>
                <span className="hidden font-mono text-[11px] text-slate-dim md:block">around the {s.day}{[, "st", "nd", "rd"][s.day % 10 > 3 || Math.floor(s.day / 10) === 1 ? 0 : s.day % 10] ?? "th"} · {s.months} months</span>
                <span className="font-mono tabular-nums text-ink">{inr(s.amount)}<span className="text-slate-dim">/mo</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-[14px] text-slate">None found yet. A payment to the same place for about the same amount in two different months shows up here.</p>}
      </Card>

      <Card className="p-5 md:p-6">
        <div className="eyebrow">Investment transactions · {mode === "year" ? keyStr : monthName(keyStr)}</div>
        <ul className="mt-3 divide-y divide-hairline">
          {list.map((t) => (
            <li key={t.id}><button onClick={() => onOpen(t)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-2.5 text-left text-[14px] hover:text-apple md:grid-cols-[90px_minmax(0,1fr)_160px_auto]">
              <span className="hidden font-mono text-[11px] text-slate-dim md:block">{dayLabel(t.date)}</span>
              <span className="min-w-0 truncate">{t.merchant || "—"}{t.note && <span className="ml-2 italic text-slate">“{t.note}”</span>}</span>
              <span className="hidden text-slate md:block">{classLabel(t.invest_class)}</span>
              <span className={`font-mono tabular-nums ${t.type === "debit" ? "text-ink" : "text-[#8fbf9a]"}`}>{t.type === "debit" ? "" : "redeemed "}{inr(t.amount)}</span>
            </button></li>
          ))}
          {!list.length && <li className="py-2 text-[14px] text-slate">None in this period.</li>}
        </ul>
        <p className="mt-4 text-[12px] text-slate-dim">Mutual funds, brokers, digital gold, PPF/NPS and FDs are recognised by name. Anything else: open it in Transactions and mark it as an investment, then tick “always” so the next one lands here on its own.</p>
      </Card>
    </div>
  );
}

function ClassBars({ items, total }: { items: { cls: string; amount: number; n: number }[]; total: number }) {
  const pos = items.filter((i) => i.amount > 0);
  const sum = pos.reduce((s, i) => s + i.amount, 0) || 1;
  return (
    <>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-hairline">
        {pos.map((i) => <span key={i.cls} title={classLabel(i.cls)} style={{ width: `${(i.amount / sum) * 100}%`, background: CLASS_COLOR[i.cls] ?? "#41414C" }} />)}
      </div>
      <ul className="mt-4 space-y-2">
        {items.map((i) => (
          <li key={i.cls} className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="flex items-center gap-2 text-ink"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CLASS_COLOR[i.cls] ?? "#41414C" }} />{classLabel(i.cls)} <span className="font-mono text-[10.5px] text-slate-dim">{i.n}</span></span>
            <span className="font-mono text-[13px] tabular-nums text-ink">{inr(i.amount)} <span className="ml-1 text-[11px] text-slate-dim">{total > 0 ? Math.round((i.amount / total) * 100) : 0}%</span></span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- rules & budgets ---------- */
function RulesBudgets({ data, store, monthRows, onChanged, flash }: { data: CoinData; store: CoinStore; monthRows: Txn[]; onChanged: () => void; flash: (m: string) => void }) {
  const [r, setR] = useState({ pattern: "", category: "food", invest_class: "mutual_fund" });
  const [busy, setBusy] = useState(false);
  const spentNow = new Map(byCategory(monthRows).map((c) => [c.category, c.amount]));
  const addRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (r.pattern.trim().length < 2) return flash("Type part of the merchant name");
    setBusy(true);
    try { const { applied } = await store.addRule(r); flash(`Rule saved · ${applied} past ${applied === 1 ? "entry" : "entries"} re-filed`); setR({ ...r, pattern: "" }); onChanged(); }
    catch (x) { flash((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="p-5 md:p-6 lg:self-start">
        <div className="eyebrow">Rules</div>
        <p className="mt-2 text-[13px] text-slate">When the merchant contains this text, file it here. Your rules win over the built-in lists, apply to past entries now and to every new SMS. Entries you filed by hand are never changed.</p>
        <form onSubmit={addRule} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input className="field sm:col-span-2" placeholder="Merchant text, e.g. PPFAS or RAHUL" value={r.pattern} onChange={(e) => setR({ ...r, pattern: e.target.value })} />
          <CategorySelect value={r.category} onChange={(v) => setR({ ...r, category: v })} />
          {r.category === "investment" && <ClassSelect value={r.invest_class} onChange={(v) => setR({ ...r, invest_class: v })} />}
          <button disabled={busy} className="btn justify-center !border-apple/50 sm:col-span-2">{busy ? "Saving…" : "Add rule"}</button>
        </form>
        <ul className="mt-5 divide-y divide-hairline">
          {data.rules.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-[14px]"><span className="font-mono text-[12.5px] text-ink">{x.pattern}</span> <span className="text-slate">→ {x.category === "investment" ? `Investment · ${classLabel(x.invest_class)}` : catLabel(x.category)}</span></span>
              <button aria-label={`Delete rule ${x.pattern}`} onClick={async () => { await store.deleteRule(x.id); onChanged(); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-dim hover:bg-apple/10 hover:text-apple"><Trash2 size={14} /></button>
            </li>
          ))}
          {!data.rules.length && <li className="py-2 text-[14px] text-slate">No rules yet.</li>}
        </ul>
        <button className="btn mt-4" disabled={busy} onClick={async () => { setBusy(true); try { const { changed } = await store.reclassify(); flash(`Re-filed ${changed} ${changed === 1 ? "entry" : "entries"}`); onChanged(); } catch (x) { flash((x as Error).message); } finally { setBusy(false); } }}>
          <Wand2 size={14} />Re-file everything not filed by hand
        </button>
      </Card>

      <Card className="p-5 md:p-6">
        <div className="eyebrow">Monthly budgets</div>
        <p className="mt-2 text-[13px] text-slate">A limit per category. The bar on the overview turns red when a month goes over. Leave empty for no limit.</p>
        <ul className="mt-4 divide-y divide-hairline">
          {SPEND_CATS.map((c) => {
            const b = data.budgets.find((x) => x.category === c);
            const spent = spentNow.get(c) ?? 0;
            return (
              <li key={c} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-3 py-2">
                <span className="min-w-0 text-[14px] text-ink">{catLabel(c)}
                  {spent > 0 && <span className={`ml-2 font-mono text-[11px] ${b && spent > b.monthly_limit ? "text-apple" : "text-slate-dim"}`}>{inrShort(spent)} this month</span>}</span>
                <input inputMode="numeric" defaultValue={b?.monthly_limit ?? ""} placeholder="no limit" aria-label={`Monthly budget for ${catLabel(c)}`}
                  className="field !py-1.5 text-right font-mono"
                  onBlur={async (e) => {
                    const v = e.currentTarget.value.replace(/[^\d.]/g, "");
                    if (String(b?.monthly_limit ?? "") === v) return;
                    try { await store.setBudget(c, v ? Number(v) : null); onChanged(); } catch (x) { flash((x as Error).message); }
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function CategorySelect({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">Not filed</option>}
      <optgroup label="Spending">{SPEND_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</optgroup>
      <optgroup label="Not spending">{(["investment", "transfer", "income", "refund"] as const).map((c) => <option key={c} value={c}>{CATEGORIES[c]}</option>)}</optgroup>
    </select>
  );
}
function ClassSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(INVEST_CLASSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

/* ---------- one transaction ---------- */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="safe-pad fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-hairline bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="min-w-0 truncate font-serif text-[22px] text-ink">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate hover:text-ink md:h-8 md:w-8"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TxnEditor({ txn, store, onClose, onSaved, onDeleted, flash }: {
  txn: Txn; store: CoinStore; onClose: () => void; onSaved: (row: Txn, applied: number) => void; onDeleted: (id: number) => void; flash: (m: string) => void;
}) {
  const [v, setV] = useState({ category: txn.category ?? "", invest_class: txn.invest_class ?? "mutual_fund", note: txn.note ?? "", merchant: txn.merchant ?? "", type: txn.type, channel: txn.channel ?? "upi" });
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = (c: string) => setV({ ...v, category: v.category === c ? "" : c });
  const save = async () => {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (v.category !== (txn.category ?? "") || (v.category === "investment" && v.invest_class !== txn.invest_class)) { patch.category = v.category || null; patch.invest_class = v.category === "investment" ? v.invest_class : null; }
      if (v.note !== (txn.note ?? "")) patch.note = v.note;
      if (v.merchant !== (txn.merchant ?? "")) patch.merchant = v.merchant;
      if (v.type !== txn.type) patch.type = v.type;
      if (v.channel !== (txn.channel ?? "")) patch.channel = v.channel;
      if (remember && v.category) { patch.remember = true; if (!("category" in patch)) { patch.category = v.category; patch.invest_class = v.category === "investment" ? v.invest_class : null; } }
      if (!Object.keys(patch).length) return onClose();
      const { row, applied } = await store.edit(txn.id, patch);
      onSaved(row, applied);
    } catch (x) { flash((x as Error).message); setBusy(false); }
  };
  const chips = (list: readonly string[]) => list.map((c) => (
    <button key={c} type="button" onClick={() => pick(c)} className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition ${v.category === c ? "border-apple bg-apple/15 text-ink" : "border-hairline text-slate hover:text-ink"}`}>{catLabel(c)}</button>
  ));
  return (
    <Sheet title={txn.merchant || "Transaction"} onClose={onClose}>
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
        <span className="font-mono text-[11px] text-slate">{dayLabel(txn.date)}{txn.time ? ` · ${txn.time}` : ""} · {txn.channel}{txn.account_last4 ? ` ··${txn.account_last4}` : ""}{txn.source === "manual" ? " · by hand" : " · from SMS"}</span>
        <span className="font-mono text-[20px] tabular-nums text-ink">{sign(txn)}{inr(txn.amount, txn.amount % 1 !== 0)}</span>
      </div>

      <div className="mt-4 eyebrow">Spending</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{chips(SPEND_CATS)}</div>
      <div className="mt-4 eyebrow">Not spending</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{chips(["investment", "transfer", "income", "refund"])}</div>
      {v.category === "investment" && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(INVEST_CLASSES).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setV({ ...v, invest_class: k })} className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] ${v.invest_class === k ? "border-apple bg-apple/15 text-ink" : "border-hairline text-slate hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      )}
      {v.category && (v.merchant || txn.merchant) && (
        <label className="mt-4 flex items-start gap-2.5 text-[13px] text-slate">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 accent-[#C84B31]" />
          <span>Always file <span className="font-mono text-ink">{(v.merchant || txn.merchant || "").toUpperCase()}</span> as {v.category === "investment" ? `Investment · ${classLabel(v.invest_class)}` : catLabel(v.category)}: past entries now, new ones as they arrive.</span>
        </label>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <input className="field col-span-2" placeholder="Merchant" maxLength={80} value={v.merchant} onChange={(e) => setV({ ...v, merchant: e.target.value })} />
        <select className="field" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as Txn["type"] })}>
          <option value="debit">Money out</option><option value="credit">Money in</option><option value="refund">Refund</option>
        </select>
        <select className="field" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>
          {CHANNELS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
        </select>
        <textarea className="field col-span-2 min-h-[64px]" placeholder="Note (optional)" maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" className="btn !text-apple" disabled={busy} onClick={async () => {
          if (!confirm("Erase this transaction? It cannot be undone here (D1 keeps 7 days of history).")) return;
          try { await store.remove(txn.id); onDeleted(txn.id); } catch (x) { flash((x as Error).message); }
        }}><Trash2 size={14} />Erase</button>
        <button type="button" className="btn min-h-[44px] !border-apple/50 px-5" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Sheet>
  );
}

function AddTxn({ store, onClose, onAdded }: { store: CoinStore; onClose: () => void; onAdded: (t: Txn) => void }) {
  const [v, setV] = useState({ date: istToday(), time: "", type: "debit" as Txn["type"], amount: "", merchant: "", channel: "cash", category: "", invest_class: "mutual_fund", note: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(v.amount.replace(/[^\d.]/g, ""));
    if (!amount) return setErr("Enter an amount.");
    setBusy(true);
    try {
      onAdded(await store.add({ date: v.date, time: v.time || undefined, type: v.type, amount, merchant: v.merchant.trim() || undefined, channel: v.channel,
        category: v.category || undefined, invest_class: v.category === "investment" ? v.invest_class : undefined, note: v.note.trim() || undefined }));
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <Sheet title="Add a transaction" onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-2">
        <p className="col-span-2 -mt-1 mb-1 text-[13px] text-slate">For cash, or anything the bank never texted about. Leave the category empty to let the rules file it.</p>
        <input className="field" type="date" max={istToday()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} aria-label="Date" />
        <input className="field" type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} aria-label="Time (optional)" />
        <select className="field" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as Txn["type"] })}>
          <option value="debit">Money out</option><option value="credit">Money in</option><option value="refund">Refund</option>
        </select>
        <input className="field font-mono" inputMode="decimal" placeholder="Amount ₹" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} autoFocus />
        <input className="field col-span-2" placeholder="Paid to / from" maxLength={80} value={v.merchant} onChange={(e) => setV({ ...v, merchant: e.target.value })} />
        <select className="field" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>
          {CHANNELS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
        </select>
        <CategorySelect value={v.category} onChange={(c) => setV({ ...v, category: c })} allowNone />
        {v.category === "investment" && <div className="col-span-2"><ClassSelect value={v.invest_class} onChange={(c) => setV({ ...v, invest_class: c })} /></div>}
        <textarea className="field col-span-2 min-h-[60px]" placeholder="Note (optional)" maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        {err && <p className="col-span-2 text-[12px] text-apple">{err}</p>}
        <button disabled={busy} className="btn col-span-2 min-h-[44px] justify-center !border-apple/50">{busy ? "Adding…" : "Add"}</button>
      </form>
    </Sheet>
  );
}
