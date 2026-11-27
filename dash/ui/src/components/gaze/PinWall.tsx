import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { NewPin, Pin } from "../../data";

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

/** Posters tacked to the wall: big images or a quote, a caption, nothing else. */
export function PinWall({ pins, onAdd, onDelete, upload, demo }: {
  pins: Pin[]; onAdd: (p: NewPin) => Promise<void>; onDelete: (id: number) => Promise<void>;
  upload?: (f: File) => Promise<string>; demo: boolean;
}) {
  const [form, setForm] = useState<Prefill | null>(null);
  const openForm = async () => setForm(await readClipboard(!!upload));
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const seen = useRef<Set<number> | null>(null);
  if (seen.current == null) seen.current = new Set(pins.map((p) => p.id));   // pins present at first paint don't animate
  const press = useRef<number | null>(null);

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

  // masonry: as many ~250px columns as fit (2 on phones); pins are dealt left to right so the newest run across the top
  const wall = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(2);
  useEffect(() => {
    const el = wall.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; setCols(w < 600 ? 2 : Math.max(2, Math.floor((w + 28) / (COL_W + 28)))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = pins.slice(0, MAX_ON_WALL);
  const tiles: JSX.Element[] = shown.map((p) => {
    const isNew = !seen.current!.has(p.id);
    return (
      <figure key={p.id}
        className={`poster group ${p.image_url ? "" : "poster-quote"} ${isNew ? "poster-tack" : ""} ${leaving.has(p.id) ? "poster-leave" : ""}`}
        style={{ ["--tilt" as any]: tilt(p.id) }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }); }}
        onTouchStart={(e) => { const t = e.touches[0]; press.current = window.setTimeout(() => setMenu({ id: p.id, x: t.clientX, y: t.clientY }), 550); }}
        onTouchEnd={() => press.current && clearTimeout(press.current)}
        onTouchMove={() => press.current && clearTimeout(press.current)}>
        <span className="poster-pin" aria-hidden="true" />
        <button className="poster-x" onClick={() => unpin(p.id)} aria-label={`Unpin "${p.title}"`}><X size={13} /></button>
        {p.image_url ? (
          <Linked href={p.link}>
            <img src={p.image_url} alt={p.title} loading="lazy" referrerPolicy="no-referrer" className="poster-img" draggable={false} />
          </Linked>
        ) : (
          <blockquote className="poster-text">{p.note || p.title}</blockquote>
        )}
        <figcaption className="poster-cap">{p.title}</figcaption>
      </figure>
    );
  });
  const full = shown.length >= MAX_ON_WALL;
  const columns = Array.from({ length: cols }, (_, c) => tiles.filter((_, i) => i % cols === c));
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
          </div>
        </div>
        <span className="hidden font-mono text-[10px] text-slate-dim md:inline">right-click a pin to unpin</span>
      </div>
      <div ref={wall} className="pin-wall">
        {shown.length
          ? columns.map((col, c) => <div key={c} className="pin-col">{col}</div>)
          : <p className="py-6 text-[15px] text-slate">Nothing pinned yet. Copy an image or a link, then tap + beside the wall.</p>}
      </div>
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
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="block">{children}</a> : <>{children}</>;
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
