import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MiniApple } from "../Lore";
import cover from "../../assets/notebook-cover.jpg";

type Line = { at: string; text: string };
type Rect = { top: number; left: number; width: number; height: number };

/**
 * NotebookDeck — the closed notebook lying on the desk in Gaze.
 * Click: a centred overlay copy starts exactly over the desk notebook (FLIP via transform),
 * flies to the centre, the cover lifts on its spine, the page beneath fades in and
 * today's lines write themselves in. The parent then switches to the Page view.
 * Everything animated is transform / opacity / clip-path; React only toggles classes.
 */
export function NotebookDeck({ pages, apples, lines, opening, onOpen }: {
  pages: number; apples: number; lines: Line[]; opening: boolean; onOpen: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [from, setFrom] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (opening && anchor.current) {
      const r = anchor.current.getBoundingClientRect();
      setFrom({ top: r.top, left: r.left, width: r.width, height: r.height });
    } else if (!opening) setFrom(null);
  }, [opening]);

  return (
    <>
      <button ref={anchor} onClick={onOpen} disabled={opening} aria-label="Open the notebook and write"
        className={`notebook-deck group relative mx-auto block w-full max-w-[180px] ${opening ? "invisible" : ""}`} style={{ aspectRatio: COVER_RATIO }}>
        <ClosedNotebook pages={pages} apples={apples} />
        <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate opacity-60 transition-opacity group-hover:opacity-100 sm:-bottom-7 sm:text-[9.5px] sm:tracking-[0.2em]">
          tap to open
        </span>
      </button>
      {from && opening && createPortal(<OpeningOverlay from={from} pages={pages} apples={apples} lines={lines} />, document.body)}
    </>
  );
}

const COVER_RATIO = 3 / 4;     // the portrait cover, cropped shorter around its title

function CoverFace({ pages, apples }: { pages: number; apples: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[4px] border border-[#1c1c20] bg-black">
      <img src={cover} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-cover object-[50%_18%]" />
      {/* spine: a thin dark line with a faint highlight beside it */}
      <div className="absolute inset-y-0 left-[8px] w-[2px] bg-[#050505] shadow-[1px_0_0_rgba(255,255,255,.07)]" />
      <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2 whitespace-nowrap pl-[10px] font-mono text-[8px] text-slate sm:bottom-3 sm:gap-4 sm:text-[9.5px]">
        <span>{pages.toLocaleString()} entries</span>
        <span className="flex items-center gap-1" title="One apple for each day this month with 8 or more entries"><MiniApple />{apples}</span>
      </div>
    </div>
  );
}

function ClosedNotebook({ pages, apples }: { pages: number; apples: number }) {
  return (
    <div className="notebook-deck-body relative h-full w-full">
      {/* page block peeking out from under the cover */}
      <div className="absolute inset-y-[6px] -right-[6px] left-[4px] rounded-r-[6px] rounded-l-[2px] bg-[linear-gradient(90deg,#d8d2c1_0%,#b8b2a1_60%,#a09a89_100%)] shadow-[0_18px_40px_-16px_rgba(0,0,0,.9)]" />
      <div className="absolute inset-y-[9px] -right-[2px] left-[5px] rounded-r-[5px] rounded-l-[2px] bg-[repeating-linear-gradient(180deg,#d8d2c1_0_1px,#b4ae9d_1px_2px)]" />
      <div className="notebook-deck-cover absolute inset-0"><CoverFace pages={pages} apples={apples} /></div>
      <div className="ribbon absolute -bottom-[16px] right-[12px] h-[16px] w-[7px] sm:-bottom-[30px] sm:right-[20px] sm:h-[30px] sm:w-[9px] origin-top bg-apple [clip-path:polygon(0_0,100%_0,100%_100%,50%_82%,0_100%)]" />
    </div>
  );
}

function OpeningOverlay({ from, pages, apples, lines }: { from: Rect; pages: number; apples: number; lines: Line[] }) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const height = Math.min(760, vh * 0.86, (vw * 0.9) / COVER_RATIO);
  const width = height * COVER_RATIO;
  const left = (vw - width) / 2, top = (vh - height) / 2;
  const style = {
    left, top, width, height,
    "--dx": `${from.left - left}px`, "--dy": `${from.top - top}px`, "--s": String(from.width / width),
  } as React.CSSProperties;
  const shown = lines.slice(-5);
  return (
    <>
      <div className="notebook-backdrop" aria-hidden="true" />
      <div className="notebook-open pointer-events-none" style={style} aria-hidden="true">
        <div className="nb-page paper-page overflow-hidden" style={{ paddingLeft: 40, paddingTop: 22 }}>
          <span className="paper-margin" />
          <div className="relative font-mono text-[10px] uppercase tracking-[0.22em] text-paper-ghost">Today's page</div>
          <ol className="paper-ruled-scroll relative mt-2">
            {shown.length ? shown.map((l, i) => (
              <li key={i} className="paper-line-row pressed grid grid-cols-[48px_1fr] items-end gap-2">
                <span className="pb-[7px] text-right font-mono text-[10.5px] text-paper-ghost">{l.at}</span>
                <span className="nb-line ink truncate pb-[5px] font-hand text-[20px]" style={{ animationDelay: `${550 + i * 70}ms` }}>{l.text}</span>
              </li>
            )) : (
              <li className="paper-line-row grid grid-cols-[48px_1fr] items-end gap-2">
                <span />
                <span className="nb-line pb-[5px] font-hand text-[20px] text-paper-ghost" style={{ animationDelay: "550ms" }}>nothing written yet…</span>
              </li>
            )}
          </ol>
        </div>
        <div className="nb-cover"><CoverFace pages={pages} apples={apples} /></div>
      </div>
    </>
  );
}
