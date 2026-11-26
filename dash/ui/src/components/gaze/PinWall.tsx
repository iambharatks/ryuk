import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { NewPin, Pin } from "../../data";

const MAX_ON_WALL = 12;
const hash = (n: number) => [...String(n * 2654435761)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const tilt = (id: number) => (((hash(id) % 1000) / 1000) * 4 - 2).toFixed(2) + "deg";

/** Posters tacked to the wall: big images or a quote, a caption, nothing else. */
export function PinWall({ pins, onAdd, onDelete, demo }: {
  pins: Pin[]; onAdd: (p: NewPin) => Promise<void>; onDelete: (id: number) => Promise<void>; demo: boolean;
}) {
  const [form, setForm] = useState(false);
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

  const shown = pins.slice(0, MAX_ON_WALL);
  return (
    <section aria-label="Pin wall" className="mb-10">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="eyebrow">Apples &amp; Omens</div>
          <h2 className="mt-1 font-serif text-[26px] leading-none text-ink">The wall</h2>
        </div>
        <span className="hidden font-mono text-[10px] text-slate-dim md:inline">right-click a pin to unpin</span>
      </div>
      <div className="pin-wall">
        {shown.map((p) => {
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
        })}
        {shown.length < MAX_ON_WALL && (
          <button className="poster poster-add" onClick={() => setForm(true)} aria-label="Pin something to the wall">
            <Plus size={22} /><span className="font-mono text-[10px] uppercase tracking-[0.18em]">pin</span>
          </button>
        )}
      </div>
      {menu && (
        <div role="menu" className="fixed z-50 rounded-lg border border-hairline bg-raised py-1 shadow-[0_12px_30px_-8px_rgba(0,0,0,.9)]"
          style={{ left: Math.min(menu.x, window.innerWidth - 140), top: Math.min(menu.y, window.innerHeight - 60) }}>
          <button role="menuitem" className="block min-h-[44px] w-[130px] px-4 text-left text-[13px] text-ink hover:bg-apple/10 md:min-h-0 md:py-2" onClick={() => unpin(menu.id)}>Unpin</button>
        </div>
      )}
      {form && <PinForm demo={demo} onClose={() => setForm(false)} onSave={async (p) => { await onAdd(p); setForm(false); }} />}
    </section>
  );
}

function Linked({ href, children }: { href?: string | null; children: React.ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="block">{children}</a> : <>{children}</>;
}

function PinForm({ onSave, onClose, demo }: { onSave: (p: NewPin) => Promise<void>; onClose: () => void; demo: boolean }) {
  const [v, setV] = useState({ title: "", image_url: "", quote: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) return setErr("Give it a title.");
    if (v.image_url && !/^https:\/\//i.test(v.image_url.trim())) return setErr("The image link must start with https://");
    setBusy(true);
    try { await onSave({ title: v.title.trim(), image_url: v.image_url.trim() || undefined, quote: v.quote.trim() || undefined }); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl border border-hairline bg-surface p-5" role="dialog" aria-label="Pin to the wall">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-[22px] text-ink">Pin to the wall</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-slate hover:text-ink md:h-8 md:w-8"><X size={16} /></button>
        </div>
        <input autoFocus className="field" placeholder="Title (required)" maxLength={120} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        <input className="field" placeholder="https://image link (optional)" inputMode="url" value={v.image_url} onChange={(e) => setV({ ...v, image_url: e.target.value })} />
        <textarea className="field min-h-[80px]" placeholder="A quote, for a text pin (optional)" maxLength={500} value={v.quote} onChange={(e) => setV({ ...v, quote: e.target.value })} />
        {err && <p className="text-[12px] text-apple">{err}</p>}
        <p className="text-[11px] text-slate-dim">{demo ? "Demo mode: pins are not saved." : "A linked image is copied into your own storage when uploads are on, so the wall doesn't depend on the original site."}</p>
        <button disabled={busy} className="btn min-h-[44px] w-full justify-center !border-apple/50 disabled:opacity-40">{busy ? "Pinning…" : "Pin it"}</button>
      </form>
    </div>
  );
}
