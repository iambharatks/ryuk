import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Feather, PenLine, Square, Trash2, X } from "lucide-react";
import type { Entry, PageData, Store, Task } from "../store";
import { istDay } from "../store";
import { MiniApple, RULES, Watcher } from "./Lore";

/**
 * The daily page. One page per day. Lines you write are stamped with the time you START writing them,
 * appear in pencil, and turn to ink when written into the notebook (pushed to the database).
 * Intentions (tasks) sit at the top and are struck through when kept, which logs them at that moment.
 * Tap any line to correct its words or time; erasing removes it and everything parsed from it.
 */
type Draft = { id: string; text: string; at: number };
type Editing = { kind: "entry" | "draft" | "task"; id: string | number; text: string; time: string; dayOfAt: string } | null;

const TZ = "Asia/Kolkata";
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const atOn = (day: string, time: string) => Date.parse(`${day}T${time}:00+05:30`);
const shiftDay = (day: string, n: number) => istDay(Date.parse(`${day}T12:00:00+05:30`) + n * 86400e3);
const dayOfYear = (day: string) => Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${day.slice(0, 4)}-01-01T00:00:00Z`)) / 86400e3) + 1;
const longDate = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const uid = () => Math.random().toString(36).slice(2, 10);
const DKEY = "ryuk.page.drafts.v1";
const loadDrafts = (): Draft[] => { try { const v = JSON.parse(localStorage.getItem(DKEY) || "[]"); return Array.isArray(v) ? v.filter((d) => d && d.text && Number.isFinite(d.at)) : []; } catch { return []; } };
const saveDrafts = (d: Draft[]) => { try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch { /* memory only */ } };
const pref = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } };
const setPref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* */ } };
const durFor = (text: string) => `${Math.min(1700, 260 + text.length * 32)}ms`;
const TABLE_LABEL: Record<string, string> = { strength: "lift", cardio: "move", meals: "meal", water: "water", sleep: "sleep", time_log: "time", checkins: "state", body: "body", notes: "note" };

function Nib() {
  return (
    <svg viewBox="0 0 14 30" className="h-full w-full" aria-hidden>
      <path d="M7 30 L2.5 14 Q7 2 11.5 14 Z" fill="#1b1712" />
      <path d="M7 29 L7 16" stroke="#e9e1cd" strokeWidth=".8" />
      <circle cx="7" cy="15.5" r="1.4" fill="#e9e1cd" />
    </svg>
  );
}

function Strike() {
  return (
    <svg className="dn-strike pointer-events-none absolute inset-x-3 bottom-[14px] h-[14px] w-[calc(100%-24px)]" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden>
      <path pathLength={1} d="M1 9 C 18 5, 30 11, 48 7 S 80 4, 99 8" fill="none" stroke="#7d1a12" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function HandBox({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 22 22" className="h-[19px] w-[19px]" aria-hidden>
      <path d="M3 4 Q11 2.5 19 3.5 Q19.8 11 18.6 19 Q10 19.8 3.4 18.6 Q2.4 11 3 4Z" fill="none" stroke="#2a241c" strokeWidth="1.5" strokeLinejoin="round" />
      {done && <path className="dn-write" style={{ ["--dur" as any]: "380ms" }} d="M5 11 L9.5 15.5 L18 4" fill="none" stroke="#7d1a12" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function DeathPage({ store, onChanged, onApple }: { store: Store; onChanged?: () => void; onApple?: () => void }) {
  const today = istDay();
  const [day, setDay] = useState(today);
  const [flip, setFlip] = useState<"" | "next" | "prev">("");
  const [page, setPage] = useState<PageData | null>(null);
  const [err, setErr] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(loadDrafts);
  const [text, setText] = useState("");
  const [startAt, setStartAt] = useState<number | null>(null);
  const [taskMode, setTaskMode] = useState(false);
  const [autoInk, setAutoInk] = useState(() => pref("ryuk.page.autoink", false));
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());          // ids to animate as being written
  const [inking, setInking] = useState<Set<string>>(new Set());        // drafts turning into ink
  const [erasing, setErasing] = useState<Set<string>>(new Set());
  const [struck, setStruck] = useState<Set<number>>(new Set());         // tasks just kept (animate the line)
  const [editing, setEditing] = useState<Editing>(null);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => saveDrafts(drafts), [drafts]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(t); }, []);

  const load = useCallback(async (d: string) => {
    setErr("");
    try { setPage(await store.page(d)); } catch (e) { setErr((e as Error).message); setPage({ day: d, entries: [], tasks: [] }); }
  }, [store]);
  useEffect(() => { setPage(null); load(day); }, [day, load]);

  const go = (n: number) => {
    const next = shiftDay(day, n);
    if (next > today) return;
    setEditing(null); setReply(null);
    setFlip(n > 0 ? "next" : "prev");
    setDay(next);
  };

  // lines on this page: ink (database) + pencil (drafts on this device), in time order
  const lines = useMemo(() => {
    const ink = (page?.entries ?? []).map((e) => ({ key: `e${e.id}`, at: Date.parse(e.received_at), text: e.text, entry: e as Entry | undefined, draft: undefined as Draft | undefined }));
    const pencil = drafts.filter((d) => istDay(d.at) === day).map((d) => ({ key: `d${d.id}`, at: d.at, text: d.text, entry: undefined, draft: d }));
    return [...ink, ...pencil].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  }, [page, drafts, day]);
  const tasks = page?.tasks ?? [];
  const pencilCount = drafts.filter((d) => istDay(d.at) === day).length;
  const inkCount = page?.entries.length ?? 0;
  const kept = tasks.filter((t) => t.done_at).length;

  // ---------- writing ----------
  const writeInk = async (only?: Draft[]) => {
    const batch = only ?? drafts.filter((d) => istDay(d.at) === day);
    if (!batch.length || busy) return;
    setBusy(true); setReply(null);
    setInking(new Set(batch.map((d) => `d${d.id}`)));
    try {
      const [r] = await Promise.all([
        store.writeLines(batch.map((d) => ({ text: d.text, at: new Date(d.at).toISOString() }))),
        new Promise((res) => setTimeout(res, 950)),                         // let the ink finish sweeping
      ]);
      setReply(r);
      const ids = new Set(batch.map((d) => d.id));
      setDrafts((ds) => ds.filter((d) => !ids.has(d.id)));
      await load(day);
      onChanged?.();
      if (inkCount + batch.length >= 8 && inkCount < 8) onApple?.();
    } catch (e) {
      setReply(`⚠ Not written: ${(e as Error).message}. Your lines stay in pencil; try again.`);
    }
    setInking(new Set()); setBusy(false);
  };

  const submit = async () => {
    const raw = text.trim();
    if (!raw) return;
    const isTask = taskMode || /^(\[\s?\]|☐|todo:?)\s+/i.test(raw);
    const clean = raw.replace(/^(\[\s?\]|☐|todo:?)\s+/i, "");
    const at = startAt ?? Date.now();
    setText(""); setStartAt(null);
    if (isTask) {
      try {
        const t = await store.addTask(day, clean);
        setPage((p) => p && { ...p, tasks: [...p.tasks, t] });
        setFresh((f) => new Set(f).add(`t${t.id}`));
      } catch (e) { setReply("⚠ " + (e as Error).message); }
      return;
    }
    // a line written while looking at an older page belongs to that day, at the time it was begun
    const stamp = day === today ? at : atOn(day, hhmm(at));
    const d: Draft = { id: uid(), text: clean, at: stamp };
    setDrafts((ds) => [...ds, d]);
    setFresh((f) => new Set(f).add(`d${d.id}`));
    if (autoInk) setTimeout(() => writeInk([d]), Math.min(1700, 260 + clean.length * 32) + 150);
  };

  // ---------- tasks ----------
  const toggleTask = async (t: Task) => {
    const done = !t.done_at;
    if (done) setStruck((s) => new Set(s).add(t.id));
    try {
      const r = await store.editTask(t.id, { done, at: done ? new Date(day === today ? Date.now() : atOn(day, hhmm(Date.now()))).toISOString() : undefined });
      setPage((p) => p && { ...p, tasks: p.tasks.map((x) => (x.id === t.id ? r.task : x)) });
      if (r.reply) setReply(r.reply);
      onChanged?.();
      if (done) load(day);
    } catch (e) { setReply("⚠ " + (e as Error).message); setStruck((s) => { const n = new Set(s); n.delete(t.id); return n; }); }
  };

  // ---------- editing ----------
  const openEdit = (kind: "entry" | "draft" | "task", id: string | number, txt: string, at: number | null) =>
    setEditing({ kind, id, text: txt, time: at != null ? hhmm(at) : "", dayOfAt: at != null ? istDay(at) : day });

  const saveEdit = async () => {
    if (!editing) return;
    const e = editing;
    const t = e.time.replace(/^(\d{1,2})(\d{2})$/, "$1:$2").padStart(5, "0");
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    const txt = e.text.trim();
    if (!txt) return setReply("⚠ A line needs words. Use the bin to erase it.");
    if (e.time && !validTime) return setReply("⚠ Time must look like 18:05.");
    setEditing(null);
    try {
      if (e.kind === "draft") {
        setDrafts((ds) => ds.map((d) => (d.id === e.id ? { ...d, text: txt, at: validTime ? atOn(e.dayOfAt, t) : d.at } : d)));
      } else if (e.kind === "entry") {
        const at = new Date(atOn(e.dayOfAt, validTime ? t : "00:00")).toISOString();
        setFresh((f) => new Set(f).add(`e${e.id}`));
        setReply(await store.editEntry(Number(e.id), txt, at));
        await load(day); onChanged?.();
      } else {
        const task = tasks.find((x) => x.id === e.id);
        const patch: { text?: string; at?: string } = { text: txt };
        if (task?.done_at && validTime) patch.at = new Date(atOn(e.dayOfAt, t)).toISOString();
        const r = await store.editTask(Number(e.id), patch);
        setPage((p) => p && { ...p, tasks: p.tasks.map((x) => (x.id === r.task.id ? r.task : x)) });
        if (r.reply) setReply(r.reply);
      }
    } catch (er) { setReply("⚠ " + (er as Error).message); }
  };

  const erase = async () => {
    if (!editing) return;
    const e = editing;
    const key = e.kind === "entry" ? `e${e.id}` : e.kind === "draft" ? `d${e.id}` : `t${e.id}`;
    setEditing(null);
    setErasing((s) => new Set(s).add(key));
    await new Promise((r) => setTimeout(r, 650));
    try {
      if (e.kind === "draft") setDrafts((ds) => ds.filter((d) => d.id !== e.id));
      else if (e.kind === "entry") { await store.eraseEntry(Number(e.id)); await load(day); onChanged?.(); }
      else { await store.deleteTask(Number(e.id)); setPage((p) => p && { ...p, tasks: p.tasks.filter((x) => x.id !== e.id) }); onChanged?.(); }
    } catch (er) { setReply("⚠ " + (er as Error).message); }
    setErasing((s) => { const n = new Set(s); n.delete(key); return n; });
  };

  // ---------- keyboard + swipe ----------
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); writeInk(); }
      const typing = /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName);
      if (!typing && e.key === "ArrowLeft") go(-1);
      if (!typing && e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  const onTouchStart = (e: React.TouchEvent) => { if (!/INPUT/.test((e.target as HTMLElement).tagName)) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current; touch.current = null; if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  };

  const rule = RULES[dayOfYear(day) % RULES.length];
  const isToday = day === today;

  const editorRow = (key: string) => editing && (
    <div key={key} className="dn-row !h-auto min-h-[var(--lh)] !grid-cols-[var(--margin)_minmax(0,1fr)] !items-center bg-[rgba(255,250,235,.55)] py-1.5">
      <input aria-label="Time (HH:MM)" value={editing.time} inputMode="numeric" maxLength={5} placeholder="--:--"
        onChange={(e) => setEditing({ ...editing, time: e.target.value.replace(/[^\d:]/g, "") })}
        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }}
        className="dn-input ml-auto mr-2 w-[52px] rounded border border-[rgba(120,30,22,.35)] px-1 text-center font-mono text-[12px] text-[#7a1d14]" />
      <div className="flex flex-wrap items-center gap-2 pl-3">
        <input autoFocus aria-label="Edit line" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }}
          className="dn-input dn-hand !filter-none !p-0 min-w-0 flex-1 border-b border-dashed border-[rgba(40,30,20,.35)]" />
        <div className="flex items-center gap-1">
          <button onClick={saveEdit} className="flex h-8 items-center gap-1 rounded-md bg-[#15120e] px-2.5 text-[12px] text-[#ece5d3]"><Check size={13} />Save</button>
          <button onClick={erase} aria-label="Erase line" className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(120,30,22,.4)] text-[#7a1d14]"><Trash2 size={14} /></button>
          <button onClick={() => setEditing(null)} aria-label="Cancel" className="flex h-8 w-8 items-center justify-center rounded-md text-[#3a3128]"><X size={14} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="dn-desk mx-auto max-w-[860px]">
      {/* ink roughening for the handwriting */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id="dn-ink"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3" /><feDisplacementMap in="SourceGraphic" scale="1.3" /></filter>
      </svg>

      {/* day controls */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button className="btn !px-2.5" onClick={() => go(-1)} aria-label="Previous day"><ChevronLeft size={16} /></button>
          <button className="btn !px-2.5 disabled:opacity-30" onClick={() => go(1)} disabled={isToday} aria-label="Next day"><ChevronRight size={16} /></button>
          {!isToday && <button className="btn" onClick={() => { setFlip("next"); setDay(today); }}>Today</button>}
          <input type="date" aria-label="Go to day" value={day} max={today} onChange={(e) => e.target.value && e.target.value <= today && (setFlip(e.target.value > day ? "next" : "prev"), setDay(e.target.value))}
            className="hidden rounded-xl border border-hairline bg-surface px-2 py-1.5 font-mono text-[12px] text-slate [color-scheme:dark] sm:block" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-slate" title="When on, each line turns to ink (is saved) as soon as you finish it">
          <input type="checkbox" checked={autoInk} onChange={(e) => { setAutoInk(e.target.checked); setPref("ryuk.page.autoink", e.target.checked); }} className="accent-[#C84B31]" />
          Ink as I write
        </label>
      </div>

      <div key={day} className={`dn-book ${flip ? `dn-flip-${flip}` : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="dn-stack two" /><div className="dn-stack" />
        <article className="dn-paper" aria-label={`Page for ${longDate(day)}`}>
          <div className="dn-holes" /><div className="dn-margin" />
          <Watcher size={54} className="pointer-events-none absolute -right-1 -top-1 opacity-90 [filter:drop-shadow(0_4px_6px_rgba(0,0,0,.35))]" />

          <header className="dn-head">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[.24em] text-[rgba(60,50,40,.6)]">{isToday ? "Today's page" : day}</div>
              <div className="dn-hand !p-0 !text-[30px] text-[#15120e] max-sm:!text-[24px]">{longDate(day)}</div>
            </div>
            <div className="mr-12 text-right">
              <div className="font-frak text-[26px] leading-none text-[#15120e]">Page {String(dayOfYear(day)).padStart(3, "0")}</div>
              <div className="mt-1 flex items-center justify-end gap-1 font-mono text-[10px] text-[rgba(60,50,40,.65)]">
                {inkCount} in ink{pencilCount ? ` · ${pencilCount} in pencil` : ""}{inkCount >= 8 && <MiniApple size={9} />}
              </div>
            </div>
          </header>

          {/* intentions */}
          <div className="dn-label">Intentions {tasks.length ? `· ${kept} of ${tasks.length} kept` : "· write [] before a line"}</div>
          {tasks.map((t) => editing?.kind === "task" && editing.id === t.id ? editorRow(`t${t.id}`) : (
            <div key={`t${t.id}`} className={`dn-row group ${erasing.has(`t${t.id}`) ? "dn-erase" : ""}`}>
              <div className="dn-time">{t.done_at ? hhmm(Date.parse(t.done_at)) : ""}</div>
              <div className="relative flex min-w-0 items-end">
                <button onClick={() => toggleTask(t)} aria-label={t.done_at ? "Mark not done" : "Mark done"} className="mb-[9px] ml-3 shrink-0"><HandBox done={!!t.done_at} /></button>
                <button onClick={() => openEdit("task", t.id, t.text, t.done_at ? Date.parse(t.done_at) : null)} className="relative min-w-0 text-left">
                  <span className={`dn-hand block ${t.done_at ? "text-[rgba(21,18,14,.55)]" : "dn-ink"} ${fresh.has(`t${t.id}`) ? "dn-write" : ""}`} style={{ ["--dur" as any]: durFor(t.text) }}>{t.text}</span>
                  {t.done_at && (struck.has(t.id) ? <Strike /> : <svg className="pointer-events-none absolute inset-x-3 bottom-[14px] h-[14px] w-[calc(100%-24px)]" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden><path d="M1 9 C 18 5, 30 11, 48 7 S 80 4, 99 8" fill="none" stroke="#7d1a12" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>)}
                </button>
              </div>
              <div />
            </div>
          ))}

          {/* what was written */}
          <div className="dn-label">Written</div>
          {!page && <div className="dn-row"><div /><div className="dn-hand dn-graphite animate-pulse">turning the page…</div><div /></div>}
          {page && !lines.length && <div className="dn-row"><div /><div className="dn-hand text-[rgba(60,50,40,.35)]">{isToday ? "nothing written yet" : "this page was left blank"}</div><div /></div>}
          {lines.map((l) => {
            const ed = editing && ((l.entry && editing.kind === "entry" && editing.id === l.entry.id) || (l.draft && editing.kind === "draft" && editing.id === l.draft.id));
            if (ed) return editorRow(l.key);
            const isFresh = fresh.has(l.key);
            const parsed = l.entry?.parsed ?? [];
            return (
              <div key={l.key} className={`dn-row group ${erasing.has(l.key) ? "dn-erase" : ""}`}>
                <div className={`dn-time ${l.draft ? "!text-[rgba(90,80,70,.6)]" : ""}`}>{hhmm(l.at)}</div>
                <button className="relative min-w-0 text-left" title={parsed.map((p) => `${TABLE_LABEL[p.table] ?? p.table}: ${p.summary}`).join("\n") || (l.draft ? "in pencil: not saved yet" : "")}
                  onClick={() => (l.entry ? openEdit("entry", l.entry.id, l.text, l.at) : l.draft && openEdit("draft", l.draft.id, l.text, l.at))}>
                  <span className={`dn-hand block ${l.draft ? (inking.has(l.key) ? "dn-inking" : "dn-graphite") : "dn-ink"} ${isFresh ? "dn-write" : ""}`}
                    style={{ ["--dur" as any]: durFor(l.text), animationDelay: inking.has(l.key) ? `${[...inking].indexOf(l.key) * 140}ms` : undefined }}
                    onAnimationEnd={() => isFresh && setFresh((f) => { const n = new Set(f); n.delete(l.key); return n; })}>
                    {l.text}
                  </span>
                </button>
                <div className="flex items-end gap-1.5 pb-[11px]">
                  {parsed.length > 0 && <span className="hidden max-w-[220px] truncate font-mono text-[10px] text-[rgba(60,50,40,.55)] md:inline">{parsed.map((p) => TABLE_LABEL[p.table] ?? p.table).join(" · ")}</span>}
                  {l.entry?.status === "needs_review" && <span title="Not understood yet: tap to reword, or /retry in Telegram" className="font-hand text-[18px] leading-none text-[#8a1c12]">?</span>}
                  {l.entry?.status === "corrected" && <span title="Corrected by hand" className="font-mono text-[10px] text-[rgba(120,30,22,.6)]">✎</span>}
                  {l.draft && <PenLine size={12} className="text-[rgba(90,80,70,.55)]" aria-label="pencil" />}
                </div>
                {isFresh && (
                  <span className="dn-nib" style={{ ["--dur" as any]: durFor(l.text), ["--end" as any]: `calc(var(--margin) + 16px + ${Math.min(l.text.length, 46)}ch * .62)` }}><Nib /></span>
                )}
              </div>
            );
          })}

          {/* the next line */}
          <div className="dn-row">
            <div className="dn-time !text-[rgba(90,80,70,.55)]">{hhmm(startAt ?? now)}</div>
            <div className="flex min-w-0 items-end">
              <button onClick={() => setTaskMode((m) => !m)} aria-pressed={taskMode} title={taskMode ? "Writing an intention (task)" : "Writing what happened. Tap for an intention"}
                className={`mb-[8px] ml-3 shrink-0 rounded ${taskMode ? "text-[#7d1a12]" : "text-[rgba(40,32,24,.45)]"}`}>
                {taskMode ? <Square size={18} strokeWidth={2.2} /> : <Feather size={18} />}
              </button>
              <input ref={inputRef} value={text} aria-label="Write a line"
                onChange={(e) => { setText(e.target.value); if (!startAt && e.target.value.trim()) setStartAt(Date.now()); if (!e.target.value) setStartAt(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); submit(); } }}
                onFocus={() => setTimeout(() => inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 250)}
                placeholder={taskMode ? "an intention for today…" : isToday ? "write what you did…" : `add to ${day}…`}
                enterKeyHint="done" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                className="dn-input dn-hand !filter-none min-w-0 flex-1" />
            </div>
            <div className="pb-[9px] font-mono text-[10px] text-[rgba(60,50,40,.45)]">{startAt ? "stamped" : ""}</div>
          </div>
          <div className="dn-row"><div /><div /><div /></div>

          <footer className="dn-rule"><span><span className="mr-2 font-mono text-[9.5px] uppercase tracking-[.2em] text-[rgba(120,30,22,.6)]">rule</span>{rule}</span></footer>
        </article>
      </div>

      {/* write in ink */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10.5px] leading-relaxed text-slate-dim">
          Enter writes a line in pencil · Ctrl/⌘+Enter or the button writes it in ink · tap a line to fix it · swipe or ← → to turn pages
        </p>
        <button onClick={() => writeInk()} disabled={busy || !pencilCount}
          className="btn !border-apple/60 !bg-apple/10 !px-4 !py-2.5 text-[14px] disabled:opacity-35">
          <PenLine size={15} className="text-apple" />{busy ? "Inking…" : `Write ${pencilCount || ""} in ink`}
        </button>
      </div>
      {err && <p className="mt-3 font-mono text-[12px] text-apple">⚠ {err}</p>}
      {reply && (
        <ul className="card mt-4 px-5 py-4 font-mono text-[12px] leading-relaxed text-ink" aria-live="polite">
          {reply.split("\n").map((t, i) => (
            <li key={i} className="ink-in" style={{ animationDelay: `${Math.min(i, 10) * 110}ms` }}>
              <span className={t.startsWith("⚠") ? "text-apple" : t.startsWith("·") ? "text-slate" : ""}>{t || " "}</span>
            </li>
          ))}
          <li className="mt-2"><button className="text-[11px] text-slate underline" onClick={() => setReply(null)}>dismiss</button></li>
        </ul>
      )}
    </div>
  );
}
