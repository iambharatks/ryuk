import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Goal, GoalPatch, Store } from "../../store";
import { pressDrag } from "./drag";

const MAX_ON_BOARD = 24;
const MAX_TEXT = 160;
const COLORS = ["#f5e6a3", "#f5c6c6", "#c6d8f5", "#c6f5d0"];     // same order the server hands them out
type Box = { left: number; top: number; w: number; h: number };
type M = { nw: number; nh: number; gx: number; gy: number; small: boolean };

/** Base note size and spacing for the board's width. */
const metrics = (w: number): M => (w < 560 ? { nw: 112, nh: 100, gx: 12, gy: 18, small: true } : { nw: 140, nh: 120, gx: 18, gy: 24, small: false });

/** A note grows with its words: wider first, then taller. Short notes stay the classic square. */
function sizeFor(text: string, m: M, W: number) {
  const len = text.length;
  const k = len <= 26 ? 1 : len <= 55 ? 1.22 : len <= 95 ? 1.42 : 1.6;
  const w = Math.min(Math.round(m.nw * k), Math.max(m.nw, W));
  const charW = m.small ? 7.6 : 8.6, lineH = m.small ? 18 : 20.5;
  const perLine = Math.max(6, Math.floor((w - 26) / charW));
  const lines = Math.ceil(len / perLine) + (len > perLine ? 1 : 0);       // a spare line for word wrap
  return { w, h: Math.max(m.nh, Math.round(lines * lineH + 36)) };
}

const overlaps = (a: Box, b: Box, pad = 6) => a.left < b.left + b.w + pad && b.left < a.left + a.w + pad && a.top < b.top + b.h + pad && b.top < a.top + a.h + pad;

/**
 * Sticky notes on a corkboard. A note stays from the day it is written until it is kept; a kept note stays
 * (struck through) for the rest of that day, then it is gone. Tear one off to remove it now.
 * Pull a new note off the pad. Drag a note anywhere (hold first on a phone): notes may overlap and the one you
 * moved last sits on top. Where you leave it is saved.
 */
export function GoalsBoard({ store }: { store: Store }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [draft, setDraft] = useState("");
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [tearing, setTearing] = useState<Set<number>>(new Set());
  const [scraps, setScraps] = useState<{ id: number; left: number; top: number; color: string }[]>([]);
  const [drag, setDrag] = useState<{ id: number; left: number; top: number } | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const saving = useRef(false);

  // the board's width decides note size and where unmoved notes go
  const field = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [goals == null]);

  useEffect(() => { store.goals().then(setGoals).catch((e) => { setErr((e as Error).message); setGoals([]); }); }, [store]);

  const list = goals ?? [];
  const m = metrics(W || 800);
  const nextColor = COLORS[list.length % COLORS.length];

  // real heights once rendered (fonts differ a little from the estimate)
  const els = useRef(new Map<number, HTMLElement>());
  const [measured, setMeasured] = useState<Record<number, number>>({});
  useLayoutEffect(() => {
    let next: Record<number, number> | null = null;
    els.current.forEach((el, id) => { const h = el.offsetHeight; if (h && Math.abs((measured[id] ?? 0) - h) > 1) (next ??= { ...measured })[id] = h; });
    if (next) setMeasured(next);
  });

  // moved notes where you left them; the rest flow left to right around them
  const boxes = useMemo(() => {
    const out = new Map<number, Box>();
    const taken: Box[] = [];
    const size = (g: Goal) => { const s = sizeFor(g.text, m, W || 800); return { w: s.w, h: measured[g.id] ?? s.h }; };
    for (const g of list) if (g.x != null && g.y != null) {
      const s = size(g); const b = { left: g.x * Math.max(0, W - s.w), top: g.y, ...s };
      out.set(g.id, b); taken.push(b);
    }
    const cols = Math.max(1, Math.floor((W + m.gx) / (m.nw + m.gx)));
    const x0 = Math.max(0, (W - (cols * m.nw + (cols - 1) * m.gx)) / 2);
    let x = x0, y = 6, rowH = 0;
    const place = (w: number, h: number): Box => {
      for (let guard = 0; guard < 2000; guard++) {
        if (x + w > W + 0.5 && x > x0) { x = x0; y += rowH + m.gy; rowH = 0; }
        const b = { left: Math.min(x, Math.max(0, W - w)), top: y, w, h };
        const hit = taken.find((t) => overlaps(t, b));
        if (!hit) { x += w + m.gx; rowH = Math.max(rowH, h); taken.push(b); return b; }
        x = Math.max(x + 24, hit.left + hit.w + m.gx);
      }
      return { left: 0, top: y, w, h };
    };
    for (const g of list) if (!out.has(g.id)) { const s = size(g); out.set(g.id, place(s.w, s.h)); }
    const ns = sizeFor(draft || "a goal…", m, W || 800);
    return { out, newSlot: place(ns.w, ns.h) };
  }, [list, W, m.nw, m.nh, m.gx, m.gy, measured, draft]);   // eslint-disable-line react-hooks/exhaustive-deps

  const allBoxes = [...boxes.out.values()];
  const dragBox = drag ? boxes.out.get(drag.id) : null;
  const bottom = Math.max(m.nh + 12, ...allBoxes.map((b) => b.top + b.h + 14), adding ? boxes.newSlot.top + boxes.newSlot.h + 14 : 0, drag && dragBox ? drag.top + dragBox.h + 14 : 0);
  const topZ = list.reduce((mx, g) => Math.max(mx, g.z ?? 0), 0);

  const patch = async (g: Goal, p: GoalPatch, local: Partial<Goal>) => {
    setGoals((gs) => gs!.map((x) => (x.id === g.id ? { ...x, ...local } : x)));
    try { await store.editGoal(g.id, p); setErr(""); }
    catch (e) { setErr((e as Error).message); setGoals((gs) => gs!.map((x) => (x.id === g.id ? g : x))); }
  };

  // pull a sheet off the pad, then write on it
  const pull = () => {
    if (pulling || adding || goals == null) return;
    if (list.length >= MAX_ON_BOARD) { setErr(`The board holds ${MAX_ON_BOARD} notes. Tear one off first.`); return; }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPulling(true);
    setTimeout(() => { setPulling(false); setAdding(true); }, reduce ? 0 : 330);
  };

  const save = async () => {
    const text = draft.trim();
    if (saving.current) return;
    if (!text) { setAdding(false); return; }
    saving.current = true;
    try {
      const g = await store.addGoal(text);
      setGoals((gs) => [...(gs ?? []), g]);
      setFresh((f) => new Set(f).add(g.id));
      setDraft(""); setAdding(false); setErr("");
    } catch (e) { setErr((e as Error).message); }
    finally { saving.current = false; }
  };

  const toggle = (g: Goal) => {
    const done = !g.done;
    patch(g, { done }, { done: done ? 1 : 0, done_at: done ? new Date().toISOString() : null });
  };

  const tear = (g: Goal) => {
    const b = boxes.out.get(g.id)!;
    setTearing((s) => new Set(s).add(g.id));
    setScraps((s) => [...s, { id: g.id, left: b.left + b.w / 2 - 15, top: b.top - 5, color: g.color ?? COLORS[0] }]);
    setTimeout(() => setScraps((s) => s.filter((x) => x.id !== g.id)), 1600);
    setTimeout(async () => {
      try { await store.deleteGoal(g.id); setGoals((gs) => gs!.filter((x) => x.id !== g.id)); }
      catch (e) { setErr((e as Error).message); }
      finally { setTearing((s) => { const n = new Set(s); n.delete(g.id); return n; }); }
    }, 480);
  };

  const startDrag = (e: React.PointerEvent, g: Goal) => {
    const from = boxes.out.get(g.id)!;
    const maxLeft = Math.max(0, W - from.w), maxTop = bottom + m.nh;   // a little room below: the board grows
    let last = { left: from.left, top: from.top };
    pressDrag(e, {
      onArm: () => setArmed(g.id),
      onCancel: () => setArmed(null),
      onStart: () => { setArmed(null); setDrag({ id: g.id, left: from.left, top: from.top }); setGoals((gs) => gs!.map((x) => (x.id === g.id ? { ...x, z: topZ + 1 } : x))); },
      onMove: (dx, dy) => { last = { left: Math.min(maxLeft, Math.max(0, from.left + dx)), top: Math.min(maxTop, Math.max(0, from.top + dy)) }; setDrag({ id: g.id, ...last }); },
      onEnd: () => {
        setDrag(null); setArmed(null);
        const fx = (left: number, w: number) => { const span = Math.max(0, W - w); return span ? Math.round((Math.min(span, left) / span) * 1000) / 1000 : 0; };
        const x = fx(last.left, from.w), y = Math.round(last.top);
        // Pin every note that was still flowing to where it stands now, so the flow can't push them around
        // when this one lands on top of them.
        const frozen = list.filter((o) => o.id !== g.id && (o.x == null || o.y == null)).map((o) => {
          const b = boxes.out.get(o.id)!;
          return { o, x: fx(b.left, b.w), y: Math.round(b.top) };
        });
        setGoals((gs) => gs!.map((o) => {
          if (o.id === g.id) return { ...o, x, y, z: topZ + 1 };
          const f = frozen.find((v) => v.o.id === o.id);
          return f ? { ...o, x: f.x, y: f.y } : o;
        }));
        Promise.all([
          store.editGoal(g.id, { x, y, z: topZ + 1 }),
          ...frozen.map((f) => store.editGoal(f.o.id, { x: f.x, y: f.y })),
        ]).then(() => setErr("")).catch((er) => setErr((er as Error).message));
      },
    });
  };

  const kept = list.filter((g) => g.done).length;
  return (
    <section aria-label="Goals board" className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Names for today</div>
          <div className="mt-1 flex items-center gap-4">
            <h2 className="font-serif text-[26px] leading-none text-ink">The board</h2>
            <StickyPad color={nextColor} under={[COLORS[(list.length + 1) % 4], COLORS[(list.length + 2) % 4]]} pulling={pulling}
              disabled={goals == null || adding || list.length >= MAX_ON_BOARD} onPull={pull} />
          </div>
        </div>
        <div className="text-right">
          {list.length > 0 && <div className="font-mono text-[11px] tabular-nums text-slate">{kept} of {list.length} kept</div>}
          <div className="font-mono text-[10px] text-slate-dim"><span className="hidden md:inline">drag to move · tap to keep</span><span className="md:hidden">hold to move · tap to keep</span></div>
        </div>
      </div>
      <div className="cork-board">
        <div ref={field} className="goals-field" style={{ height: bottom }}>
          {goals == null && <p className="py-8 text-center font-mono text-[11px] text-[#c9b48c]/70">pinning the notes…</p>}
          {list.map((g) => {
            const b = boxes.out.get(g.id)!;
            const at = drag?.id === g.id ? drag : b;
            const carried = !g.done && g.date < todayIST();
            return (
              <div key={g.id} role="group" aria-label={g.text}
                ref={(el) => { if (el) els.current.set(g.id, el); else els.current.delete(g.id); }}
                className={`sticky-note is-placed ${g.text.length > 95 ? "is-long" : ""} ${fresh.has(g.id) ? "sticky-pop" : ""} ${tearing.has(g.id) ? "sticky-tear" : ""} ${g.done ? "is-done" : ""} ${drag?.id === g.id ? "is-dragging" : ""} ${armed === g.id ? "is-armed" : ""}`}
                style={{ left: at.left, top: at.top, width: b.w, minHeight: m.nh, zIndex: drag?.id === g.id ? 9999 : (g.z ?? 0) + 1,
                  background: g.color ?? COLORS[0], ["--tilt" as any]: `${g.rotation ?? 0}deg` }}
                onPointerDown={(e) => startDrag(e, g)}>
                <span className="sticky-pin" aria-hidden="true" />
                <button className="sticky-text" onClick={() => toggle(g)} aria-pressed={!!g.done} title={g.done ? "Kept. Tap to undo" : "Tap when kept · drag to move"}>
                  <span className="relative">
                    {g.text}
                    {!!g.done && (
                      <svg className="sticky-strike" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M2 6 C 25 3, 55 8, 98 4" pathLength={1} />
                      </svg>
                    )}
                  </span>
                </button>
                {carried && <span className="sticky-since" title={`written ${g.date}`}>since {shortDay(g.date)}</span>}
                <button data-nodrag className="sticky-tear-btn" onClick={() => tear(g)} aria-label={`Tear off "${g.text}"`} title="Tear it off">
                  <TearIcon />
                </button>
              </div>
            );
          })}
          {scraps.map((s) => (
            <span key={s.id} className="sticky-scrap" style={{ left: s.left, top: s.top, background: s.color }} aria-hidden="true"><span className="sticky-pin" /></span>
          ))}
          {adding && (
            <div className={`sticky-note is-placed is-writing-note sticky-pop ${draft.length > 95 ? "is-long" : ""}`}
              style={{ left: boxes.newSlot.left, top: boxes.newSlot.top, width: boxes.newSlot.w, minHeight: boxes.newSlot.h, zIndex: 10000, background: nextColor, ["--tilt" as any]: "0deg" }}>
              <span className="sticky-pin" aria-hidden="true" />
              <textarea autoFocus value={draft} maxLength={MAX_TEXT} rows={2} aria-label="New goal"
                ref={(el) => { if (el) { el.style.height = "0px"; el.style.height = `${el.scrollHeight}px`; } }}
                onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { setDraft(""); setAdding(false); } }}
                onBlur={save} placeholder="a goal…" className="sticky-input" />
              {draft.length > MAX_TEXT - 30 && <span className="sticky-count">{MAX_TEXT - draft.length}</span>}
            </div>
          )}
          {goals != null && !list.length && !adding && (
            <button onClick={pull} className="absolute inset-0 flex items-center justify-center px-6 text-center font-hand text-[18px] text-[#c9b48c]/80">An empty board. Pull a note off the pad and write what today is for.</button>
          )}
        </div>
      </div>
      {err && <p role="alert" className="mt-2 font-mono text-[11px] text-apple">{err}</p>}
    </section>
  );
}

/** A little pad of sticky notes; the top sheet is the next note's colour and peels off when tapped. */
function StickyPad({ color, under, pulling, disabled, onPull }: { color: string; under: string[]; pulling: boolean; disabled: boolean; onPull: () => void }) {
  return (
    <button type="button" onClick={onPull} disabled={disabled} className={`sticky-pad ${pulling ? "is-pulling" : ""}`}
      aria-label="Pull a new sticky note off the pad" title={disabled ? "The board is full. Tear a note off first" : "Pull a new note"}>
      <span className="pad-sheet" style={{ background: under[1], transform: "translate(3px, 4px) rotate(3deg)" }} />
      <span className="pad-sheet" style={{ background: under[0], transform: "translate(1.5px, 2px) rotate(1.5deg)" }} />
      <span className="pad-sheet pad-base" style={{ background: color }} />
      <span key={String(pulling)} className="pad-sheet pad-top" style={{ background: color }}><span className="pad-glue" /></span>
    </button>
  );
}

const todayIST = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
const shortDay = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** a little ripped edge */
function TearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 6.5 L4 4.5 L6 6.8 L8 4.4 L10 6.8 L12 4.5 L14.5 6.5" />
      <path d="M3 9.5 L3 14 L13 14 L13 9.5" opacity=".55" />
    </svg>
  );
}
