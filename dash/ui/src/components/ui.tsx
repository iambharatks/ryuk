import { ReactNode, useId } from "react";

export const ACCENT = "#C84B31";
export const INK = "#F4F4F6";
export const SLATE = "#8E8E9A";
export const LINE = "#24242C";

// Geometric apple / aperture emblem: an aperture ring with a bite taken out, stem and leaf as two strokes.
export function Emblem({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 6.5c-1.2-2.2-3-3.2-5-3.4" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M16.6 7.2c1.6-2.6 4.4-3.3 6.4-2.6-.6 2.3-3 3.7-6.4 2.6Z" fill={INK} />
      <path
        d="M24.9 12.2A10 10 0 1 0 25.4 22.6"
        stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round"
      />
      <circle cx="16" cy="17.4" r="3.2" stroke={INK} strokeWidth="1.2" />
      <path d="M16 14.2v-3M16 23.8v-3M12.8 17.4h-3M22.2 17.4h-3" stroke={SLATE} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className = "", children, as: As = "section" }: { className?: string; children: ReactNode; as?: any }) {
  return <As className={`card ${className}`}>{children}</As>;
}

export function CardHead({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="card-title mt-2">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`}>
      <span className="live-glow" aria-hidden="true" />
      <span className="absolute inset-0 rounded-full bg-apple animate-pulseDot" />
      <span className="absolute -inset-1 rounded-full bg-apple/20 animate-pulseDot" />
    </span>
  );
}

// Minimal sparkline: line + soft area, last point marked in the accent.
export function Sparkline({ values, w = 220, h = 44, accent = false }: { values: (number | null)[]; w?: number; h?: number; accent?: boolean }) {
  const gid = useId().replace(/:/g, "");
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null) as { i: number; v: number }[];
  if (pts.length < 2) return <div style={{ height: h }} className="flex items-center font-mono text-[10px] text-slate-dim">not enough data yet</div>;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const X = (i: number) => (i / (values.length - 1)) * (w - 6) + 3;
  const Y = (v: number) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 10);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${X(p.i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const stroke = accent ? ACCENT : INK;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${X(last.i)} ${h} L${X(pts[0].i)} ${h} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={stroke} strokeOpacity={accent ? 1 : 0.85} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={X(last.i)} cy={Y(last.v)} r="2.6" fill={ACCENT} />
    </svg>
  );
}

// Radial progress ring.
export function Ring({ value, max, size = 64, label }: { value: number | null; max: number; size?: number; label: string }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} stroke={LINE} strokeWidth="3" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={frac >= 1 ? ACCENT : INK} strokeWidth="3" fill="none"
        strokeDasharray={`${c * frac} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="ring-draw" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="font-mono" fontSize="11" fill={SLATE}>
        {value == null ? "—" : `${Math.round(frac * 100)}%`}
      </text>
    </svg>
  );
}

// Monochrome-first palette for multi-series charts (accent reserved for the highlighted series).
export const SERIES = ["#F4F4F6", "#8E8E9A", "#5E5E6A", "#C84B31", "#B5B5C0", "#41414C", "#D9846F"];

// Stacked bar chart, hand-rolled SVG.
export function StackedBars({ days, series, unit, height = 180, target }: {
  days: string[]; series: { name: string; values: (number | null)[]; color: string }[]; unit: string; height?: number; target?: number;
}) {
  const W = 640, H = height, padL = 34, padB = 22, padT = 8;
  const totals = days.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  const max = Math.max(target ?? 0, ...totals, 1) * 1.08;
  const ticks = niceTicks(max);
  const bw = (W - padL) / days.length;
  const Y = (v: number) => H - padB - (v / ticks.at(-1)!) * (H - padB - padT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${series.map((s) => s.name).join(", ")} per day (${unit})`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={Y(t)} y2={Y(t)} stroke={LINE} strokeWidth="1" />
          <text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize="9.5" fill={SLATE} className="font-mono">{fmt(t)}</text>
        </g>
      ))}
      {target != null && <line x1={padL} x2={W} y1={Y(target)} y2={Y(target)} stroke={ACCENT} strokeDasharray="3 4" strokeWidth="1" />}
      {days.map((d, i) => {
        let acc = 0;
        return (
          <g key={d}>
            {series.map((se) => {
              const v = se.values[i] ?? 0; if (!v) return null;
              const y0 = Y(acc), y1 = Y(acc + v); acc += v;
              return <rect key={se.name} x={padL + i * bw + bw * 0.18} width={bw * 0.64} y={y1} height={Math.max(0, y0 - y1)} fill={se.color} rx="1.5">
                <title>{`${d} · ${se.name}: ${fmt(v)} ${unit}`}</title></rect>;
            })}
            {(i % Math.ceil(days.length / 8) === 0 || i === days.length - 1) &&
              <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="9.5" fill={SLATE} className="font-mono">{d.slice(5).replace("-", "/")}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Multi-line chart with gaps for missing days.
export function Lines({ days, series, min, max, height = 180, unit }: {
  days: string[]; series: { name: string; values: (number | null)[]; color: string }[]; min?: number; max?: number; height?: number; unit: string;
}) {
  const W = 640, H = height, padL = 34, padB = 22, padT = 8;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const lo = min ?? Math.min(0, ...all), hi = max ?? Math.max(1, ...all) * 1.08;
  const ticks = max != null ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : niceTicks(hi);
  const top = ticks.at(-1)!;
  const X = (i: number) => padL + (i + 0.5) * ((W - padL) / days.length);
  const Y = (v: number) => H - padB - ((v - lo) / (top - lo || 1)) * (H - padB - padT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${series.map((s) => s.name).join(", ")} (${unit})`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={Y(t)} y2={Y(t)} stroke={LINE} />
          <text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize="9.5" fill={SLATE} className="font-mono">{fmt(t)}</text>
        </g>
      ))}
      {days.map((d, i) => (i % Math.ceil(days.length / 8) === 0 || i === days.length - 1) &&
        <text key={d} x={X(i)} y={H - 6} textAnchor="middle" fontSize="9.5" fill={SLATE} className="font-mono">{d.slice(5).replace("-", "/")}</text>)}
      {series.map((se) => {
        const segs: string[] = []; let cur = "";
        se.values.forEach((v, i) => { if (v == null) { if (cur) segs.push(cur); cur = ""; } else cur += `${cur ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `; });
        if (cur) segs.push(cur);
        return (
          <g key={se.name}>
            {segs.map((s, k) => <path key={k} d={s} fill="none" stroke={se.color} strokeWidth="1.6" strokeLinejoin="round" />)}
            {se.values.map((v, i) => v != null && <circle key={i} cx={X(i)} cy={Y(v)} r="2.2" fill={se.color}><title>{`${days[i]} · ${se.name}: ${fmt(v)}`}</title></circle>)}
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-slate">
          <span className="h-2 w-2 rounded-sm" style={{ background: it.color }} />{it.name.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function niceTicks(max: number): number[] {
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const n = Math.max(1, Math.ceil(max / step));
  return Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6));
}
export const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString());
