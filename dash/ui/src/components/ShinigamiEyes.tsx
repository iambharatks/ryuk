import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { EyeOff } from "lucide-react";
import { Data, Readout, eyesReadouts, shortDay } from "../data";
import { OWNER } from "../config";
import { Scramble, ShinigamiEye } from "./Lore";

const RED = "#FF4A2E";
const fmtN = (v: number | null, d: number) => (v == null ? "—" : d === 0 ? Math.round(v).toLocaleString() : v.toFixed(d));

function RedSpark({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null) as { v: number; i: number }[];
  if (pts.length < 2) return <div className="h-6" />;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const X = (i: number) => (i / (values.length - 1)) * 118 + 1, Y = (v: number) => 22 - ((v - lo) / (hi - lo || 1)) * 18;
  return (
    <svg viewBox="0 0 120 24" className="h-6 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={pts.map((p, k) => `${k ? "L" : "M"}${X(p.i)} ${Y(p.v)}`).join(" ")} fill="none" stroke={RED} strokeOpacity=".8" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ReadoutTile({ r, side, i }: { r: Readout; side: "left" | "right" | "none"; i: number }) {
  const change = r.now != null && r.prev ? ((r.now - r.prev) / Math.abs(r.prev)) * 100 : null;
  const good = change == null ? null : r.better === "up" ? change >= 0 : change <= 0;
  return (
    <div className="eyes-in relative" style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
      {side !== "none" && (
        <span aria-hidden="true" className={`absolute top-[46px] hidden h-px w-10 bg-gradient-to-r lg:block ${side === "left" ? "-right-12 from-[#FF4A2E]/70 to-transparent" : "-left-12 from-transparent to-[#FF4A2E]/70"}`}>
          <span className={`absolute -top-[2px] h-[5px] w-[5px] rounded-full bg-[#FF4A2E] ${side === "left" ? "left-0" : "right-0"}`} />
        </span>
      )}
      <div className={`border-[#3A1410] py-2 ${side === "right" ? "lg:border-l lg:pl-5" : side === "left" ? "lg:border-r lg:pr-5 lg:text-right" : ""}`}>
        <p className="font-gothic text-[22px] leading-none text-[#E9DCD6]">{r.label}</p>
        <p className="mt-1 font-tech text-[44px] leading-none glow-red flicker"><Scramble value={fmtN(r.now, r.digits)} /></p>
        <p className="mt-1 font-tech text-[11px] uppercase tracking-[0.18em] text-[#9C7C74]">
          {r.unit}
          {change != null && <span className={good ? "text-[#E9DCD6]" : "text-[#FF4A2E]"}> · {change >= 0 ? "▲" : "▼"} {Math.abs(Math.round(change))}%</span>}
        </p>
        <div className="mt-1.5 opacity-80"><RedSpark values={r.spark} /></div>
      </div>
    </div>
  );
}

// An original figure: a plain silhouette of the notebook's owner, seen through the eyes.
function Owner() {
  return (
    <svg viewBox="0 0 200 230" className="mx-auto h-[220px] w-auto" aria-hidden="true">
      <defs>
        <radialGradient id="aura" cx="50%" cy="55%" r="55%"><stop offset="0" stopColor="#FF2A10" stopOpacity=".35" /><stop offset="1" stopColor="#FF2A10" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="130" rx="98" ry="100" fill="url(#aura)" />
      <path d="M100 30c-24 0-38 18-38 42 0 18 9 32 21 39-30 7-55 26-61 60l-2 59h160l-2-59c-6-34-31-53-61-60 12-7 21-21 21-39 0-24-14-42-38-42Z"
        fill="#050203" stroke="#FF4A2E" strokeOpacity=".7" strokeWidth="1.2" pathLength={400} className="draw-line" />
    </svg>
  );
}

export function ShinigamiEyes({ open, onClose, data }: { open: boolean; onClose: () => void; data: Data }) {
  const [phase, setPhase] = useState<"closed" | "opening" | "open" | "closing">("closed");
  const [n, setN] = useState(30);
  const { readouts, daysWritten, entries, table } = useMemo(() => eyesReadouts(data, n), [data, n]);
  const yearEntries = useMemo(() => data.daily_counts.reduce((a, c) => a + c.n, 0), [data]);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open && (phase === "closed" || phase === "closing")) { setPhase("opening"); const t = setTimeout(() => setPhase("open"), reduce ? 0 : 1100); return () => clearTimeout(t); }
    if (!open && (phase === "open" || phase === "opening")) { setPhase("closing"); const t = setTimeout(() => setPhase("closed"), reduce ? 0 : 1100); return () => clearTimeout(t); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === "closed") return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [phase, onClose]);

  if (phase === "closed") return null;
  const showContent = true;
  const left = readouts.slice(0, 4), right = readouts.slice(4, 8), rest = readouts.slice(8);
  const miss = (k: string, v: number | null) => v != null && ((k === "sleep" && v < 7) || (k === "protein" && v < 80) || (k === "screen" && v > 60) || (k === "energy" && v < 3));
  const cols: [string, string, number][] = [["sleep", "Sleep h", 1], ["deep", "Deep h", 1], ["protein", "Protein g", 0], ["cardio", "Cardio min", 0], ["screen", "Screen min", 0], ["energy", "Energy", 1]];

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Shinigami eyes">
      {showContent && (
        <div className={`eyes-bg absolute inset-0 overflow-y-auto ${phase === "closing" ? "eyes-out" : "eyes-in"}`}>
          <div className="scanlines pointer-events-none fixed inset-0" />
          <div className="scanbar pointer-events-none fixed inset-x-0 top-0 h-40" />
          <div className="relative mx-auto max-w-[1300px] px-5 pb-20 pt-6 md:px-10">
            {/* header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-4 font-frak text-[46px] leading-none glow-red md:text-[64px]"><ShinigamiEye size={34} className="se-flare" />Shinigami Eyes</h2>
                <p className="mt-2 font-tech text-[12px] uppercase tracking-[0.22em] text-[#9C7C74]">
                  Last {n} days · compared with the {n} before · {daysWritten} of {n} days written · {entries.toLocaleString()} entries
                </p>
              </div>
              <div className="flex items-center gap-2">
                {[7, 30, 90].map((x) => (
                  <button key={x} onClick={() => setN(x)}
                    className={`rounded-md border px-3 py-1.5 font-tech text-[12px] tracking-widest ${n === x ? "border-[#FF4A2E] text-[#FF4A2E]" : "border-[#3A1410] text-[#9C7C74] hover:text-[#E9DCD6]"}`}>{x}D</button>
                ))}
                <button onClick={onClose} className="ml-2 inline-flex items-center gap-2 rounded-md border border-[#3A1410] px-3 py-1.5 font-tech text-[12px] uppercase tracking-widest text-[#E9DCD6] hover:border-[#FF4A2E]">
                  <EyeOff size={13} /> Close the eyes
                </button>
              </div>
            </div>

            {/* the owner, the number above the head, readouts around */}
            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-[1fr_300px_1fr] lg:gap-x-16">
              <div className="order-2 grid grid-cols-1 gap-5 lg:order-1">{left.map((r, i) => <ReadoutTile key={r.key} r={r} side="left" i={i} />)}</div>
              <div className="order-1 col-span-2 flex flex-col items-center justify-center lg:order-2 lg:col-span-1">
                <div className="floaty text-center">
                  <p className="font-frak text-[52px] leading-none tracking-wide glow-red">{OWNER.name}</p>
                  <p className="mt-2 font-tech text-[34px] tracking-[0.35em] glow-red"><Scramble value={String(yearEntries).padStart(6, "0")} /></p>
                  <p className="mt-1 font-tech text-[10px] uppercase tracking-[0.25em] text-[#9C7C74]">entries written this year</p>
                </div>
                <div className="mt-4"><Owner /></div>
              </div>
              <div className="order-3 grid grid-cols-1 gap-5">{right.map((r, i) => <ReadoutTile key={r.key} r={r} side="right" i={i + 4} />)}</div>
            </div>
            {rest.length > 0 && <div className="mx-auto mt-8 max-w-xs text-center">{rest.map((r, i) => <ReadoutTile key={r.key} r={r} side="none" i={i + 8} />)}</div>}

            {/* ledger of days */}
            <section className="eyes-in mt-14" style={{ animationDelay: ".6s" }}>
              <h3 className="font-frak text-[36px] leading-none text-[#E9DCD6]">The Ledger of Days</h3>
              <p className="mt-2 font-tech text-[11px] uppercase tracking-[0.2em] text-[#9C7C74]">Red marks a miss: sleep under 7 h · protein under 80 g · screen over 60 min · energy under 3</p>
              <div className="mt-4 overflow-x-auto border-y border-[#3A1410]">
                <table className="w-full min-w-[640px] font-tech text-[14px]">
                  <thead>
                    <tr className="text-[#9C7C74]">
                      <th className="px-3 py-2.5 text-left font-normal uppercase tracking-widest">Day</th>
                      <th className="px-3 py-2.5 text-right font-normal uppercase tracking-widest">Entries</th>
                      {cols.map(([, l]) => <th key={l} className="px-3 py-2.5 text-right font-normal uppercase tracking-widest">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((row, i) => (
                      <tr key={String(row.day)} className="eyes-in border-t border-[#2A0E0B]" style={{ animationDelay: `${0.7 + i * 0.04}s` }}>
                        <td className="px-3 py-2 text-[#E9DCD6]">{shortDay(String(row.day))}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#E9DCD6]">{row.entries}</td>
                        {cols.map(([k, , d]) => {
                          const v = row[k] as number | null;
                          return <td key={k} className={`px-3 py-2 text-right tabular-nums ${v == null ? "text-[#4A2A24]" : miss(k, v) ? "glow-red" : "text-[#E9DCD6]"}`}>{fmtN(v, d)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-6 text-center font-gothic text-[20px] text-[#9C7C74]">The eyes see only what was written.</p>
            </section>
          </div>
        </div>
      )}
      {/* eyelids + flash, played on open and on close */}
      {(phase === "opening" || phase === "closing") && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="red-flash absolute inset-0 bg-[#B5160A]" />
          <div className="lid-top absolute inset-x-0 top-0 h-1/2 rounded-b-[50%] bg-black shadow-[0_8px_40px_rgba(0,0,0,.9)]" />
          <div className="lid-bottom absolute inset-x-0 bottom-0 h-1/2 rounded-t-[50%] bg-black shadow-[0_-8px_40px_rgba(0,0,0,.9)]" />
        </div>
      )}
    </div>,
    document.body,
  );
}
