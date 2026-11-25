import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Bookmark, ExternalLink, FileText, Film, Headphones, Image as ImageIcon, Link2, Pencil, Play, Plus, Trash2, Upload, X } from "lucide-react";
import type { LibItem, LibKind, Store } from "../store";

/**
 * The shelf: what you're reading, watching and keeping. Books and PDFs carry a bookmark (current page),
 * videos and audio a timestamp. Moving the bookmark forward is also logged as reading / watching time.
 * Uploaded videos and audio save their position automatically while they play.
 */
const KINDS: { k: LibKind; label: string; Icon: typeof BookOpen }[] = [
  { k: "book", label: "Book", Icon: BookOpen }, { k: "pdf", label: "PDF", Icon: FileText }, { k: "video", label: "Video", Icon: Film },
  { k: "audio", label: "Audio", Icon: Headphones }, { k: "image", label: "Image", Icon: ImageIcon }, { k: "link", label: "Link", Icon: Link2 },
];
const FILTERS = [["all", "All"], ["active", "In progress"], ["wishlist", "Up next"], ["done", "Finished"]] as const;
const TONES = [["#2A1714", "#120B0A"], ["#141B26", "#0A0D12"], ["#1E1C14", "#0F0E0A"], ["#1D1424", "#0E0A12"], ["#12201C", "#090F0D"], ["#24181A", "#100A0B"]];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const timed = (k: LibKind) => k === "video" || k === "audio";
const paged = (k: LibKind) => k === "book" || k === "pdf";

export const fmtClock = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s)) return "–";
  s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
export const parseClock = (v: string): number | null => {
  const p = v.trim().split(":").map((x) => x.trim());
  if (!p.length || p.some((x) => !/^\d+$/.test(x))) return /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) * 60 : null;   // "25" = 25 minutes
  return p.reduce((a, x) => a * 60 + Number(x), 0);
};
const pct = (i: LibItem) => (i.total && i.progress != null ? Math.min(100, Math.round((i.progress / i.total) * 100)) : null);
const youtubeId = (url: string | null) => url?.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/)?.[1] ?? null;
const withTime = (url: string, s: number) => { const id = youtubeId(url); if (id) return `https://www.youtube.com/watch?v=${id}&t=${Math.floor(s)}s`; return url; };
const domain = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };

/** Rough page count straight from the PDF bytes (editable afterwards). */
async function pdfPages(file: File): Promise<number | null> {
  try { const t = new TextDecoder("latin1").decode(await file.arrayBuffer()); const n = (t.match(/\/Type\s*\/Page(?!s)/g) || []).length; return n || null; } catch { return null; }
}
function mediaDuration(file: File): Promise<number | null> {
  return new Promise((res) => {
    const el = document.createElement(file.type.startsWith("audio") ? "audio" : "video");
    const url = URL.createObjectURL(file); el.preload = "metadata"; el.src = url;
    el.onloadedmetadata = () => { res(Number.isFinite(el.duration) ? Math.round(el.duration) : null); URL.revokeObjectURL(url); };
    el.onerror = () => { res(null); URL.revokeObjectURL(url); };
  });
}

function Cover({ item, src }: { item: LibItem; src: string | null }) {
  const [a, b] = TONES[hash(item.title) % TONES.length];
  const p = pct(item);
  if (item.kind === "image" && src) return <img src={src} alt={item.title} className="aspect-[4/3] w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />;
  const yt = item.kind === "video" ? youtubeId(item.url) : null;
  if (yt) return <img src={`https://img.youtube.com/vi/${yt}/hqdefault.jpg`} alt="" className="aspect-[4/3] w-full object-cover opacity-90" loading="lazy" referrerPolicy="no-referrer" />;
  const Icon = KINDS.find((k) => k.k === item.kind)?.Icon ?? BookOpen;
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: `linear-gradient(155deg, ${a}, ${b})` }}>
      {paged(item.kind) && <div className="absolute inset-y-0 left-0 w-3 bg-black/40 shadow-[inset_-1px_0_0_rgba(255,255,255,.06)]" />}
      <div className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: "repeating-linear-gradient(90deg,#fff 0 1px,transparent 1px 6px)" }} />
      <Icon size={18} className="absolute right-3 top-3 text-white/30" />
      <div className="absolute inset-x-5 bottom-4">
        <div className="mb-2 h-px w-8 bg-apple/70" />
        <p className="line-clamp-3 font-serif text-[20px] leading-[1.05] text-ink">{item.title}</p>
        {item.creator && <p className="mt-1 truncate font-mono text-[10px] text-slate">{item.creator}</p>}
      </div>
      {paged(item.kind) && item.progress != null && (
        <div className="absolute -top-1 right-6 flex flex-col items-center" title={`Bookmark at page ${item.progress}`}>
          <div className="flex h-12 w-6 items-end justify-center bg-apple pb-1.5 font-mono text-[8.5px] text-white shadow-[0_6px_10px_-4px_rgba(0,0,0,.7)] [clip-path:polygon(0_0,100%_0,100%_100%,50%_82%,0_100%)]">{p ?? ""}</div>
        </div>
      )}
    </div>
  );
}

function Viewer({ item, src, store, onClose, onSaved }: { item: LibItem; src: string; store: Store; onClose: () => void; onSaved: (i: LibItem) => void }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const last = useRef(item.progress ?? 0);
  const [pos, setPos] = useState(item.progress ?? 0);
  const [page, setPage] = useState(String(item.progress ?? 1));
  const save = async (v: number) => { if (Math.abs(v - last.current) < 5 && timed(item.kind)) return; last.current = v; try { onSaved(await store.progress(item.id, Math.round(v))); } catch { /* retry on next save */ } };
  useEffect(() => {
    if (!timed(item.kind)) return;
    const t = setInterval(() => { const el = ref.current; if (el && !el.paused) save(el.currentTime); }, 15000);
    return () => { clearInterval(t); const el = ref.current; if (el) save(el.currentTime); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[18px] border border-hairline bg-surface" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={item.title}>
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
          <div className="min-w-0"><div className="eyebrow">{item.kind}</div><div className="truncate text-[14px] text-ink">{item.title}</div></div>
          <div className="flex items-center gap-2">
            {timed(item.kind) && <span className="font-mono text-[11px] text-slate">at {fmtClock(pos)} · saves every 15 s</span>}
            {item.kind === "pdf" && (
              <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); const n = Number(page); if (n > 0) save(n); }}>
                <span className="font-mono text-[11px] text-slate">I'm on page</span>
                <input value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ""))} className="field !w-16 !py-1 text-center font-mono" inputMode="numeric" />
                <button className="btn !py-1"><Bookmark size={12} />Mark</button>
              </form>
            )}
            <button className="btn !px-2" onClick={onClose} aria-label="Close"><X size={15} /></button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
          {item.kind === "video" && <video ref={ref} src={src} controls playsInline autoPlay className="max-h-[80vh] w-full" onLoadedMetadata={(e) => { const el = e.currentTarget; if (item.progress) el.currentTime = item.progress; if (!item.total && Number.isFinite(el.duration)) store.editItem(item.id, { total: Math.round(el.duration) }).then(onSaved).catch(() => {}); }} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onPause={(e) => save(e.currentTarget.currentTime)} />}
          {item.kind === "audio" && <div className="w-full p-8"><audio ref={ref} src={src} controls autoPlay className="w-full" onLoadedMetadata={(e) => { if (item.progress) e.currentTarget.currentTime = item.progress; }} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onPause={(e) => save(e.currentTarget.currentTime)} /></div>}
          {item.kind === "pdf" && <iframe title={item.title} src={`${src}#page=${item.progress || 1}`} className="h-[80vh] w-full bg-white" />}
          {item.kind === "image" && <img src={src} alt={item.title} className="max-h-[82vh] w-auto object-contain" />}
        </div>
      </div>
    </div>
  );
}

function Editor({ store, item, onDone, onCancel }: { store: Store; item?: LibItem; onDone: (i: LibItem) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<LibKind>(item?.kind ?? "book");
  const [f, setF] = useState({ title: item?.title ?? "", creator: item?.creator ?? "", url: item?.url ?? "", note: item?.note ?? "",
    total: item?.total != null ? (timed(item.kind) ? fmtClock(item.total) : String(item.total)) : "",
    progress: item?.progress != null ? (timed(item.kind) ? fmtClock(item.progress) : String(item.progress)) : "", status: item?.status ?? "active" });
  const [file, setFile] = useState<File | null>(null);
  const [up, setUp] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const num = (v: string) => (v.trim() === "" ? null : timed(kind) ? parseClock(v) : Number(v.replace(/\D/g, "")) || null);

  const pick = async (fl: File | null) => {
    setFile(fl); setErr("");
    if (!fl) return;
    if (fl.size > 95 * 1024 * 1024) { setErr("Files over 95 MB can't be uploaded. Add it as a link instead."); setFile(null); return; }
    const k: LibKind = fl.type === "application/pdf" ? "pdf" : fl.type.startsWith("video") ? "video" : fl.type.startsWith("audio") ? "audio" : fl.type.startsWith("image") ? "image" : kind;
    setKind(k);
    const title = f.title || fl.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    let total = f.total;
    if (k === "pdf") { const n = await pdfPages(fl); if (n) total = String(n); }
    if (timed(k)) { const d = await mediaDuration(fl); if (d) total = fmtClock(d); }
    setF((x) => ({ ...x, title, total }));
  };

  const save = async () => {
    setErr("");
    if (!f.title.trim()) return setErr("Give it a title.");
    if (f.url && !/^https:\/\//i.test(f.url)) return setErr("Links must start with https://");
    if (f.progress && num(f.progress) == null) return setErr(timed(kind) ? "Time like 25:30 or 1:02:00" : "Page must be a number");
    try {
      let upload: { key: string; mime: string } | null = null;
      if (file) { setUp(0); upload = await store.upload(file, setUp); }
      const v: Partial<LibItem> = { kind, title: f.title.trim(), creator: f.creator.trim() || null, url: f.url.trim() || null, note: f.note.trim() || null,
        total: num(f.total), status: f.status as LibItem["status"], ...(upload ? { file_key: upload.key, mime: upload.mime } : {}) };
      let saved: LibItem;
      if (item) saved = await store.editItem(item.id, v);
      else saved = await store.addItem({ ...v, progress: num(f.progress) });
      const p = num(f.progress);
      if (item && p != null && p !== item.progress) saved = await store.progress(item.id, p);
      onDone(saved);
    } catch (e) { setErr((e as Error).message); setUp(null); }
  };

  const fileOk = kind === "pdf" || kind === "video" || kind === "audio" || kind === "image";
  return (
    <div className="card mb-6 space-y-3 p-5">
      <div className="flex items-center justify-between"><span className="eyebrow">{item ? "Edit" : "Add to the shelf"}</span><button className="btn !px-2" onClick={onCancel} aria-label="Close"><X size={14} /></button></div>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map(({ k, label, Icon }) => (
          <button key={k} onClick={() => setKind(k)} className={`chip flex items-center gap-1.5 ${kind === k ? "!border-apple/60 !text-ink" : ""}`}><Icon size={12} />{label}</button>
        ))}
      </div>
      {fileOk && (
        <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-[13px] ${store.uploads ? "border-hover text-slate hover:border-apple/50" : "border-hairline text-slate-dim"}`}>
          <Upload size={15} className="text-apple" />
          <span className="min-w-0 truncate">{file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : item?.file_key ? "Replace the file (optional)" : store.uploads ? `Upload a ${kind === "pdf" ? "PDF" : kind} (up to 95 MB), or paste a link below` : "Uploads need the R2 bucket (see README). Use a link for now."}</span>
          <input type="file" className="hidden" disabled={!store.uploads} accept={kind === "pdf" ? "application/pdf" : kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "image/*"} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {up != null && <div className="h-1 overflow-hidden rounded bg-hairline"><div className="h-full bg-apple transition-all" style={{ width: `${up}%` }} /></div>}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="field" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <input className="field" placeholder={kind === "book" ? "Author" : kind === "video" ? "Channel / course" : "By (optional)"} value={f.creator} onChange={(e) => setF({ ...f, creator: e.target.value })} />
        {kind !== "image" || !file ? <input className="field sm:col-span-2" placeholder={kind === "link" ? "https://…" : "Link (optional): https://…"} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /> : null}
        {(paged(kind) || timed(kind)) && <>
          <input className="field font-mono" placeholder={paged(kind) ? "Total pages" : "Length, e.g. 1:19:00"} value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} />
          <input className="field font-mono" placeholder={paged(kind) ? "Bookmark: current page" : "Where you are, e.g. 25:30"} value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value })} />
        </>}
        <input className="field sm:col-span-2" placeholder="Note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(["active", "wishlist", "paused", "done"] as const).map((s) => (
            <button key={s} onClick={() => setF({ ...f, status: s })} className={`chip ${f.status === s ? "!border-apple/60 !text-ink" : ""}`}>{s === "active" ? "in progress" : s === "wishlist" ? "up next" : s}</button>
          ))}
        </div>
        <button className="btn !border-apple/60" onClick={save}>{up != null && up < 100 ? `Uploading ${up}%` : item ? "Save" : "Add"}</button>
      </div>
      {err && <p className="text-[12px] text-apple">{err}</p>}
    </div>
  );
}

function ProgressControl({ item, store, onSaved }: { item: LibItem; store: Store; onSaved: (i: LibItem) => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const set = async (n: number | null) => {
    if (n == null || n < 0 || busy) return;
    setBusy(true); try { onSaved(await store.progress(item.id, Math.round(n))); setV(""); } catch { /* shown by parent on reload */ } setBusy(false);
  };
  if (paged(item.kind)) return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); set(Number(v)); }}>
      <button type="button" className="chip" onClick={() => set((item.progress ?? 0) + 10)} disabled={busy}>+10 pp</button>
      <input value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder="page" inputMode="numeric" className="field !w-[72px] !py-1 text-center font-mono text-[12px]" />
      <button className="btn !py-1 !px-2" disabled={busy || !v} aria-label="Move bookmark"><Bookmark size={12} /></button>
    </form>
  );
  if (timed(item.kind)) return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); set(parseClock(v)); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="at 25:30" className="field !w-[88px] !py-1 text-center font-mono text-[12px]" />
      <button className="btn !py-1 !px-2" disabled={busy || !v} aria-label="Save timestamp"><Bookmark size={12} /></button>
    </form>
  );
  return null;
}

export function Shelf({ store, onChanged }: { store: Store; onChanged?: () => void }) {
  const [items, setItems] = useState<LibItem[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LibItem | null>(null);
  const [viewing, setViewing] = useState<LibItem | null>(null);
  const [armDel, setArmDel] = useState<number | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { store.library().then(setItems).catch((e) => { setErr((e as Error).message); setItems([]); }); }, [store]);
  const upsert = (i: LibItem) => { setItems((xs) => { const has = xs?.some((x) => x.id === i.id); return has ? xs!.map((x) => (x.id === i.id ? i : x)) : [i, ...(xs ?? [])]; }); onChanged?.(); };
  const shown = useMemo(() => (items ?? []).filter((i) => filter === "all" || i.status === filter || (filter === "active" && i.status === "paused")), [items, filter]);
  const del = async (i: LibItem) => {
    if (armDel !== i.id) { setArmDel(i.id); setTimeout(() => setArmDel((x) => (x === i.id ? null : x)), 3000); return; }
    try { await store.deleteItem(i.id); setItems((xs) => xs?.filter((x) => x.id !== i.id) ?? null); onChanged?.(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`chip ${filter === k ? "!border-apple/60 !text-ink" : ""}`}>
              {label} <span className="ml-1 text-slate-dim">{(items ?? []).filter((i) => k === "all" || i.status === k || (k === "active" && i.status === "paused")).length}</span>
            </button>
          ))}
        </div>
        <button className="btn !border-apple/60" onClick={() => { setEditing(null); setAdding((a) => !a); }}><Plus size={14} />Add</button>
      </div>
      {adding && <Editor store={store} onCancel={() => setAdding(false)} onDone={(i) => { upsert(i); setAdding(false); }} />}
      {editing && <Editor key={editing.id} store={store} item={editing} onCancel={() => setEditing(null)} onDone={(i) => { upsert(i); setEditing(null); }} />}
      {err && <p className="mb-4 font-mono text-[12px] text-apple">⚠ {err}</p>}
      {!items && <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card aspect-[3/4] animate-pulse" />)}</div>}
      {items && !shown.length && <div className="card p-10 text-center text-sm text-slate">Nothing here yet. Add a book with its current page, a PDF, a video with a timestamp, an image or a link.</div>}
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {shown.map((i) => {
          const src = store.fileUrl(i);
          const p = pct(i);
          const openable = !!src && (i.kind !== "link") && (!!i.file_key || i.kind === "image");
          return (
            <article key={i.id} className="card group flex flex-col overflow-hidden !rounded-[18px]">
              <button className="relative block text-left" onClick={() => (openable ? setViewing(i) : i.url && window.open(paged(i.kind) || !timed(i.kind) ? i.url : withTime(i.url, i.progress ?? 0), "_blank", "noopener"))}
                aria-label={`Open ${i.title}`}>
                <Cover item={i} src={src} />
                {(openable || i.url) && <span className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-ink opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 max-md:opacity-100">
                  {timed(i.kind) ? <Play size={15} /> : openable ? <BookOpen size={15} /> : <ExternalLink size={14} />}</span>}
                {i.status !== "active" && <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-ink/80 backdrop-blur">{i.status === "wishlist" ? "up next" : i.status}</span>}
              </button>
              <div className="flex flex-1 flex-col gap-2 p-4">
                {(i.kind === "image" || i.kind === "link") && <p className="text-[14px] leading-snug text-ink">{i.title}</p>}
                {i.kind === "link" && <p className="truncate font-mono text-[10.5px] text-slate">{domain(i.url)}</p>}
                {(paged(i.kind) || timed(i.kind)) && (
                  <div>
                    <div className="flex justify-between font-mono text-[10.5px] text-slate">
                      <span>{paged(i.kind) ? `p. ${i.progress ?? 0}${i.total ? ` / ${i.total}` : ""}` : `${fmtClock(i.progress ?? 0)}${i.total ? ` / ${fmtClock(i.total)}` : ""}`}</span>
                      <span>{p != null ? `${p}%` : ""}</span>
                    </div>
                    <div className="mt-1.5 h-[3px] overflow-hidden rounded bg-hairline"><div className="h-full bg-apple transition-[width] duration-700" style={{ width: `${p ?? 0}%` }} /></div>
                  </div>
                )}
                {i.note && <p className="line-clamp-2 text-[12px] leading-snug text-slate">{i.note}</p>}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <ProgressControl item={i} store={store} onSaved={upsert} />
                  <div className="ml-auto flex gap-1">
                    {i.url && i.file_key && <a className="btn !px-2 !py-1" href={i.url} target="_blank" rel="noopener noreferrer" aria-label="Open link"><ExternalLink size={12} /></a>}
                    <button className="btn !px-2 !py-1" onClick={() => { setAdding(false); setEditing(i); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label="Edit"><Pencil size={12} /></button>
                    <button className={`btn !px-2 !py-1 ${armDel === i.id ? "!border-apple/70 text-apple" : ""}`} onClick={() => del(i)} aria-label={armDel === i.id ? "Tap again to delete" : "Delete"}>
                      {armDel === i.id ? <span className="font-mono text-[10px]">sure?</span> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {viewing && store.fileUrl(viewing) && <Viewer item={viewing} src={store.fileUrl(viewing)!} store={store} onClose={() => setViewing(null)} onSaved={upsert} />}
    </div>
  );
}
