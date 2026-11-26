import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Goal, Store } from "../../store";

const MAX_ON_BOARD = 10;

/** Today's goals as sticky notes on a corkboard. Each day starts with an empty board. */
export function GoalsBoard({ store }: { store: Store }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");
  const saving = useRef(false);

  useEffect(() => { store.goals().then(setGoals).catch((e) => { setErr((e as Error).message); setGoals([]); }); }, [store]);

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

  const toggle = async (g: Goal) => {
    const done = !g.done;
    setGoals((gs) => gs!.map((x) => (x.id === g.id ? { ...x, done: done ? 1 : 0 } : x)));
    try { await store.editGoal(g.id, { done }); }
    catch (e) { setErr((e as Error).message); setGoals((gs) => gs!.map((x) => (x.id === g.id ? g : x))); }
  };

  const remove = (g: Goal) => {
    setLeaving((s) => new Set(s).add(g.id));
    setTimeout(async () => {
      try { await store.deleteGoal(g.id); setGoals((gs) => gs!.filter((x) => x.id !== g.id)); }
      catch (e) { setErr((e as Error).message); }
      finally { setLeaving((s) => { const n = new Set(s); n.delete(g.id); return n; }); }
    }, 150);
  };

  const list = goals ?? [];
  const kept = list.filter((g) => g.done).length;
  return (
    <section aria-label="Goals for today" className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Names for today</div>
          <h2 className="mt-1 font-serif text-[26px] leading-none text-ink">The board</h2>
        </div>
        {list.length > 0 && <span className="font-mono text-[11px] tabular-nums text-slate">{kept} of {list.length} kept</span>}
      </div>
      <div className="cork-board">
        <ul className="goals-grid">
          {goals == null && <li className="col-span-full py-8 text-center font-mono text-[11px] text-[#c9b48c]/70">pinning the notes…</li>}
          {list.map((g) => (
            <li key={g.id}
              className={`sticky-note ${fresh.has(g.id) ? "sticky-pop" : ""} ${leaving.has(g.id) ? "sticky-leave" : ""} ${g.done ? "is-done" : ""}`}
              style={{ background: g.color ?? "#f5e6a3", ["--tilt" as any]: `${g.rotation ?? 0}deg` }}>
              <span className="sticky-pin" aria-hidden="true" />
              <button className="sticky-text" onClick={() => toggle(g)} aria-pressed={!!g.done} title={g.done ? "Kept. Tap to undo" : "Tap when kept"}>
                <span className="relative">
                  {g.text}
                  {!!g.done && (
                    <svg className="sticky-strike" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M2 6 C 25 3, 55 8, 98 4" pathLength={1} />
                    </svg>
                  )}
                </span>
              </button>
              <button className="sticky-x" onClick={() => remove(g)} aria-label={`Remove "${g.text}"`}><X size={13} /></button>
            </li>
          ))}
          {goals != null && list.length < MAX_ON_BOARD && (
            <li className={`sticky-note sticky-new ${adding ? "is-writing" : ""}`} style={{ ["--tilt" as any]: "0deg" }}>
              {adding ? (
                <textarea autoFocus value={draft} maxLength={60} rows={3} aria-label="New goal"
                  onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { setDraft(""); setAdding(false); } }}
                  onBlur={save} placeholder="a goal for today…" className="sticky-input" />
              ) : (
                <button className="flex h-full w-full flex-col items-center justify-center gap-1" onClick={() => setAdding(true)} aria-label="Add a goal">
                  <Plus size={20} /><span className="font-mono text-[10px] uppercase tracking-[0.18em]">add</span>
                </button>
              )}
            </li>
          )}
        </ul>
        {goals != null && !list.length && !adding && <p className="mt-3 text-center font-hand text-[18px] text-[#c9b48c]/80">An empty board. Write what today is for.</p>}
      </div>
      {err && <p role="alert" className="mt-2 font-mono text-[11px] text-apple">{err}</p>}
    </section>
  );
}
