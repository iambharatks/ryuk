import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Goal, GoalPatch, Store } from "../../store";
import { pressDrag } from "./drag";

const MAX_ON_BOARD = 24;
type Box = { left: number; top: number };

/** Note size and spacing for the board's width. */
const metrics = (w: number) => (w < 560 ? { nw: 112, nh: 100, gx: 12, gy: 18 } : { nw: 140, nh: 120, gx: 18, gy: 24 });

/**
 * Sticky notes on a corkboard. A note stays from the day it is written until it is kept; a kept note stays
 * (struck through) for the rest of that day, then it is gone. Tear one off to remove it now.
 * Drag a note anywhere: notes may overlap, the one you moved last sits on top. Where you leave it is saved.
 */
export function GoalsBoard({ store }: { store: Store }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [tearing, setTearing] = useState<Set<number>>(new Set());
  const [scraps, setScraps] = useState<{ id: number; left: number; top: number; color: string }[]>([]);
  const [drag, setDrag] = useState<{ id: number } & Box | null>(null);
  const [err, setErr] = useState("");
  const saving = useRef(false);

  // the board's width decides note size and where unplaced notes go
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
  const { nw, nh, gx, gy } = metrics(W || 800);
  const span = Math.max(0, W - nw);

  // placed notes where you left them; the rest fill free slots in a grid, left to right
  const boxes = useMemo(() => {
    const out = new Map<number, Box>();
    const placed: Box[] = [];
    for (const g of list) if (g.x != null && g.y != null) { const b = { left: g.x * span, top: g.y }; out.set(g.id, b); placed.push(b); }
    const cols = Math.max(1, Math.floor((W + gx) / (nw + gx)));
    const pad = Math.max(0, (W - (cols * nw + (cols - 1) * gx)) / 2);     // centre the grid of unmoved notes
    const free = (b: Box) => placed.every((p) => Math.abs(p.left - b.left) > nw * 0.6 || Math.abs(p.top - b.top) > nh * 0.6);
    let s = 0;
    const next = () => { for (;; s++) { const b = { left: pad + (s % cols) * (nw + gx), top: Math.floor(s / cols) * (nh + gy) + 6 }; if (free(b)) { s++; return b; } } };
    for (const g of list) if (!out.has(g.id)) { const b = next(); out.set(g.id, b); placed.push(b); }
    return { out, newSlot: next() };
  }, [list, W, span, nw, nh, gx, gy]);

  const bottom = Math.max(nh + 12, ...[...boxes.out.values()].map((b) => b.top + nh + 14), adding ? boxes.newSlot.top + nh + 14 : 0, drag ? drag.top + nh + 14 : 0);
  const topZ = list.reduce((m, g) => Math.max(m, g.z ?? 0), 0);

  const patch = async (g: Goal, p: GoalPatch, local: Partial<Goal>) => {
    setGoals((gs) => gs!.map((x) => (x.id === g.id ? { ...x, ...local } : x)));
    try { await store.editGoal(g.id, p); setErr(""); }
    catch (e) { setErr((e as Error).message); setGoals((gs) => gs!.map((x) => (x.id === g.id ? g : x))); }
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
    setScraps((s) => [...s, { id: g.id, left: b.left + nw / 2 - 15, top: b.top - 5, color: g.color ?? "#f5e6a3" }]);
    setTimeout(() => setScraps((s) => s.filter((x) => x.id !== g.id)), 1600);
    setTimeout(async () => {
      try { await store.deleteGoal(g.id); setGoals((gs) => gs!.filter((x) => x.id !== g.id)); }
      catch (e) { setErr((e as Error).message); }
      finally { setTearing((s) => { const n = new Set(s); n.delete(g.id); return n; }); }
    }, 480);
  };

  const startDrag = (e: React.PointerEvent, g: Goal) => {
    const from = boxes.out.get(g.id)!;
    const maxTop = bottom + nh;     // you can pull a note a little below the last one; the board grows
    let last: Box = from;
    pressDrag(e, {
      onStart: () => { setDrag({ id: g.id, ...from }); setGoals((gs) => gs!.map((x) => (x.id === g.id ? { ...x, z: topZ + 1 } : x))); },
      onMove: (dx, dy) => { last = { left: Math.min(span, Math.max(0, from.left + dx)), top: Math.min(maxTop, Math.max(0, from.top + dy)) }; setDrag({ id: g.id, ...last }); },
      onEnd: () => {
        setDrag(null);
        const fx = (left: number) => (span ? Math.round((Math.min(span, left) / span) * 1000) / 1000 : 0);
        const x = fx(last.left), y = Math.round(last.top);
        // Pin every note that was still auto-placed to where it stands now. Otherwise the auto layout, which steers
        // clear of placed notes, would push the note you just dropped onto out of the way.
        const frozen = list.filter((o) => o.id !== g.id && (o.x == null || o.y == null)).map((o) => {
          const b = boxes.out.get(o.id)!;
          return { o, x: fx(b.left), y: Math.round(b.top) };
        });
        setGoals((gs) => gs!.map((o) => {
          if (o.id === g.id) return { ...o, x, y, z: topZ + 1 };
          const f = frozen.find((v) => v.o.id === o.id);
          return f ? { ...o, x: f.x, y: f.y } : o;
        }));
        Promise.all([
          store.editGoal(g.id, { x, y, z: topZ + 1 }),
          ...frozen.map((f) => store.editGoal(f.o.id, { x: f.x, y: f.y })),
        ]).then(() => setErr("")).catch((e) => setErr((e as Error).message));
      },
    });
  };

  const kept = list.filter((g) => g.done).length;
  return (
    <section aria-label="Goals board" className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Names for today</div>
          <div className="mt-1 flex items-center gap-3">
            <h2 className="font-serif text-[26px] leading-none text-ink">The board</h2>
            <button onClick={() => setAdding(true)} disabled={goals == null || list.length >= MAX_ON_BOARD || adding}
              aria-label="Write a sticky note" title={list.length >= MAX_ON_BOARD ? `The board holds ${MAX_ON_BOARD}. Tear one off first` : "Write a sticky note"}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-apple/40 text-ink transition hover:border-apple hover:bg-apple/10 disabled:opacity-30 md:h-8 md:w-8">
              <Plus size={16} />
            </button>
          </div>
        </div>
        <div className="text-right">
          {list.length > 0 && <div className="font-mono text-[11px] tabular-nums text-slate">{kept} of {list.length} kept</div>}
          <div className="hidden font-mono text-[10px] text-slate-dim md:block">drag to move · tap to keep</div>
        </div>
      </div>
      <div className="cork-board">
        <div ref={field} className="goals-field" style={{ height: bottom }}>
          {goals == null && <p className="py-8 text-center font-mono text-[11px] text-[#c9b48c]/70">pinning the notes…</p>}
          {list.map((g, i) => {
            const b = drag?.id === g.id ? drag : boxes.out.get(g.id)!;
            const carried = !g.done && g.date < todayIST();
            return (
              <div key={g.id} role="group" aria-label={g.text}
                className={`sticky-note is-placed ${fresh.has(g.id) ? "sticky-pop" : ""} ${tearing.has(g.id) ? "sticky-tear" : ""} ${g.done ? "is-done" : ""} ${drag?.id === g.id ? "is-dragging" : ""}`}
                style={{ left: b.left, top: b.top, width: nw, height: nh, zIndex: drag?.id === g.id ? 9999 : (g.z ?? 0) + 1,
                  background: g.color ?? "#f5e6a3", ["--tilt" as any]: `${g.rotation ?? 0}deg` }}
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
            <div className="sticky-note is-placed sticky-pop" style={{ left: boxes.newSlot.left, top: boxes.newSlot.top, width: nw, height: nh, zIndex: 10000, background: "#f5e6a3", ["--tilt" as any]: "0deg" }}>
              <span className="sticky-pin" aria-hidden="true" />
              <textarea autoFocus value={draft} maxLength={60} rows={3} aria-label="New goal"
                onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { setDraft(""); setAdding(false); } }}
                onBlur={save} placeholder="a goal…" className="sticky-input" />
            </div>
          )}
          {goals != null && !list.length && !adding && (
            <button onClick={() => setAdding(true)} className="absolute inset-0 flex items-center justify-center font-hand text-[18px] text-[#c9b48c]/80">An empty board. Tap to write what today is for.</button>
          )}
        </div>
      </div>
      {err && <p role="alert" className="mt-2 font-mono text-[11px] text-apple">{err}</p>}
    </section>
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
