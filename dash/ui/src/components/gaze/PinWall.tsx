import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Plus, X } from "lucide-react";
import type { NewPin, Pin } from "../../data";
import { pressDrag } from "./drag";

const MAX_ON_WALL = 12;
const COL_W = 250;      // target column width on the wall (px)
const hash = (n: number) => [...String(n * 2654435761)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const tilt = (id: number) => (((hash(id) % 1000) / 1000) * 4 - 2).toFixed(2) + "deg";

/** What the clipboard held when the pin button was pressed. */
type Prefill = { url?: string; image?: Blob };

/**
 * Read the clipboard on the pin tap (a user gesture, so the browser allows it; it may ask once).
 * An image goes up as an upload; a link fills the image field. Anything else, or a refusal, opens an empty form.
 */
async function readClipboard(canUpload: boolean): Promise<Prefill> {
  const link = (t: string) => { const s = t.trim(); return /^https?:\/\/\S+$/i.test(s) ? { url: s } : {}; };
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        const img = item.types.find((t) => t.startsWith("image/"));
        if (img && canUpload) return { image: await item.getType(img) };
        if (item.types.includes("text/plain")) return link(await (await item.getType("text/plain")).text());
      }
      return {};
    }
    if (navigator.clipboard?.readText) return link(await navigator.clipboard.readText());
  } catch { /* permission refused, empty clipboard or unsupported: open the form empty */ }
  return {};
}

/**
 * Posters tacked to the wall: big images or a quote, a caption, nothing else.
 * Masonry: each pin goes into the shortest column, so columns stay even and pins never overlap.
 * Drag a pin (hold briefly on a phone) to move it; the others make room. "Arrange" packs them as evenly as possible.
 */
export function PinWall({ pins, onAdd, onDelete, onOrder, upload, demo }: {
  pins: Pin[]; onAdd: (p: NewPin) => Promise<void>; onDelete: (id: number) => Promise<void>; onOrder: (ids: number[]) => Promise<void>;
  upload?: (f: File) => Promise<string>; demo: boolean;
}) {
  const [form, setForm] = useState<Prefill | null>(null);
  const openForm = async () => setForm(await readClipboard(!!upload));
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const seen = useRef<Set<number> | null>(null);
  if (seen.current == null) seen.current = new Set(pins.map((p) => p.id));   // pins present at first paint don't animate

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close); window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [menu]);

  const unpin = (id: number) => {
    setMenu(null);
    setLeaving((s) => new Set(s).add(id));
    setTimeout(() => { onDelete(id).finally(() => setLeaving((s) => { const n = new Set(s); n.delete(id); return n; })); }, 260);
  };

  // columns: as many ~250px columns as fit (2 on phones)
  const wall = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(2);
  useEffect(() => {
    const el = wall.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; setCols(w < 600 ? 2 : Math.max(2, Math.floor((w + 28) / (COL_W + 28)))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the order on the wall; while dragging, a live copy that the drag rearranges
  const shown = pins.slice(0, MAX_ON_WALL);
  const [live, setLive] = useState<number[] | null>(null);
  const order = live ?? shown.map((p) => p.id);
  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);

  // measured tile heights (images arrive late), for the shortest-column packing
  const tiles = useRef(new Map<number, HTMLElement>());
  const heights = useRef(new Map<number, number>());
  const [, setTick] = useState(0);
  const measure = () => {
    let changed = false;
    tiles.current.forEach((el, id) => { const h = el.offsetHeight; if (Math.abs((heights.current.get(id) ?? 0) - h) > 1) { heights.current.set(id, h); changed = true; } });
    if (changed) setTick((t) => t + 1);
  };
  useLayoutEffect(measure);

  const gap = cols > 2 ? 30 : 26;
  const cs = Array.from({ length: cols }, () => ({ ids: [] as number[], h: 0 }));
  for (const id of order) {
    const c = cs.reduce((m, x) => (x.h < m.h - 1 ? x : m), cs[0]);
    c.ids.push(id); c.h += (heights.current.get(id) ?? 280) + gap;
  }
  const columns = cs.map((c) => c.ids);
  const layoutKey = columns.map((c) => c.join(".")).join("|");

  // FLIP: when pins change places they glide there instead of jumping (positions relative to the wall, so scrolling never counts)
  const spots = useRef(new Map<number, { x: number; y: number }>());
  useLayoutEffect(() => {
    const w = wall.current?.getBoundingClientRect();
    if (!w) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<number, { x: number; y: number }>();
    tiles.current.forEach((el, id) => {
      const r = el.getBoundingClientRect(), now = { x: r.left - w.left, y: r.top - w.top };
      next.set(id, now);
      const was = spots.current.get(id);
      if (!reduce && was && (Math.abs(was.x - now.x) > 2 || Math.abs(was.y - now.y) > 2) && el.animate)
        el.animate([{ translate: `${was.x - now.x}px ${was.y - now.y}px` }, { translate: "0 0" }], { duration: 280, easing: "cubic-bezier(.3,.8,.3,1)" });
    });
    spots.current = next;
  }, [layoutKey]);

  // dragging: the pin follows your finger as a ghost; its spot on the wall shows where it will land
  const [ghost, setGhost] = useState<{ id: number; x: number; y: number; w: number; ox: number; oy: number } | null>(null);
  const startDrag = (e: React.PointerEvent, id: number) => {
    const el = tiles.current.get(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const start = order;
    let cur = order, over: number | null = null;
    pressDrag(e, {
      onStart: () => { setMenu(null); setLive(start); setGhost({ id, x: r.left, y: r.top, w: r.width, ox, oy }); },
      onMove: (_dx, _dy, x, y) => {
        setGhost((g) => g && { ...g, x: x - ox, y: y - oy });
        const hit = document.elementsFromPoint(x, y).map((n) => (n as HTMLElement).closest?.("[data-pin-id]") as HTMLElement | null).find((n) => n && Number(n.dataset.pinId) !== id);
        const t = hit ? Number(hit.dataset.pinId) : null;
        if (t == null || t === over) return;
        over = t;
        const without = cur.filter((i) => i !== id);
        const at = without.indexOf(t) + (cur.indexOf(id) < cur.indexOf(t) ? 1 : 0);
        cur = [...without.slice(0, at), id, ...without.slice(at)];
        setLive(cur);
      },
      onEnd: () => {
        setGhost(null); setLive(null);
        if (cur.join() !== start.join()) onOrder([...cur, ...pins.slice(MAX_ON_WALL).map((p) => p.id)]);
      },
      onHold: (x, y) => setMenu({ id, x, y }),
    });
  };

  // Arrange: tallest first, each into the shortest column: the columns end as level as greedy packing gets them
  const arrange = () => {
    const ids = [...order].sort((a, b) => (heights.current.get(b) ?? 0) - (heights.current.get(a) ?? 0));
    if (ids.join() !== order.join()) onOrder([...ids, ...pins.slice(MAX_ON_WALL).map((p) => p.id)]);
  };

  const tile = (p: Pin, isGhost = false) => (
    <>
      <span className="poster-pin" aria-hidden="true" />
      {!isGhost && <button data-nodrag className="poster-x" onClick={() => unpin(p.id)} aria-label={`Unpin "${p.title}"`}><X size={13} /></button>}
      {p.image_url ? (
        <Linked href={isGhost ? null : p.link}>
          <img src={p.image_url} alt={p.title} loading="lazy" referrerPolicy="no-referrer" className="poster-img" draggable={false} onLoad={isGhost ? undefined : measure} />
        </Linked>
      ) : (
        <blockquote className="poster-text">{p.note || p.title}</blockquote>
      )}
      <figcaption className="poster-cap">{p.title}</figcaption>
    </>
  );

  const full = shown.length >= MAX_ON_WALL;
  const gp = ghost ? byId.get(ghost.id) : null;
  return (
    <section aria-label="Pin wall" className="mb-10">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="eyebrow">Apples &amp; Omens</div>
          <div className="mt-1 flex items-center gap-3">
            <h2 className="font-serif text-[26px] leading-none text-ink">The wall</h2>
            <button onClick={openForm} disabled={full}
              aria-label="Pin something to the wall (pastes the clipboard)" title={full ? `The wall holds ${MAX_ON_WALL} pins. Unpin one first` : "Pin something (pastes the clipboard)"}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-apple/40 text-ink transition hover:border-apple hover:bg-apple/10 disabled:opacity-30 md:h-8 md:w-8">
              <Plus size={16} />
            </button>
            {shown.length > 2 && (
              <button onClick={arrange} aria-label="Arrange the pins evenly" title="Arrange: pack the pins so the columns come out even"
                className="flex h-11 items-center gap-1.5 rounded-full border border-hairline px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate transition hover:border-hover hover:text-ink md:h-8">
                <LayoutGrid size={13} />Arrange
              </button>
            )}
          </div>
        </div>
        <span className="hidden font-mono text-[10px] text-slate-dim md:inline">drag to move · right-click to unpin</span>
      </div>
      <div ref={wall} className="pin-wall">
        {shown.length
          ? columns.map((col, c) => (
            <div key={c} className="pin-col">
              {col.map((id) => {
                const p = byId.get(id);
                if (!p) return null;
                const isNew = !seen.current!.has(p.id);
                return (
                  <figure key={p.id} data-pin-id={p.id}
                    ref={(el) => { if (el) tiles.current.set(p.id, el); else tiles.current.delete(p.id); }}
                    className={`poster group ${p.image_url ? "" : "poster-quote"} ${isNew ? "poster-tack" : ""} ${leaving.has(p.id) ? "poster-leave" : ""} ${ghost?.id === p.id ? "poster-placeholder" : ""}`}
                    style={{ ["--tilt" as any]: tilt(p.id) }}
                    onPointerDown={(e) => startDrag(e, p.id)}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }); }}>
                    {tile(p)}
                  </figure>
                );
              })}
            </div>
          ))
          : <p className="py-6 text-[15px] text-slate">Nothing pinned yet. Copy an image or a link, then tap + beside the wall.</p>}
      </div>
      {ghost && gp && (
        <figure aria-hidden="true" className={`poster poster-ghost ${gp.image_url ? "" : "poster-quote"}`}
          style={{ left: ghost.x, top: ghost.y, width: ghost.w, ["--tilt" as any]: tilt(gp.id) }}>
          {tile(gp, true)}
        </figure>
      )}
      {menu && (
        <div role="menu" className="fixed z-50 rounded-lg border border-hairline bg-raised py-1 shadow-[0_12px_30px_-8px_rgba(0,0,0,.9)]"
          style={{ left: Math.min(menu.x, window.innerWidth - 140), top: Math.min(menu.y, window.innerHeight - 60) }}>
          <button role="menuitem" className="block min-h-[44px] w-[130px] px-4 text-left text-[13px] text-ink hover:bg-apple/10 md:min-h-0 md:py-2" onClick={() => unpin(menu.id)}>Unpin</button>
        </div>
      )}
      {form && <PinForm demo={demo} prefill={form} upload={upload} onClose={() => setForm(null)} onSave={async (p) => { await onAdd(p); setForm(null); }} />}
    </section>
  );
}

function Linked({ href, children }: { href?: string | null; children: React.ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="block" draggable={false}>{children}</a> : <>{children}</>;
}

function PinForm({ onSave, onClose, demo, prefill, upload }: {
  onSave: (p: NewPin) => Promise<void>; onClose: () => void; demo: boolean; prefill: Prefill; upload?: (f: File) => Promise<string>;
}) {
  const [v, setV] = useState({ title: "", image_url: prefill.url ?? "", quote: "" });
  const [image, setImage] = useState<Blob | null>(prefill.image ?? null);     // a picture pasted from the clipboard
  const preview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) return setErr("Give it a title.");
    if (!image && v.image_url && !/^https:\/\//i.test(v.image_url.trim())) return setErr("The image link must start with https://");
    setBusy(true);
    try {
      let image_url = v.image_url.trim() || undefined;
      if (image && upload) {
        const ext = (image.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
        image_url = await upload(new File([image], `pin-${Date.now()}.${ext}`, { type: image.type || "image/png" }));
      }
      await onSave({ title: v.title.trim(), image_url, quote: v.quote.trim() || undefined });
    }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm safe-pad" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl border border-hairline bg-surface p-5" role="dialog" aria-label="Pin to the wall">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-[22px] text-ink">Pin to the wall</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-slate hover:text-ink md:h-8 md:w-8"><X size={16} /></button>
        </div>
        <input autoFocus className="field" placeholder="Title (required)" maxLength={120} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        {image ? (
          <div className="flex items-center gap-3 rounded-xl border border-hairline p-2">
            <img src={preview} alt="Pasted from the clipboard" className="h-14 w-14 rounded-md object-cover" />
            <span className="flex-1 text-[12px] text-slate">Image from the clipboard</span>
            <button type="button" onClick={() => setImage(null)} aria-label="Remove the pasted image" className="flex h-11 w-11 items-center justify-center rounded-full text-slate hover:text-ink md:h-8 md:w-8"><X size={14} /></button>
          </div>
        ) : (
          <input className="field" placeholder="https://image link (optional)" inputMode="url" value={v.image_url} onChange={(e) => setV({ ...v, image_url: e.target.value })} />
        )}
        <textarea className="field min-h-[80px]" placeholder="A quote, for a text pin (optional)" maxLength={500} value={v.quote} onChange={(e) => setV({ ...v, quote: e.target.value })} />
        {err && <p className="text-[12px] text-apple">{err}</p>}
        <p className="text-[11px] text-slate-dim">{demo ? "Demo mode: pins are not saved." : "A linked image is copied into your own storage when uploads are on, so the wall doesn't depend on the original site."}</p>
        <button disabled={busy} className="btn min-h-[44px] w-full justify-center !border-apple/50 disabled:opacity-40">{busy ? "Pinning…" : "Pin it"}</button>
      </form>
    </div>
  );
}
