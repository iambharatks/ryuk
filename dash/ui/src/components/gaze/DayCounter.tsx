import { useEffect, useMemo, useRef, useState } from "react";
import { Data, dayCounter } from "../../data";

/** Days written, big, with the day of the notebook, the streak and today's entry count beside it. */
export function DayCounterStrip({ data }: { data: Data }) {
  const dc = useMemo(() => dayCounter(data), [data]);
  const entries = dc.tallies.find((t) => t.key === "entries")?.now ?? 0;
  return (
    <section aria-label="Day counter" className="flex items-end gap-5">
      <div>
        <div className="font-frak text-[76px] leading-[0.8] text-ink md:text-[96px]"><CountUp value={dc.daysWritten} /></div>
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.28em] text-slate">Days written</div>
      </div>
      <div className="pb-1 font-mono text-[10.5px] leading-relaxed text-slate">
        <div>Day <span className="text-ink">{dc.dayN}</span> of the notebook</div>
        <div><span className="text-apple">{dc.streak}</span>-day streak</div>
        <div><span className="text-ink"><CountUp value={entries} /></span> {entries === 1 ? "entry" : "entries"} today</div>
      </div>
    </section>
  );
}

/** Counts from the previous value to the new one over 500 ms. */
export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { cur.current = value; setShown(value); return; }
    const start = performance.now(), a = cur.current, b = value;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 500);
      cur.current = a + (b - a) * (1 - (1 - k) ** 3);
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}
