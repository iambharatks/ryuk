import { Activity, BedDouble, BookOpen, Brain, Flame, Sparkles, Zap } from "lucide-react";
import { Ev, hhmm } from "../../data";

export const TAG_ICON: Record<string, JSX.Element> = {
  lift: <Flame size={12} />, move: <Activity size={12} />, sleep: <BedDouble size={12} />, focus: <Brain size={12} />,
  read: <BookOpen size={12} />, energy: <Zap size={12} />, idea: <Sparkles size={12} />,
};

// a steady, per-entry hand wobble between -0.5° and 0.5°
const wobble = (key: string) => ((([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100) / 100) - 0.5).toFixed(2);

export function EventRow({ e, i = 0 }: { e: Ev; i?: number }) {
  const hasDetail = !!(e.detail && e.detail !== e.title);
  const delay = { animationDelay: `${Math.min(i, 14) * 70}ms` };
  return (
    <li className="paper-line group relative rounded-sm transition-colors hover:bg-[rgba(140,110,70,.06)]">
      <div className={`paper-line-row grid grid-cols-[48px_1fr] items-end gap-2 pr-1 ${hasDetail ? "" : "pressed"}`}>
        <span className="pb-[7px] text-right font-mono text-[10.5px] tabular-nums text-paper-ghost">{hhmm(e.at)}</span>
        <p className="ink ink-wipe truncate pb-[5px] font-hand text-[19px] leading-[1.4] md:text-[20px]"
          style={{ ...delay, transform: `rotate(${wobble(e.table + e.id)}deg)`, transformOrigin: "left bottom" }}>
          <span className="paper-tag" title={e.tag}>{TAG_ICON[e.tag]}</span>
          {e.title}
        </p>
      </div>
      {hasDetail && (
        <div className="paper-line-row pressed grid grid-cols-[48px_1fr] items-end gap-2 pr-1">
          <span />
          <p className="ink-wipe truncate pb-[7px] font-hand text-[16px] leading-[1.4] text-paper-ghost" style={delay}>{e.detail}</p>
        </div>
      )}
    </li>
  );
}
