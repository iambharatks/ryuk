import { useMemo } from "react";
import { Data, observations } from "../../data";
import { Card, CardHead, LiveDot } from "../ui";
import { Watcher } from "../Lore";

/** The Watcher's Observations — restyled as notes pinned to the page edge. */
export function ObservationsCard({ data }: { data: Data }) {
  const obs = useMemo(() => observations(data), [data]);
  return (
    <Card className="paper-dynamic relative overflow-hidden p-6 md:col-span-12">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-apple/[0.07] blur-3xl candle-glow" />
      <Watcher size={104} className="pointer-events-none absolute -bottom-4 right-2" />
      <CardHead eyebrow="The shinigami's notes · counted from your entries" title="The Watcher's Observations" right={<LiveDot className="mt-1" />} />
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
