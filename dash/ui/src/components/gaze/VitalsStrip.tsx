import { useEffect, useMemo, useRef, useState } from "react";
import { Drumstick, Droplets, Flame, Footprints, Gauge, Moon, Route, Timer } from "lucide-react";
import { Data, byDay, lastDays, shortDay, todayKey } from "../../data";

type Metric = {
  key: string; label: string; icon: JSX.Element;
  series: (number | null)[];      // last 7 IST days, oldest first; the last one is today
  fmt: (n: number) => string;
  unit: string;
  target?: number;                // red when reached
  best?: boolean;                 // red when today beats every earlier day loaded
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
    const h = (k: "steps" | "exercise_minutes" | "running_speed" | "walk_run_distance" | "active_cal") =>
      days.map((d) => health.get(d)?.[k] ?? null);
    // sleep is dated to the night it started: a day's value is the night before it, else Apple Health's number
    const sleepBy = byDay(data.sleep, (r) => r.duration_min);
    const prev = (d: string) => new Date(Date.parse(d + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
    const sleep = days.map((d) => sleepBy.get(prev(d)) ?? sleepBy.get(d) ?? health.get(d)?.sleep_minutes ?? null);
    const waterBy = byDay(data.water, (r) => r.ml);
    const proteinBy = byDay(data.meals, (r) => r.protein_g_est);
    const logged = (m: Map<string, number>) => days.map((d) => m.get(d) ?? null);
    return [
      { key: "steps", label: "steps", icon: <Footprints size={14} />, series: h("steps"), fmt: (n) => Math.round(n).toLocaleString("en-IN"), unit: "", target: 10000 },
      { key: "exercise", label: "exercise", icon: <Timer size={14} />, series: h("exercise_minutes"), fmt: (n) => String(Math.round(n)), unit: "min", target: 30 },
      { key: "speed", label: "run speed", icon: <Gauge size={14} />, series: h("running_speed"), fmt: (n) => n.toFixed(1), unit: "km/h", best: true },
      { key: "distance", label: "walk / run", icon: <Route size={14} />, series: h("walk_run_distance"), fmt: (n) => n.toFixed(1), unit: "km", best: true },
      { key: "calories", label: "active kcal", icon: <Flame size={14} />, series: h("active_cal"), fmt: (n) => String(Math.round(n)), unit: "", target: 500 },
      { key: "sleep", label: "sleep", icon: <Moon size={14} />, series: sleep, fmt: hm, unit: "", target: 420 },
      { key: "water", label: "water", icon: <Droplets size={14} />, series: logged(waterBy), fmt: (n) => (n / 1000).toFixed(1), unit: "L", target: 2500 },
      { key: "protein", label: "protein", icon: <Drumstick size={14} />, series: logged(proteinBy), fmt: (n) => String(Math.round(n)), unit: "g", target: 80 },
    ];
  }, [data]);

  // personal bests come from everything loaded, not just this week
  const bests = useMemo(() => {
    const before = (data.health_log ?? []).filter((r) => r.date < todayKey());
    return {
      speed: Math.max(0, ...before.map((r) => r.running_speed ?? 0)),
      distance: Math.max(0, ...before.map((r) => r.walk_run_distance ?? 0)),
    } as Record<string, number>;
  }, [data]);

  return (
    <section ref={ref} aria-label="Today's numbers" className="vitals-strip relative mb-8 grid grid-cols-2 gap-px overflow-visible rounded-2xl sm:grid-cols-4 lg:grid-cols-8">
      {metrics.map((m, i) => {
        const now = m.series[m.series.length - 1];
        const live = now != null && now > 0;
        const hit = live && ((m.target != null && now! >= m.target) || (m.best && bests[m.key] > 0 && now! > bests[m.key]));
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
