import { useEffect, useMemo, useRef, useState } from "react";
import { Data, allEvents, dayCounter, dayKey, hhmm, todayKey } from "../../data";
import { TAG_ICON } from "./ChronicleCard";

const SHOWN = 5;

/**
 * Days written, big, with the day of the notebook, the streak and today's entry count beside it,
 * then the latest lines written today so the space beside the notebook says something.
 */
export function DayCounterStrip({ data }: { data: Data }) {
  const dc = useMemo(() => dayCounter(data), [data]);
  const entries = dc.tallies.find((t) => t.key === "entries")?.now ?? 0;
  const today = useMemo(() => {
    const t = todayKey();
    return allEvents(data).filter((e) => dayKey(e.at) === t).sort((a, b) => b.at.localeCompare(a.at));
  }, [data]);
  return (
    <section aria-label="Day counter" className="flex h-full flex-col justify-between gap-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="font-frak text-[76px] leading-[0.8] text-ink md:text-[96px]"><CountUp value={dc.daysWritten} /></div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.28em] text-slate">Days written</div>
        </div>
        <div className="flex gap-6 pb-1">
          <Stat n={dc.dayN} label="day of the notebook" />
          <Stat n={dc.streak} label="day streak" red />
          <Stat n={entries} label={entries === 1 ? "entry today" : "entries today"} />
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex items-baseline justify-between border-b border-hairline pb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate">Written today</span>
          {today.length > SHOWN && <span className="font-mono text-[10px] text-slate-dim">+{today.length - SHOWN} more</span>}
        </div>
        {today.length ? (
          <ol>
            {today.slice(0, SHOWN).map((e) => (
              <li key={`${e.table}${e.id}`} className="grid grid-cols-[44px_16px_minmax(0,1fr)] items-center gap-2 py-[3px]">
                <span className="font-mono text-[11px] tabular-nums text-slate-dim">{hhmm(e.at)}</span>
                <span className="text-slate" title={e.tag}>{TAG_ICON[e.tag] ?? <span className="block h-1 w-1 rounded-full bg-slate-dim" />}</span>
                <span className="truncate text-[15px] text-ink/90">{e.title}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-2 text-[15px] text-slate">Nothing written yet today. Open the notebook.</p>
        )}
      </div>
    </section>
  );
}

function Stat({ n, label, red }: { n: number; label: string; red?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-[22px] leading-none tabular-nums ${red ? "text-apple" : "text-ink"}`}><CountUp value={n} /></div>
      <div className="mt-1.5 text-[12px] text-slate">{label}</div>
    </div>
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
