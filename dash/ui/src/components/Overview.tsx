import { useMemo, useState } from "react";
import { Activity, BedDouble, BookOpen, Brain, Check, Flame, ImagePlus, Plus, Sparkles, Target, Trash2, X, Zap } from "lucide-react";
import { Data, Ev, MoodItem, allEvents, dayKey, habits, heatmap, hhmm, moodboard, observations, prettyDay, shortDay, todayKey, vitals } from "../data";
import { ACCENT, Card, CardHead, LiveDot, Ring, Sparkline } from "./ui";
import { Watcher } from "./Lore";

export function Overview({ data, onAddPin, onDeletePin, demo }: { data: Data; onAddPin: (p: { kind: string; title: string; note?: string; image_url?: string }) => Promise<void>; onDeletePin: (id: number) => Promise<void>; demo: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
      <ChronicleCard data={data} />
      <TelemetryCard data={data} />
      <MoodboardCard data={data} onAddPin={onAddPin} onDeletePin={onDeletePin} demo={demo} />
      <HabitCard data={data} />
      <ObservationsCard data={data} />
    </div>
  );
}

/* ---------- 1. The Observer's Chronicle ---------- */
export const TAG_ICON: Record<string, JSX.Element> = {
  lift: <Flame size={12} />, move: <Activity size={12} />, sleep: <BedDouble size={12} />, focus: <Brain size={12} />,
  read: <BookOpen size={12} />, energy: <Zap size={12} />, idea: <Sparkles size={12} />,
};

export function EventRow({ e, showDate = false, i = 0 }: { e: Ev; showDate?: boolean; i?: number }) {
  return (
    <li className="entry-in group relative grid grid-cols-[64px_1fr] gap-3 py-3" style={{ animationDelay: `${Math.min(i, 14) * 60}ms` }}>
      <span className="font-mono text-[11px] tabular-nums text-slate pt-[2px]">
        [{hhmm(e.at)}]{showDate && <span className="block text-slate-dim">{shortDay(dayKey(e.at))}</span>}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`chip inline-flex items-center gap-1 ${e.tag === "idea" ? "border-apple/40 text-apple" : ""}`}>{TAG_ICON[e.tag]}{e.tag.replace("_", " ")}</span>
        </div>
        <p className="mt-1.5 text-[14px] leading-snug text-ink">{e.title}</p>
        {e.detail && e.detail !== e.title && <p className="mt-0.5 text-[12.5px] leading-snug text-slate line-clamp-2">{e.detail}</p>}
      </div>
    </li>
  );
}

function ChronicleCard({ data }: { data: Data }) {
  const events = useMemo(() => allEvents(data), [data]);
  const today = todayKey();
  const todays = events.filter((e) => dayKey(e.at) === today);
  const shownDay = todays.length ? today : events[0] ? dayKey(events[0].at) : today;
  const list = events.filter((e) => dayKey(e.at) === shownDay);
  return (
    <Card className="flex flex-col p-6 md:col-span-6 lg:col-span-4 lg:h-[660px]">
      <CardHead eyebrow={todays.length ? "Written today" : "Last written page"} title="Today's Entries"
        right={<span className="font-mono text-[11px] text-slate tabular-nums">{list.length} entries</span>} />
      <p className="mt-3 font-serif text-[17px] italic text-slate">{prettyDay(shownDay)}</p>
      <ol className="relative mt-3 -mr-3 flex-1 divide-y divide-hairline overflow-y-auto pr-3">
        {list.length ? [...list].reverse().map((e, i) => <EventRow key={e.table + e.id} e={e} i={i} />)
          : <li className="py-10 text-center text-sm text-slate">The page is blank. Ryuk grows bored. Write something.</li>}
      </ol>
    </Card>
  );
}

/* ---------- 2. Vital Telemetry ---------- */
function TelemetryCard({ data }: { data: Data }) {
  const v = useMemo(() => vitals(data, 14), [data]);
  const rows = [
    { label: "Sleep", icon: <BedDouble size={14} />, now: v.today.sleepH, unit: "h", target: 8, series: v.sleepH, accent: false, fmt: (x: number) => x.toFixed(1) },
    { label: "Deep work", icon: <Brain size={14} />, now: v.today.deepH, unit: "h", target: 4, series: v.deepH, accent: true, fmt: (x: number) => x.toFixed(1) },
    { label: "Energy", icon: <Zap size={14} />, now: v.today.energy, unit: "/5", target: 5, series: v.energy, accent: false, fmt: (x: number) => x.toFixed(1) },
    { label: "Movement", icon: <Activity size={14} />, now: v.today.moveMin, unit: "min", target: 45, series: v.moveMin, accent: false, fmt: (x: number) => Math.round(x).toString() },
  ];
  return (
    <Card className="flex flex-col p-6 md:col-span-6 lg:col-span-4 lg:h-[660px]">
      <CardHead eyebrow="Today against target · last 14 days" title="Vital Readings" />
      <div className="mt-6 grid grid-cols-4 gap-2">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col items-center gap-2">
            <Ring value={r.now} max={r.target} size={62} label={`${r.label} ${r.now ?? "not logged"} of ${r.target}${r.unit}`} />
            <span className="eyebrow !text-[9.5px] !tracking-[0.12em]">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex-1 divide-y divide-hairline border-t border-hairline">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-4">
            <div className="flex items-center gap-2 text-[13px] text-slate">{r.icon}{r.label}</div>
            <div className="font-mono text-[13px] tabular-nums text-ink">
              {r.now == null ? "—" : r.fmt(r.now)}<span className="text-slate"> {r.unit}</span>
              {r.label === "Movement" && v.today.sets > 0 && <span className="text-slate" title="lifting counted at ~3 min per set"> · incl. {v.today.sets} sets</span>}
            </div>
            <div className="col-span-2 mt-2"><Sparkline values={r.series} accent={r.accent} h={36} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- 3. Curated Moodboard & Vision ---------- */
const TONES = [["#1E1A1A", "#3A2622"], ["#16181D", "#262B35"], ["#1A1A17", "#2F2D25"], ["#181519", "#2C2430"], ["#141A18", "#22302B"]];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function MoodTile({ item, onDelete }: { item: MoodItem; onDelete?: (id: number) => void }) {
  if (item.type === "book") {
    const [a, b] = TONES[hash(item.title) % TONES.length];
    const tall = hash(item.title) % 2 === 0;
    return (
      <figure className="group mb-3 break-inside-avoid overflow-hidden rounded-2xl border border-hairline">
        <div className={`relative flex flex-col justify-between p-4 transition-transform duration-700 group-hover:scale-[1.04] ${tall ? "aspect-[3/4.4]" : "aspect-[3/3.6]"}`}
          style={{ background: `linear-gradient(160deg, ${a}, ${b})` }}>
          <span className="eyebrow !text-[9px]">{item.kind === "read" ? "Reading" : item.kind === "watch" ? "Watching" : "Listening"}</span>
          <div>
            <div className="mb-3 h-px w-8 bg-apple/70" />
            <p className="font-serif text-[21px] leading-[1.05] text-ink">{item.title}</p>
          </div>
        </div>
        <figcaption className="flex justify-between bg-surface px-3 py-2 font-mono text-[10px] text-slate">
          <span>{item.pages ? `${item.pages} pp` : `${Math.round(item.minutes)} min`}</span><span>{shortDay(dayKey(item.last))}</span>
        </figcaption>
      </figure>
    );
  }
  const p = item.pin;
  const delBtn = onDelete && (
    <button aria-label="Remove pin" onClick={() => confirm("Remove this pin?") && onDelete(p.id)}
      className="absolute right-2 top-2 rounded-lg bg-canvas/80 p-1.5 text-slate-dim opacity-0 transition hover:bg-apple/10 hover:text-apple group-hover:opacity-100">
      <Trash2 size={13} />
    </button>
  );
  if (p.image_url) {
    return (
      <figure className="group relative mb-3 break-inside-avoid overflow-hidden rounded-2xl border border-hairline bg-raised">
        {delBtn}
        <div className="overflow-hidden"><img src={p.image_url} alt={p.title} loading="lazy" referrerPolicy="no-referrer"
          className="w-full object-cover grayscale-[15%] transition-transform duration-700 group-hover:scale-[1.06]" /></div>
        <figcaption className="px-3 py-2.5"><span className="eyebrow !text-[9px]">{p.kind}</span><p className="mt-1 text-[13px] text-ink">{p.title}</p></figcaption>
      </figure>
    );
  }
  return (
    <figure className={`group relative mb-3 break-inside-avoid rounded-2xl border p-4 ${p.kind === "goal" ? "border-apple/30 bg-apple/[0.06]" : "border-hairline bg-raised"}`}>
      {delBtn}
      <span className={`eyebrow !text-[9px] inline-flex items-center gap-1 ${p.kind === "goal" ? "!text-apple" : ""}`}>{p.kind === "goal" && <Target size={10} />}{p.kind}</span>
      <p className={`mt-2 font-serif leading-[1.1] text-ink ${p.kind === "inspiration" ? "text-[22px] italic" : "text-[19px]"}`}>{p.title}</p>
      {p.note && <p className="mt-2 text-[12px] leading-snug text-slate">{p.note}</p>}
    </figure>
  );
}

function MoodboardCard({ data, onAddPin, onDeletePin, demo }: { data: Data; onAddPin: (p: any) => Promise<void>; onDeletePin: (id: number) => Promise<void>; demo: boolean }) {
  const items = useMemo(() => moodboard(data), [data]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "goal", title: "", note: "", image_url: "" });
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!form.title.trim()) return setErr("Give it a title.");
    try { await onAddPin(form); setForm({ kind: "goal", title: "", note: "", image_url: "" }); setOpen(false); setErr(""); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Card className="flex flex-col p-6 md:col-span-12 lg:col-span-4 lg:h-[660px]">
      <CardHead eyebrow="Pinned intentions · current reading" title="Apples & Omens"
        right={<button className="btn !px-2.5 !py-1.5" onClick={() => setOpen((o) => !o)} aria-label="Add a pin">{open ? <X size={14} /> : <Plus size={14} />}</button>} />
      {open && (
        <div className="mt-4 space-y-2 rounded-2xl border border-hairline bg-canvas p-3">
          <div className="flex gap-1.5">
            {["goal", "inspiration", "media"].map((k) => (
              <button key={k} onClick={() => setForm({ ...form, kind: k })}
                className={`chip ${form.kind === k ? "!border-apple/60 !text-ink" : ""}`}>{k}</button>
            ))}
          </div>
          <input className="field" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="field" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="flex gap-2">
            <input className="field" placeholder="https://image link (optional)" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
            <button className="btn shrink-0 !border-apple/50" onClick={submit}><ImagePlus size={14} />Pin</button>
          </div>
          {err && <p className="text-[12px] text-apple">{err}</p>}
          {demo && <p className="text-[11px] text-slate-dim">Demo mode: pins are not saved.</p>}
        </div>
      )}
      <div className="mt-5 -mr-3 flex-1 overflow-y-auto pr-3">
        {items.length ? <div className="columns-2 gap-3">{items.map((it, i) => <MoodTile key={i} item={it} onDelete={it.type === "pin" ? onDeletePin : undefined} />)}</div>
          : <p className="py-10 text-center text-sm text-slate">No omens yet. Pin a goal or an image, or write a book (“read DDIA 20 pages”) and it appears here.</p>}
      </div>
    </Card>
  );
}

/* ---------- 4. Discipline & Habit Matrix ---------- */
const HEAT = ["#17171C", "#26262E", "#3B3B46", "#6B6B78", ACCENT];
function HabitCard({ data }: { data: Data }) {
  const hm = useMemo(() => heatmap(data), [data]);
  const hb = useMemo(() => habits(data), [data]);
  const level = hm.level;
  const cell = 11, gap = 3;
  const months: { x: number; label: string }[] = [];
  hm.weeks.forEach((w, i) => {
    const first = w.find(Boolean);
    if (first && first.d.slice(8) <= "07") months.push({ x: i * (cell + gap), label: new Date(first.d + "T12:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) });
  });
  return (
    <Card className="p-6 md:col-span-12 lg:col-span-7">
      <CardHead eyebrow={`${hm.activeDays} days written · ${hm.total.toLocaleString()} entries this year`} title="Pages Written & Pacts" />
      <div className="mt-5 overflow-x-auto pb-1">
        <svg width={hm.weeks.length * (cell + gap)} height={7 * (cell + gap) + 16} role="img" aria-label="Entries logged per day over the last year">
          {months.map((m, i) => <text key={i} x={m.x} y={9} fontSize="9.5" fill="#8E8E9A" className="font-mono">{m.label}</text>)}
          {hm.weeks.map((w, x) => w.map((c, y) => c && (
            <rect key={c.d} x={x * (cell + gap)} y={16 + y * (cell + gap)} width={cell} height={cell} rx="2.5" fill={HEAT[level(c.n)]}>
              <title>{`${shortDay(c.d)}: ${c.n} entries`}</title>
            </rect>)))}
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 font-mono text-[10px] text-slate">
        less {HEAT.map((c) => <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />)} more
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {hb.map((h) => (
          <div key={h.key} title={h.rule}
            className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 transition-colors ${h.doneToday ? "border-apple/40 bg-apple/[0.07]" : "border-hairline"}`}>
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink">{h.label}</p>
              <p className="font-mono text-[10px] text-slate">{h.streak} {h.streak === 1 ? "day" : "days"} kept</p>
            </div>
            <span role="switch" aria-checked={h.doneToday} aria-label={`${h.label} done today`}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${h.doneToday ? "bg-apple" : "bg-hairline"}`}>
              <span className={`absolute top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-canvas transition-all ${h.doneToday ? "left-[18px]" : "left-0.5"}`}>
                {h.doneToday && <Check size={10} strokeWidth={3} />}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-slate-dim">Pacts switch on by themselves from what you write. Hover one for its terms.</p>
    </Card>
  );
}

/* ---------- 5. Ryuk's Observations ---------- */
function ObservationsCard({ data }: { data: Data }) {
  const obs = useMemo(() => observations(data), [data]);
  return (
    <Card className="relative overflow-hidden p-6 md:col-span-12 lg:col-span-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-apple/[0.07] blur-3xl" />
      <Watcher size={104} className="pointer-events-none absolute -bottom-4 right-2" />
      <CardHead eyebrow="The shinigami's notes · counted from your entries" title="Ryuk's Observations" right={<LiveDot className="mt-1" />} />
      <ul className="mt-5 space-y-4 pr-0 sm:pr-24">
        {obs.length ? obs.slice(0, 4).map((o, i) => (
          <li key={i} className="entry-in grid grid-cols-[1fr_auto] items-baseline gap-4 border-t border-hairline pt-4 first:border-0 first:pt-0" style={{ animationDelay: `${300 + i * 180}ms` }}>
            <p className="font-serif text-[18px] leading-[1.35] text-ink/90">{o.text}</p>
            {o.metric && <span className="font-mono text-[12px] tabular-nums text-apple">{o.metric}</span>}
          </li>
        )) : <li className="font-serif text-[18px] italic text-slate">Too little has been written for the shinigami to say anything. A week of entries is enough.</li>}
      </ul>
    </Card>
  );
}
