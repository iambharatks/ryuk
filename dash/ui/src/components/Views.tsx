import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search, Trash2 } from "lucide-react";
import { Data, Ev, allEvents, byDay, avgByDay, dayKey, lastDays, prettyDay, seriesOf } from "../data";
import { ACCENT, Card, CardHead, Legend, Lines, SERIES, StackedBars, fmt } from "./ui";
import { EventRow } from "./gaze/ChronicleCard";
import { Scramble, ShinigamiEye, Watcher } from "./Lore";

/* ================= Chronicle: the full timeline ================= */
const FILTERS: [string, (e: Ev) => boolean][] = [
  ["all", () => true],
  ["body", (e) => ["strength", "cardio", "sleep"].includes(e.table)],
  ["food", (e) => ["meals", "water"].includes(e.table)],
  ["focus", (e) => e.tag === "focus"],
  ["consume", (e) => ["read", "watch", "listen", "screen"].includes(e.tag)],
  ["state", (e) => e.table === "checkins"],
  ["notes", (e) => e.table === "notes"],
];
export function ChronicleView({ data }: { data: Data }) {
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const events = useMemo(() => allEvents(data), [data]);
  const shown = events.filter(FILTERS.find(([k]) => k === f)![1]).filter((e) => !q || `${e.title} ${e.detail ?? ""} ${e.tag}`.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, Ev[]>();
  for (const e of shown) { const k = dayKey(e.at); groups.set(k, [...(groups.get(k) ?? []), e]); }
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {FILTERS.map(([k]) => (
            <button key={k} onClick={() => setF(k)} className={`chip !py-1.5 !px-3 ${f === k ? "!border-apple/60 !text-ink" : ""}`}>{k}</button>
          ))}
        </div>
        <label className="relative sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
          <input className="field !pl-9" placeholder="Search the notebook" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="mt-8 space-y-10">
        {[...groups].map(([day, evs]) => (
          <section key={day}>
            <div className="sticky top-[118px] z-10 -mx-2 flex items-baseline justify-between bg-canvas/90 px-2 py-2 backdrop-blur md:top-[72px]">
              <h3 className="font-serif text-[26px] text-ink">{prettyDay(day)}</h3>
              <span className="font-mono text-[11px] text-slate">{evs.length} entries</span>
            </div>
            <Card className="mt-2 px-5"><ol className="divide-y divide-hairline">{[...evs].reverse().map((e, i) => <EventRow key={e.table + e.id} e={e} i={i} />)}</ol></Card>
          </section>
        ))}
        {!groups.size && <p className="py-20 text-center font-serif text-xl italic text-slate">No name matches. The notebook stays silent.</p>}
      </div>
    </div>
  );
}

/* ================= Vault: the raw tables, editable ================= */
const TABS: { table: keyof Data; label: string; cols: string[]; editable?: string[] }[] = [
  { table: "strength", label: "Lifts", cols: ["logged_at", "exercise", "muscle_group", "sets", "reps", "weight_kg", "set_detail", "volume_kg", "rpe", "detail"] },
  { table: "cardio", label: "Cardio", cols: ["logged_at", "activity", "workout_type", "duration_min", "distance_km", "avg_pace_sec_km", "cadence_spm", "avg_hr", "max_hr", "elevation_gain_m", "rpe", "splits", "detail"] },
  { table: "meals", label: "Meals", cols: ["logged_at", "meal_slot", "items", "source", "calories_est", "protein_g_est", "carbs_g_est", "fat_g_est", "detail"] },
  { table: "sleep", label: "Sleep", cols: ["logged_at", "duration_min", "bed_time", "wake_time", "quality", "awakenings", "is_nap", "detail"] },
  { table: "time_log", label: "Time", cols: ["logged_at", "kind", "topic", "duration_min", "pages", "title", "focus_quality", "output", "detail"] },
  { table: "health_log", label: "Health", cols: ["date", "steps", "exercise_minutes", "running_speed", "walk_run_distance", "heart_rate_avg", "sleep_minutes", "weight_kg", "active_cal", "stand_minutes", "running_power", "running_stride_length"], editable: [] },
  { table: "body", label: "Body", cols: ["logged_at", "weight_kg", "body_fat_pct", "waist_cm", "resting_hr", "detail"] },
  { table: "water", label: "Water", cols: ["logged_at", "ml"] },
  { table: "checkins", label: "Check-ins", cols: ["logged_at", "metric", "score"] },
  { table: "notes", label: "Notes", cols: ["logged_at", "note_kind", "text"] },
  { table: "finance_log", label: "Money", cols: ["date", "time", "type", "amount", "merchant", "channel", "account_last4", "balance", "date_in_sms"], editable: ["merchant", "type", "channel"] },
  { table: "pins", label: "Pins", cols: ["created_at", "kind", "title", "note", "image_url"] },
  { table: "messages", label: "Messages", cols: ["received_at", "text", "status", "model"], editable: ["status"] },
];
const NUMERIC = new Set(["amount", "confidence", "ignore", "sets", "reps", "weight_kg", "volume_kg", "rpe", "rest_sec", "duration_min",
  "distance_km", "avg_pace_sec_km", "avg_speed_kmh", "cadence_spm", "avg_hr", "max_hr", "elevation_gain_m", "calories", "steps",
  "calories_est", "protein_g_est", "carbs_g_est", "fat_g_est", "fiber_g_est", "ml", "quality", "awakenings", "is_nap", "pages",
  "focus_quality", "score", "body_fat_pct", "waist_cm", "resting_hr", "flights", "active_kcal", "resting_kcal",
  "balance", "exercise_minutes", "running_speed", "walk_run_distance", "heart_rate_avg", "sleep_minutes", "active_cal", "stand_minutes",
  "running_power", "running_stride_length"]);
// Pace is stored as seconds per km; shown and edited as m:ss.
const paceToSec = (v: string) => { const m = v.trim().match(/^(\d+):(\d{1,2})$/); return m ? String(+m[1] * 60 + +m[2]) : v; };
const fmtPace = (v: unknown) => (typeof v === "number" && v > 0 ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}` : v ?? "");
const LABEL: Record<string, string> = { avg_pace_sec_km: "pace /km", cadence_spm: "cadence", elevation_gain_m: "elev m",
  calories_est: "kcal est", protein_g_est: "protein g", carbs_g_est: "carbs g", fat_g_est: "fat g", fiber_g_est: "fiber g",
  focus_quality: "focus", volume_kg: "volume kg", set_detail: "sets detail", body_fat_pct: "body fat %",
  exercise_minutes: "exercise min", running_speed: "run speed", walk_run_distance: "walk/run km", heart_rate_avg: "avg hr",
  sleep_minutes: "sleep min", active_cal: "active kcal", stand_minutes: "stand min", running_power: "run power", running_stride_length: "stride m",
  account_last4: "a/c", date_in_sms: "sms date" };
const DATE_COLS = new Set(["logged_at", "created_at", "received_at"]);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function VaultView({ data, onEdit, onDelete }: {
  data: Data; onEdit: (table: string, id: number, field: string, value: string) => Promise<void>; onDelete: (table: string, id: number) => Promise<void>;
}) {
  const [tab, setTab] = useState(TABS[0]);
  const [q, setQ] = useState("");
  const [erasing, setErasing] = useState<number | null>(null);
  const erase = (id: number) => { setErasing(id); setTimeout(() => { onDelete(String(tab.table), id); setErasing(null); }, 700); };
  const rows = ((data[tab.table] as any[]) ?? []).filter((r) => !q || tab.cols.some((c) => String(r[c] ?? "").toLowerCase().includes(q.toLowerCase())));
  const review = data.messages.filter((m) => m.status === "needs_review").length;
  const editable = tab.editable ?? tab.cols.filter((c) => !DATE_COLS.has(c));
  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button key={t.label} onClick={() => setTab(t)} className={`chip !py-1.5 !px-3 ${tab.label === t.label ? "!border-apple/60 !text-ink" : ""}`}>
              {t.label} <span className="text-slate-dim">{((data[t.table] as any[]) ?? []).length}</span>
              {t.table === "messages" && review > 0 && <span className="ml-1 text-apple">· {review} review</span>}
            </button>
          ))}
        </div>
        <label className="relative lg:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
          <input className="field !pl-9" placeholder={`Filter ${tab.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <p className="mt-3 font-mono text-[10.5px] text-slate-dim">Click a cell to amend it · Enter saves · Esc cancels. Amended entries are marked; the original words stay in Messages.</p>
      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline">
              {tab.cols.map((c) => <th key={c} className="eyebrow !text-[9.5px] whitespace-nowrap px-4 py-3 font-normal">{LABEL[c] ?? c.replace(/_/g, " ")}</th>)}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.id} className={`group hover:bg-raised/60 ${erasing === r.id ? "erasing" : ""}`}>
                {tab.cols.map((c) => {
                  const canEdit = editable.includes(c);
                  const shown = DATE_COLS.has(c) ? fmtDate(r[c]) : c === "avg_pace_sec_km" ? fmtPace(r[c]) : r[c] ?? "";
                  const cls = `px-4 py-2.5 align-top ${NUMERIC.has(c) || DATE_COLS.has(c) ? "font-mono tabular-nums text-[12px]" : ""} ${c === "status" && r[c] === "needs_review" ? "text-apple" : ""} ${DATE_COLS.has(c) ? "text-slate whitespace-nowrap" : "text-ink"}`;
                  return canEdit
                    ? <EditableCell key={c} className={cls} value={String(shown)} onSave={(v) => onEdit(String(tab.table), r.id, c, c === "avg_pace_sec_km" ? paceToSec(v) : v)} />
                    : <td key={c} className={cls}>{String(shown)}</td>;
                })}
                <td className="px-2 py-2 text-right">
                  <button aria-label="Erase row" className="rounded-lg p-1.5 text-slate-dim opacity-60 transition hover:bg-apple/10 hover:text-apple group-hover:opacity-100"
                    onClick={() => confirm(tab.table === "messages" ? "Erase this message and every entry written from it?" : "Erase this entry from the notebook?") && erase(r.id)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={99} className="px-4 py-10 text-center text-slate">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function EditableCell({ value, onSave, className }: { value: string; onSave: (v: string) => Promise<void>; className: string }) {
  const ref = useRef<HTMLTableCellElement>(null);
  return (
    <td ref={ref} className={`${className} cursor-text rounded-md outline-none focus:bg-canvas focus:shadow-[inset_0_0_0_1px_rgba(200,75,49,.6)]`}
      contentEditable suppressContentEditableWarning
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); }
        if (e.key === "Escape") { (e.target as HTMLElement).textContent = value; (e.target as HTMLElement).blur(); }
      }}
      onBlur={async (e) => {
        const v = e.currentTarget.textContent?.trim() ?? "";
        if (v === value) return;
        try { await onSave(v); } catch { if (ref.current) ref.current.textContent = value; }
      }}>{value}</td>
  );
}

/* ================= Telemetry: the long view ================= */
export function TelemetryView({ data, days, setDays, onOpenEyes }: { data: Data; days: number; setDays: (n: number) => void; onOpenEyes: () => void }) {
  const span = Math.min(days, 90);
  const d = lastDays(span);
  const deepRows = data.time_log.filter((r) => r.kind === "deep_work");
  const topics = [...new Set(deepRows.map((r) => r.topic || "other"))];
  const hrs = (m: Map<string, number>) => seriesOf(new Map([...m].map(([k, v]) => [k, v / 60])), d);
  const sleep = hrs(byDay(data.sleep, (r) => r.duration_min));
  const protein = seriesOf(byDay(data.meals, (r) => r.protein_g_est), d);
  const ck = (m: string) => seriesOf(avgByDay(data.checkins.filter((r) => r.metric === m), (r) => r.score), d);
  const kinds = [["screen", ACCENT], ["read", SERIES[0]], ["watch", SERIES[1]], ["listen", SERIES[2]]] as const;
  const inRange = (iso: string) => d.includes(dayKey(iso));
  const totalDeep = deepRows.filter((r) => inRange(r.logged_at)).reduce((s, r) => s + (r.duration_min ?? 0), 0) / 60;
  const sleepVals = sleep.filter((v): v is number => v != null);
  const protVals = protein.filter((v): v is number => v != null);
  const cardioMin = data.cardio.filter((r) => inRange(r.logged_at)).reduce((s, r) => s + (r.duration_min ?? 0), 0);
  const volume = data.strength.filter((r) => inRange(r.logged_at)).reduce((s, r) => s + (r.sets ?? 1) * (r.reps ?? 0) * (r.weight_kg ?? 0), 0);
  const kpis = [
    ["Avg sleep", sleepVals.length ? (sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length).toFixed(1) : "—", "h / night"],
    ["Deep work", fmt(totalDeep), "h total"],
    ["Avg protein", protVals.length ? Math.round(protVals.reduce((a, b) => a + b, 0) / protVals.length).toString() : "—", "g / day est."],
    ["Cardio", Math.round(cardioMin).toString(), "min total"],
    ["Volume", Math.round(volume).toLocaleString(), "kg lifted"],
  ];
  const eyes = false;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-serif text-[20px] italic text-slate">The last {span} days, as the shinigami sees them.</p>
        <div className="flex gap-1">
          <button onClick={onOpenEyes} className="group chip !py-1.5 !px-3 inline-flex items-center gap-2 !border-apple/60 !text-apple hover:!bg-apple/10">
            <ShinigamiEye size={11} />Open the eyes
          </button>
          {[7, 30, 90].map((n) => <button key={n} onClick={() => setDays(n)} className={`chip !py-1.5 !px-3 ${span === n ? "!border-apple/60 !text-ink" : ""}`}>{n}d</button>)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map(([l, v, u]) => (
          <Card key={l} className="p-5"><div className="eyebrow">{l}</div>
            <div className="eyes-num mt-3 font-serif text-[40px] leading-none text-ink transition-colors duration-700"><Scramble key={`${v}-${eyes}`} value={String(v)} /></div>
            <div className="mt-1 font-mono text-[10.5px] text-slate">{u}</div></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-6"><CardHead eyebrow="Hours per night · line at 7 h" title="Sleep" />
          <div className="mt-4"><StackedBars days={d} unit="h" target={7} series={[{ name: "sleep", values: sleep, color: SERIES[0] }]} /></div></Card>
        <Card className="p-6"><CardHead eyebrow="Hours per day, by topic" title="Deep work" />
          <div className="mt-4"><StackedBars days={d} unit="h" series={topics.map((t, i) => ({ name: t, color: t === "work" ? ACCENT : SERIES[[0, 1, 2, 4, 5, 6][i % 6]],
            values: hrs(byDay(deepRows.filter((r) => (r.topic || "other") === t), (r) => r.duration_min)) }))} /></div>
          <div className="mt-3"><Legend items={topics.map((t, i) => ({ name: t, color: t === "work" ? ACCENT : SERIES[[0, 1, 2, 4, 5, 6][i % 6]] }))} /></div></Card>
        <Card className="p-6"><CardHead eyebrow="Daily average, 1 to 5" title="Energy, focus, mood" />
          <div className="mt-4"><Lines days={d} unit="score" min={1} max={5} series={[{ name: "energy", values: ck("energy"), color: ACCENT }, { name: "focus", values: ck("focus"), color: SERIES[0] }, { name: "mood", values: ck("mood"), color: SERIES[2] }]} /></div>
          <div className="mt-3"><Legend items={[{ name: "energy", color: ACCENT }, { name: "focus", color: SERIES[0] }, { name: "mood", color: SERIES[2] }]} /></div></Card>
        <Card className="p-6"><CardHead eyebrow="Estimated grams per day · line at 80 g" title="Protein" />
          <div className="mt-4"><StackedBars days={d} unit="g" target={80} series={[{ name: "protein", values: protein, color: SERIES[1] }]} /></div></Card>
        <Card className="p-6"><CardHead eyebrow="Cardio minutes per day" title="Movement" />
          <div className="mt-4"><StackedBars days={d} unit="min" target={30} series={[{ name: "cardio", values: seriesOf(byDay(data.cardio, (r) => r.duration_min), d), color: SERIES[0] }]} /></div></Card>
        <Card className="p-6"><CardHead eyebrow="Minutes per day · passive screen in red" title="Consumption" />
          <div className="mt-4"><StackedBars days={d} unit="min" series={kinds.map(([k, c]) => ({ name: k, color: c, values: seriesOf(byDay(data.time_log.filter((r) => r.kind === k), (r) => r.duration_min), d) }))} /></div>
          <div className="mt-3"><Legend items={kinds.map(([k, c]) => ({ name: k, color: c }))} /></div></Card>
      </div>
    </div>
  );
}

/* ================= Quick capture (⌘K) ================= */
export function CaptureModal({ open, onClose, onSubmit, onInscribed }: { open: boolean; onClose: () => void; onSubmit: (t: string) => Promise<string>; onInscribed?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) { setReply(null); setTimeout(() => ref.current?.focus(), 30); } }, [open]);
  if (!open) return null;
  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { const r = await onSubmit(text.trim()); setReply(r); setText(""); if (!r.startsWith("⚠")) onInscribed?.(); } catch (e) { setReply("⚠ " + (e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="relative w-full max-w-xl rounded-[20px] border border-hairline bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Write in the notebook">
        <Watcher size={64} className="pointer-events-none absolute -top-[74px] right-6" />
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <span className="eyebrow">Write in the notebook</span>
          <span className="font-mono text-[10px] text-slate-dim">{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })} · esc to close</span>
        </div>
        <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={4}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } if (e.key === "Escape") onClose(); }}
          placeholder="ran 5km in 30 min, lunch dal chawal 2 roti, energy 4…"
          className="ruled block w-full resize-none bg-transparent py-1 pl-[68px] pr-5 font-serif text-[22px] italic text-ink caret-apple outline-none placeholder:not-italic placeholder:text-slate-dim" />
        <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
          <span className="font-mono text-[10.5px] text-slate">Rule X: several deeds per line are each recorded</span>
          <button onClick={go} disabled={busy || !text.trim()} className="btn !border-apple/50 disabled:opacity-40">
            {busy ? "Inscribing…" : <>Inscribe <CornerDownLeft size={13} /></>}
          </button>
        </div>
        {reply && (
          <ul className="rounded-b-[20px] border-t border-hairline bg-canvas px-5 py-4 font-mono text-[12px] leading-relaxed text-ink">
            {reply.split("\n").map((l, i) => (
              <li key={i} className="ink-in" style={{ animationDelay: `${i * 220}ms` }}>
                <span className={l.startsWith("✓") ? "inked" : ""} style={{ animationDelay: `${i * 220 + 200}ms` }}>{l}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
