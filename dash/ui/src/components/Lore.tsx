import { useEffect, useState } from "react";
import { OWNER } from "../config";
import { Emblem } from "./ui";

/* The Watcher: an original hooded scribe — blank mask, one crimson eye, tattered hem, quill in hand. */
export function Watcher({ size = 120, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 120 150" className={`watcher ${className}`} role="img" aria-label="The Watcher">
      {/* cloak */}
      <path d="M60 8C34 8 22 30 22 54v46c0 8-6 14-12 20 8 2 14-2 18-6 2 8 8 12 14 10-2-6 2-10 6-12 4 6 10 8 12 8s8-2 12-8c4 2 8 6 6 12 6 2 12-2 14-10 4 4 10 8 18 6-6-6-12-12-12-20V54C98 30 86 8 60 8Z"
        fill="#22222B" stroke="#4A4A56" strokeWidth="1.2" />
      <path d="M28 104c8 6 20 10 32 10s24-4 32-10" stroke="#C84B31" strokeOpacity=".35" strokeWidth="1" fill="none" />
      {/* hood shadow */}
      <path d="M60 18c-17 0-27 14-27 32 0 14 10 26 27 26s27-12 27-26c0-18-10-32-27-32Z" fill="#0B0B0E" />
      {/* mask */}
      <g className="watcher-mask">
        <path d="M60 28c-11 0-18 9-18 21 0 13 8 22 18 22s18-9 18-22c0-12-7-21-18-21Z" fill="#E9E7E2" />
        <path d="M50 46h7M63 46h7" stroke="#9A988F" strokeWidth="1" strokeLinecap="round" />
        <g className="watcher-eye">
          <ellipse cx="66.5" cy="49.5" rx="3.6" ry="3.6" fill="#C84B31" />
          <circle cx="67.6" cy="48.4" r="0.9" fill="#F4F4F6" />
        </g>
        <path d="M53 50.5c0 5-1 9-2 13M55.5 51c0 4 0 7-1 10" stroke="#6E6C66" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      </g>
      {/* quill hand */}
      <g className="watcher-quill">
        <path d="M84 92c6-2 10 2 9 7-1 4-6 5-10 3" fill="#E9E7E2" />
        <path d="M92 96 110 64c2-4 5-6 7-6-1 3-2 7-5 10L95 99" fill="#2A2A33" stroke="#8E8E9A" strokeWidth="0.8" />
        <path d="M92 97l-2 4" stroke="#C84B31" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* Opening animation: the notebook cover parts once per session. */
export function NotebookIntro() {
  const [show, setShow] = useState(() => {
    try { return !sessionStorage.getItem("ryuk-opened") && !matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  });
  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem("ryuk-opened", "1"); } catch {}
    const t = setTimeout(() => setShow(false), 2600);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div className="intro fixed inset-0 z-[60] flex items-center justify-center" aria-hidden="true" onClick={() => setShow(false)}>
      <div className="intro-left absolute inset-y-0 left-0 w-1/2 border-r border-hairline bg-[#0E0E12]" />
      <div className="intro-right absolute inset-y-0 right-0 w-1/2 bg-[#0E0E12]" />
      <div className="intro-title relative text-center">
        <Watcher size={130} className="mx-auto" />
        <p className="mt-6 font-frak text-[84px] leading-none tracking-[0.1em] text-ink">RYUK</p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.4em] text-slate">the notebook is open</p>
        <p className="mt-6 font-serif text-[20px] italic text-ink/80">It belongs to {OWNER.name}.</p>
      </div>
    </div>
  );
}

/* A falling apple, played when something is inscribed. */
export function AppleDrop({ run }: { run: number }) {
  if (!run) return null;
  return (
    <div key={run} className="apple-drop pointer-events-none fixed left-1/2 top-0 z-[70]" aria-hidden="true">
      <svg width="34" height="40" viewBox="0 0 34 40">
        <path d="M17 9c-2-5-6-7-9-7" stroke="#8E8E9A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M18 8c3-4 8-5 11-3-2 4-6 5-11 3Z" fill="#5E7A55" />
        <path d="M17 11c-4-3-15-2-15 10 0 10 7 18 12 18 2 0 2-1 3-1s1 1 3 1c5 0 12-8 12-18 0-12-11-13-15-10Z" fill="#C84B31" />
        <path d="M9 18c-1 3-1 6 0 8" stroke="#F4F4F6" strokeOpacity=".45" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/* Drifting ash in the background. */
export function Ash() {
  const motes = Array.from({ length: 18 }, (_, i) => ({
    left: (i * 53) % 100, delay: (i * 1.7) % 14, dur: 16 + ((i * 7) % 12), size: 1 + (i % 3),
  }));
  return (
    <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden" aria-hidden="true">
      {motes.map((m, i) => (
        <span key={i} className="ash absolute bottom-[-10px] rounded-full bg-slate/40"
          style={{ left: `${m.left}%`, width: m.size, height: m.size, animationDelay: `${m.delay}s`, animationDuration: `${m.dur}s` }} />
      ))}
    </div>
  );
}

/* Rules of the notebook: original rules for this app, rotating. */
export const RULES = [
  "The human whose hours are written in this notebook shall see where those hours went.",
  "An entry about yesterday must name yesterday, or it will be recorded as today.",
  "A day left unwritten is not lost, but the notebook remembers the silence.",
  "When fewer than seven hours of sleep are written, the next day's energy will be watched closely.",
  "What is written may be corrected in the Ledger, yet the original words are never erased.",
  "The owner may write in any language. The shinigami reads them all.",
  "A pact kept for seven unbroken days turns its mark red.",
  "Nothing written here leaves the notebook unless its owner carries it out.",
  "The shinigami does not judge. It only counts.",
  "Several deeds may be written in a single line; each will be recorded separately.",
];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export function RuleOfTheNote() {
  const [i, setI] = useState(() => new Date().getDate() % RULES.length);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % RULES.length), 14000); return () => clearInterval(t); }, []);
  return (
    <figure className="max-w-md border-l border-apple/50 pl-4" aria-live="polite">
      <figcaption className="eyebrow">How to use it · Rule {ROMAN[i]}</figcaption>
      <blockquote key={i} className="ink-in mt-2 font-serif text-[17px] italic leading-snug text-ink/85">{RULES[i]}</blockquote>
    </figure>
  );
}

/* Ryuk's notebook: an original black-leather journal with a crimson ribbon. Tilts toward the cursor; click to write. */
export function NotebookCover({ pages, apples, onOpen }: { pages: number; apples: number; onOpen: () => void }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  return (
    <button onClick={onOpen} aria-label="Open the notebook and write"
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -14, y: ((e.clientX - r.left) / r.width - 0.5) * 18 }); }}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      className="notebook group relative h-[212px] w-[160px] shrink-0 [perspective:900px]">
      <div className="relative h-full w-full transition-transform duration-300 ease-out [transform-style:preserve-3d]"
        style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}>
        {/* page edges */}
        <div className="absolute inset-y-[6px] -right-[5px] w-[8px] rounded-r-sm bg-[repeating-linear-gradient(180deg,#d9d6cf_0_1px,#a9a69e_1px_3px)] opacity-80" />
        {/* cover */}
        <div className="notebook-cover absolute inset-0 overflow-hidden rounded-r-[10px] rounded-l-[4px] border border-[#2A2A33] shadow-[0_24px_50px_-18px_rgba(0,0,0,.9)]">
          <div className="absolute inset-y-0 left-0 w-[16px] bg-[#09090B] shadow-[inset_-1px_0_0_#24242C]">
            <div className="absolute inset-y-3 left-[7px] border-l border-dashed border-[#2F2F38]" />
          </div>
          <div className="absolute inset-[10px] left-[24px] rounded-[6px] border border-[#2A2A33]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center pl-3">
            <Emblem size={34} />
            <p className="mt-3 font-frak text-[30px] tracking-[0.16em] text-ink/90">RYUK</p>
            <p className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.3em] text-slate">Vol. I · {new Date().getFullYear()}</p>
          </div>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3 pl-3 font-mono text-[9px] text-slate">
            <span>{pages.toLocaleString()} entries</span>
            <span className="flex items-center gap-1" title="One apple for each day this month with 8 or more entries"><MiniApple />{apples}</span>
          </div>
          {/* sheen */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgba(255,255,255,.05)_45%,transparent_60%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        </div>
        {/* ribbon bookmark */}
        <div className="ribbon absolute -bottom-[30px] left-[30px] h-[31px] w-[9px] origin-top bg-apple [clip-path:polygon(0_0,100%_0,100%_100%,50%_82%,0_100%)]" />
      </div>
      <span className="pointer-events-none absolute -bottom-12 left-[62%] -translate-x-1/2 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.2em] text-slate opacity-0 transition-opacity group-hover:opacity-100">open to write</span>
    </button>
  );
}

export function MiniApple({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 34 40" aria-hidden="true">
      <path d="M18 8c3-4 8-5 11-3-2 4-6 5-11 3Z" fill="#5E7A55" />
      <path d="M17 11c-4-3-15-2-15 10 0 10 7 18 12 18 2 0 2-1 3-1s1 1 3 1c5 0 12-8 12-18 0-12-11-13-15-10Z" fill="#C84B31" />
    </svg>
  );
}

/* Numbers that flicker through random digits before settling, as if read by shinigami eyes. */
export function Scramble({ value, className = "" }: { value: string; className?: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const settle = Math.floor((frame / 14) * value.length);
      setShown(value.split("").map((c, i) => (i < settle || !/[0-9]/.test(c) ? c : String(Math.floor(Math.random() * 10)))).join(""));
      if (frame >= 14) { clearInterval(id); setShown(value); }
    }, 45);
    return () => clearInterval(id);
  }, [value]);
  return <span className={`tabular-nums ${className}`}>{shown}</span>;
}

/* Shinigami eye: almond eye, blood-red iris with a dark limbal ring, slit pupil, glow; blinks and flares on hover. */
export function ShinigamiEye({ size = 22, open = true, className = "" }: { size?: number; open?: boolean; className?: string }) {
  const id = "se" + size;
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 48 30" className={`shinigami-eye ${open ? "" : "se-shut"} ${className}`} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-iris`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#FFB199" />
          <stop offset=".28" stopColor="#FF3B1F" />
          <stop offset=".72" stopColor="#B3120A" />
          <stop offset="1" stopColor="#3A0402" />
        </radialGradient>
        <clipPath id={`${id}-clip`}><path d="M2 15C9 5 17 2 24 2s15 3 22 13c-7 10-15 13-22 13S9 25 2 15Z" /></clipPath>
      </defs>
      <path className="se-glow" d="M2 15C9 5 17 2 24 2s15 3 22 13c-7 10-15 13-22 13S9 25 2 15Z" fill="#FF2A10" opacity=".25" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="48" height="30" fill="#0A0405" />
        <g className="se-iris">
          <circle cx="24" cy="15" r="10.5" fill={`url(#${id}-iris)`} />
          <circle cx="24" cy="15" r="10.5" fill="none" stroke="#1A0201" strokeWidth="1.6" />
          {/* iris fibres */}
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return <line key={i} x1={24 + Math.cos(a) * 4.5} y1={15 + Math.sin(a) * 4.5} x2={24 + Math.cos(a) * 9.4} y2={15 + Math.sin(a) * 9.4} stroke="#5A0603" strokeOpacity=".55" strokeWidth=".5" />;
          })}
          <circle cx="24" cy="15" r="6.2" fill="none" stroke="#FF7A5C" strokeOpacity=".5" strokeWidth=".5" />
          <ellipse className="se-pupil" cx="24" cy="15" rx="1.6" ry="6.4" fill="#050000" />
          <circle cx="27.5" cy="10.8" r="1.6" fill="#FFFFFF" opacity=".85" />
        </g>
        {/* eyelids for the blink */}
        <rect className="se-lid-top" x="0" y="-30" width="48" height="30" fill="#0B0B0E" />
        <rect className="se-lid-bot" x="0" y="30" width="48" height="30" fill="#0B0B0E" />
      </g>
      <path d="M2 15C9 5 17 2 24 2s15 3 22 13c-7 10-15 13-22 13S9 25 2 15Z" fill="none" stroke="#FF4A2E" strokeWidth="1.3" />
      <path d="M6 9.5C12 3.5 18 1.5 24 1.5s12 2 18 8" fill="none" stroke="#FF4A2E" strokeOpacity=".5" strokeWidth=".8" />
    </svg>
  );
}
