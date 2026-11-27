/**
 * Press-and-drag for the goals board and the pin wall, one code path for mouse, pen and touch.
 *   mouse / pen: a drag starts once the pointer moves a few px; a plain click still clicks.
 *   touch: hold ~0.25 s to pick the thing up (so a swipe still scrolls the page); move to drag.
 *          Hold longer without moving and `onHold` fires instead (the pin wall's Unpin menu).
 * After a drag the click that the browser fires on release is swallowed, so dropping a note never toggles it.
 * Elements marked data-nodrag (buttons that do something else) never start a drag.
 */
export type DragCallbacks = {
  onStart: () => void;
  onMove: (dx: number, dy: number, x: number, y: number) => void;
  onEnd: (dx: number, dy: number, x: number, y: number) => void;
  onHold?: (x: number, y: number) => void;
};

const ARM_MS = 250, HOLD_MS = 650, SLOP_MOUSE = 4, SLOP_TOUCH = 8;

export function pressDrag(e: React.PointerEvent, cb: DragCallbacks) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag]")) return;
  const touch = e.pointerType === "touch";
  const id = e.pointerId, sx = e.clientX, sy = e.clientY;
  let armed = !touch, dragging = false, done = false;
  let lx = sx, ly = sy;

  const armT = touch ? window.setTimeout(() => { armed = true; navigator.vibrate?.(8); }, ARM_MS) : 0;
  const holdT = touch && cb.onHold ? window.setTimeout(() => { if (!dragging) { finish(); cb.onHold!(lx, ly); } }, HOLD_MS) : 0;

  // once armed, keep the page from scrolling under the finger (must be a non-passive listener for iOS)
  const block = (ev: TouchEvent) => { if (armed || dragging) ev.preventDefault(); };
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    lx = ev.clientX; ly = ev.clientY;
    const dx = lx - sx, dy = ly - sy, far = Math.hypot(dx, dy) > (touch ? SLOP_TOUCH : SLOP_MOUSE);
    if (!armed) { if (far) finish(); return; }          // touch moved before the hold: it's a scroll
    if (!dragging && far) { dragging = true; clearTimeout(holdT); cb.onStart(); }
    if (dragging) { ev.preventDefault(); cb.onMove(dx, dy, lx, ly); }
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    const was = dragging;
    finish();
    if (was) {
      cb.onEnd(ev.clientX - sx, ev.clientY - sy, ev.clientX, ev.clientY);
      // swallow the click the browser sends right after a drag
      const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 50);
    }
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    const was = dragging;
    finish();
    if (was) cb.onEnd(lx - sx, ly - sy, lx, ly);
  };
  function finish() {
    if (done) return;
    done = true;
    clearTimeout(armT); clearTimeout(holdT);
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
