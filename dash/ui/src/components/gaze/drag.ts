/**
 * Press-and-drag for the goals board and the pin wall, one code path for mouse, pen and touch.
 *   mouse / pen: a drag starts once the pointer moves a few px; a plain click still clicks.
 *   touch: hold ~0.25 s to pick the thing up (onArm: show it lifted), so a swipe still scrolls the page;
 *          then move to drag. Hold longer without moving and `onHold` fires instead (the pin wall's Unpin menu).
 * While dragging near the top or bottom of the screen the page scrolls by itself (a finger can't scroll mid-drag);
 * dx/dy include that scroll, so things follow the finger, not the screen.
 * After a drag, or a touch hold, the click the browser fires on release is swallowed.
 * Elements marked data-nodrag (buttons that do something else) never start a drag.
 */
export type DragCallbacks = {
  onArm?: () => void;
  onStart: () => void;
  onMove: (dx: number, dy: number, x: number, y: number) => void;
  onEnd: (dx: number, dy: number, x: number, y: number) => void;
  onCancel?: () => void;                 // picked up (touch) but let go without moving
  onHold?: (x: number, y: number) => void;
};

const ARM_MS = 250, HOLD_MS = 650, SLOP_MOUSE = 4, SLOP_TOUCH = 8;

const eatNextClick = () => {
  const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
  window.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 60);
};

export function pressDrag(e: React.PointerEvent, cb: DragCallbacks) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag]")) return;
  const touch = e.pointerType === "touch";
  const id = e.pointerId, sx = e.clientX, sy = e.clientY, scroll0 = window.scrollY;
  let armed = !touch, dragging = false, done = false, raf = 0;
  let cx = sx, cy = sy;
  const dx = () => cx - sx, dy = () => cy - sy + (window.scrollY - scroll0);

  const armT = touch ? window.setTimeout(() => { armed = true; cb.onArm?.(); }, ARM_MS) : 0;
  const holdT = touch && cb.onHold ? window.setTimeout(() => { if (!dragging) { finish(); cb.onCancel?.(); cb.onHold!(cx, cy); } }, HOLD_MS) : 0;

  // edge auto-scroll while dragging: faster the closer to the edge
  const tick = () => {
    if (!dragging) return;
    const vh = window.innerHeight, top = Math.min(140, vh * 0.2), bottom = 80;
    const v = cy < top ? -Math.ceil((top - cy) / 6) : cy > vh - bottom ? Math.ceil((cy - (vh - bottom)) / 6) : 0;
    if (v) { const before = window.scrollY; window.scrollBy(0, v); if (window.scrollY !== before) cb.onMove(dx(), dy(), cx, cy); }
    raf = requestAnimationFrame(tick);
  };

  // once armed, keep the page from scrolling under the finger (must be a non-passive listener for iOS)
  const block = (ev: TouchEvent) => { if (armed || dragging) ev.preventDefault(); };
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    cx = ev.clientX; cy = ev.clientY;
    const far = Math.hypot(cx - sx, cy - sy) > (touch ? SLOP_TOUCH : SLOP_MOUSE);
    if (!armed) { if (far) finish(); return; }          // touch moved before the hold: it's a scroll
    if (!dragging && far) {
      dragging = true; clearTimeout(holdT);
      document.documentElement.classList.add("is-dragging-something");
      cb.onStart(); raf = requestAnimationFrame(tick);
    }
    if (dragging) { ev.preventDefault(); cb.onMove(dx(), dy(), cx, cy); }
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    const was = dragging, held = touch && armed;
    cx = ev.clientX; cy = ev.clientY;
    const fdx = dx(), fdy = dy();
    finish();
    if (was) cb.onEnd(fdx, fdy, cx, cy);
    else if (held) cb.onCancel?.();
    if (was || held) eatNextClick();
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    const was = dragging, held = touch && armed;
    const fdx = dx(), fdy = dy();
    finish();
    if (was) cb.onEnd(fdx, fdy, cx, cy); else if (held) cb.onCancel?.();
  };
  function finish() {
    if (done) return;
    done = true; dragging = false;
    clearTimeout(armT); clearTimeout(holdT); cancelAnimationFrame(raf);
    document.documentElement.classList.remove("is-dragging-something");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    document.removeEventListener("touchmove", block);
  }
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  document.addEventListener("touchmove", block, { passive: false });
}
