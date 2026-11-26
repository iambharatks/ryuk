import { ReactNode } from "react";

/**
 * Paper primitives — death-note-inspired aesthetic.
 * Every card on Gaze looks like a page, a scrap, or an object on the desk.
 *
 * Variants:
 *   leather  — the black notebook cover (default card look, dark surface)
 *   page     — a torn cream page with ruled lines and a red margin
 *   scrap    — a smaller torn scrap, slight rotation, no ruled lines
 *   pinned   — paper stuck to the desk with a pin/tape
 */

type PaperProps = {
  variant?: "leather" | "page" | "scrap" | "pinned";
  tilt?: number;        // degrees, random-ish rotation for scrap/pinned
  ruled?: boolean;      // ruled lines on page/scrap
  margin?: boolean;     // red margin line on page
  pin?: "tape" | "pin" | null; // decoration for pinned variant
  className?: string;
  children?: ReactNode;
};

export function Paper({
  variant = "page", tilt = 0, ruled = true, margin = false, pin = null, className = "", children,
}: PaperProps) {
  if (variant === "leather") {
    return <div className={`card ${className}`}>{children}</div>;
  }
  const style: React.CSSProperties = tilt ? { transform: `rotate(${tilt}deg)` } : {};
  const base = variant === "pinned" ? "paper-scrap paper-pinned" : variant === "scrap" ? "paper-scrap" : "paper-page";
  return (
    <div className={`${base} relative ${className}`} style={style}>
      {margin && <span className="paper-margin" aria-hidden="true" />}
      {ruled && <span className="paper-rules" aria-hidden="true" />}
      {pin === "tape" && <span className="paper-tape" aria-hidden="true" />}
      {pin === "pin" && <span className="paper-pin" aria-hidden="true" />}
      <div className="relative">{children}</div>
    </div>
  );
}

/** Handwriting — Nothing You Could Do font with ink filter on dark paper. */
export function Handwriting({ children, className = "", as: As = "span", size = "md" }: {
  children: ReactNode; className?: string; as?: any; size?: "sm" | "md" | "lg" | "xl";
}) {
  const sz = size === "sm" ? "text-[14px]" : size === "md" ? "text-[18px]" : size === "lg" ? "text-[24px]" : "text-[32px]";
  return <As className={`font-hand text-paper-ink leading-[1.15] ${sz} ${className}`}>{children}</As>;
}

/** Ink strike — a red diagonal/horizontal line drawn over a word, by stroke-dashoffset. */
export function InkStrike({ className = "" }: { className?: string }) {
  return (
    <svg className={`absolute inset-0 w-full h-full pointer-events-none ${className}`} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <path className="paper-strike" d="M1 6 Q 25 2, 50 5 T 99 4" stroke="#8a1c12" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Tally marks — small ink strokes for "carried N times" indicators. */
export function TallyMarks({ n, className = "" }: { n: number; className?: string }) {
  const groups = Math.floor(n / 5);
  const rem = n % 5;
  return (
    <span className={`inline-flex items-end gap-1 ${className}`} aria-label={`${n} tally`}>
      {Array.from({ length: groups }).map((_, i) => (
        <svg key={i} width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
          <path d="M2 1 V11 M5 1 V11 M8 1 V11 M11 1 V11 M0 9 L16 3" stroke="#15120e" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </svg>
      ))}
      {rem > 0 && (
        <svg width={rem * 3 + 2} height="12" viewBox={`0 0 ${rem * 3 + 2} 12`} aria-hidden="true">
          {Array.from({ length: rem }).map((_, i) => <line key={i} x1={2 + i * 3} x2={2 + i * 3} y1="1" y2="11" stroke="#15120e" strokeWidth="1.1" strokeLinecap="round" />)}
        </svg>
      )}
    </span>
  );
}

/** Wax seal — a crimson stamped circle with an emblem, pressed with a squash on first appearance. */
export function WaxSeal({ size = 44, children }: { size?: number; children?: ReactNode }) {
  return (
    <span className="wax-seal relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-gradient-radial from-[#8a1c12] via-[#5a1208] to-[#2a0803]"
        style={{ background: "radial-gradient(circle at 35% 30%, #c84b31 0%, #8a1c12 45%, #3a0a04 90%)", boxShadow: "inset -2px -4px 6px rgba(0,0,0,.55), inset 3px 3px 5px rgba(255,255,255,.15), 0 2px 4px rgba(0,0,0,.6)" }} />
      <span className="relative font-frak text-ink/90" style={{ fontSize: size * 0.4 }}>{children ?? "R"}</span>
    </span>
  );
}

/** Ink blot — an irregular spreading ink splatter; marks a broken pact's day. */
export function InkBlot({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={`ink-blot ${className}`} aria-hidden="true">
      <path d="M20 4 C 13 6, 8 11, 7 17 C 4 20, 3 25, 6 29 C 8 34, 15 36, 20 34 C 25 38, 32 34, 33 28 C 37 25, 36 17, 31 14 C 30 7, 25 3, 20 4 Z"
        fill="#15120e" opacity="0.88" />
      <circle cx="12" cy="30" r="1.5" fill="#15120e" opacity="0.7" />
      <circle cx="34" cy="18" r="1.1" fill="#15120e" opacity="0.6" />
      <circle cx="8" cy="12" r="0.9" fill="#15120e" opacity="0.5" />
    </svg>
  );
}
