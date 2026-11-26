import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Briefcase, Drumstick, Dumbbell, Footprints, Moon } from "lucide-react";
import { Data, byDay, lastDays, shortDay } from "../../data";

type Metric = {
  key: string; label: string; icon: JSX.Element;
  series: (number | null)[];      // last 7 IST days, oldest first; the last one is today
  fmt: (n: number) => string;
  unit: string;
  target?: number;                // red when reached
};

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;

/** Today's numbers only, as parsed values. Anything not logged yet is a dash, never text. */
export function VitalsStrip({ data }: { data: Data }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const metrics = useMemo<Metric[]>(() => {
    const days = lastDays(7);
    const health = new Map((data.health_log ?? []).map((h) => [h.date, h]));
    const h = (k: "steps" | "exercise_minutes") => days.map((d) => health.get(d)?.[k] ?? null);
    const logged = (m: Map<string, number>) => days.map((d) => m.get(d) ?? null);
    // sleep is dated to the night it started: a day's value is the night before it, else Apple Health's number
    const sleepBy = byDay(data.sleep, (r) => r.duration_min);
    const prev = (d: string) => new Date(Date.parse(d + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
    const sleep = days.map((d) => sleepBy.get(prev(d)) ?? sleepBy.get(d) ?? health.get(d)?.sleep_minutes ?? null);
    // exercise: logged training (cardio minutes + ~3 min per lifting set) or Apple's exercise minutes, whichever is
    // larger. Not added together: the watch already counts the same gym session or run.
    const train = new Map(byDay(data.cardio, (r) => r.duration_min));
    for (const [k, v] of byDay(data.strength, (r) => (r.sets ?? 1) * 3)) train.set(k, (train.get(k) || 0) + v);
    const apple = h("exercise_minutes");
    const exercise = days.map((d, i) => { const a = apple[i], t = train.get(d); return a == null && t == null ? null : Math.max(a ?? 0, t ?? 0); });
    const mins = (kind: string) => logged(byDay(data.time_log.filter((r) => r.kind === kind), (r) => r.duration_min));
    return [
      { key: "steps", label: "steps", icon: <Footprints size={14} />, series: h("steps"), fmt: (n) => Math.round(n).toLocaleString("en-IN"), unit: "", target: 10000 },
      { key: "protein", label: "protein", icon: <Drumstick size={14} />, series: logged(byDay(data.meals, (r) => r.protein_g_est)), fmt: (n) => String(Math.round(n)), unit: "g", target: 80 },
      { key: "exercise", label: "exercise", icon: <Dumbbell size={14} />, series: exercise, fmt: (n) => String(Math.round(n)), unit: "min", target: 30 },
      { key: "work", label: "work", icon: <Briefcase size={14} />, series: mins("deep_work"), fmt: hm, unit: "", target: 240 },
      { key: "sleep", label: "sleep", icon: <Moon size={14} />, series: sleep, fmt: hm, unit: "", target: 420 },
      { key: "read", label: "read", icon: <BookOpen size={14} />, series: mins("read"), fmt: (n) => String(Math.round(n)), unit: "min", target: 30 },
    ];
  }, [data]);

  return (
    <section ref={ref} aria-label="Today's numbers" className="vitals-strip relative mb-8 grid grid-cols-2 gap-px overflow-visible rounded-2xl sm:grid-cols-3 lg:grid-cols-6">
      {metrics.map((m, i) => {
        const now = m.series[m.series.length - 1];
        const live = now != null && now > 0;
        const hit = live && m.target != null && now! >= m.target;
        return (
          <div key={m.key} className="relative">
            <button onClick={() => setOpen((o) => (o === m.key ? null : m.key))} aria-expanded={open === m.key}
              aria-label={`${m.label}: ${live ? m.fmt(now!) + " " + m.unit : "not logged"}. Show the last 7 days`}
              className="vital-cell flex min-h-[76px] w-full flex-col items-start justify-center gap-1 px-4 py-3 text-left">
              <span className={`font-mono text-[22px] leading-none tabular-nums ${hit ? "vital-hit" : live ? "vital-live" : "text-slate-dim"}`}>
                {live ? m.fmt(now!) : "—"}{live && m.unit && <span className="ml-1 text-[11px] text-slate">{m.unit}</span>}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-slate">{m.icon}{m.label}</span>
            </button>
            {open === m.key && <Week m={m} edge={i % 2 === 0 ? "left-0" : "right-0"} />}
          </div>
        );
      })}
    </section>
  );
}

/** The last 7 days as little bars, opened by tapping a metric. */
function Week({ m, edge }: { m: Metric; edge: string }) {
  const days = lastDays(7);
  const max = Math.max(1, ...m.series.map((v) => v ?? 0));
  return (
    <div role="dialog" aria-label={`${m.label}, last 7 days`}
      className={`vital-pop absolute ${edge} top-full z-30 mt-2 w-[230px] rounded-xl border border-hairline bg-raised p-3 shadow-[0_18px_40px_-12px_rgba(0,0,0,.9)] sm:left-1/2 sm:right-auto sm:-translate-x-1/2`}>
      <div className="eyebrow !text-[9px]">{m.label} · 7 days</div>
      <div className="mt-3 flex h-[64px] items-end gap-1.5">
        {m.series.map((v, i) => (
          <div key={days[i]} className="flex flex-1 flex-col items-center gap-1" title={`${shortDay(days[i])}: ${v == null ? "—" : m.fmt(v) + " " + m.unit}`}>
            <div className={`w-full rounded-sm ${i === days.length - 1 ? "bg-apple" : "bg-[#ECE5D3]/60"}`} style={{ height: v ? `${Math.max(4, (v / max) * 56)}px` : "2px", opacity: v ? 1 : 0.25 }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 font-mono text-[8.5px] text-slate-dim">
        {days.map((d) => <span key={d} className="flex-1 text-center">{shortDay(d).split(" ")[0]}</span>)}
      </div>
    </div>
  );
}
