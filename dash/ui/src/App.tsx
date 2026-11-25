import { useCallback, useEffect, useMemo, useState } from "react";
import { Command, PenLine, RefreshCw } from "lucide-react";
import { ShinigamiEyes } from "./components/ShinigamiEyes";
import { Data, apiAddPin, apiCapture, apiRow, demoData, fetchData } from "./data";
import { DeathPage } from "./components/DeathPage";
import { Shelf } from "./components/Shelf";
import { apiStore, demoStore, type Store } from "./store";
import { Emblem, LiveDot } from "./components/ui";
import { Overview } from "./components/Overview";
import { CaptureModal, ChronicleView, TelemetryView, VaultView } from "./components/Views";
import { OWNER } from "./config";
import { AppleDrop, Ash, NotebookCover, NotebookIntro, RuleOfTheNote, ShinigamiEye, Watcher } from "./components/Lore";
import { lastDays } from "./data";

const VIEWS = ["Gaze", "Page", "Shelf", "Notebook", "Ledger", "Eyes"] as const;
const VIEW_LABEL: Record<string, string> = { Gaze: "Gaze", Page: "Page", Shelf: "Shelf", Notebook: "Notebook", Ledger: "Ledger", Eyes: "Eyes" };
type View = (typeof VIEWS)[number];

// Demo data only on ?demo or when opened from a local file / localhost (never silently in production).
const DEMO = import.meta.env.VITE_DEMO === "1" || /[?&]demo\b/.test(location.search) || ["localhost", "127.0.0.1", ""].includes(location.hostname);

export default function App() {
  const [view, setView] = useState<View>(() => (VIEWS.find((v) => location.hash === "#" + v.toLowerCase()) ?? (location.hash === "#notepad" ? "Page" : "Gaze")));
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "synced" | "error">("loading");
  const [err, setErr] = useState("");
  const [capture, setCapture] = useState(false);
  const [toast, setToast] = useState("");
  const [apple, setApple] = useState(0);
  const [eyesOpen, setEyesOpen] = useState(false);

  const [demoS] = useState<Store | null>(() => (DEMO ? demoStore() : null));
  const uploads = !!(data as any)?.uploads;
  const store = useMemo(() => demoS ?? apiStore(uploads), [demoS, uploads]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const load = useCallback(async () => {
    setState("loading");
    if (DEMO) { setData(demoData()); setState("synced"); return; }
    try { setData(await fetchData(days)); setState("synced"); }
    catch (e) { setErr((e as Error).message); setState("error"); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { try { history.replaceState(null, "", "#" + view.toLowerCase() + location.search); } catch { /* sandboxed previews */ } }, [view]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCapture((c) => !c); }
      if (e.key === "Escape") setCapture(false);
      const typing = /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable;
      if (!typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "e") setEyesOpen((o) => !o);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  const onCapture = async (text: string) => {
    if (DEMO) return "✓ (demo) inscribed:\n" + text;
    const reply = await apiCapture(text); load(); return reply;
  };
  const onAddPin = async (p: { kind: string; title: string; note?: string; image_url?: string }) => {
    if (DEMO) { setData((d) => d && { ...d, pins: [{ id: Date.now(), created_at: new Date().toISOString(), kind: p.kind, title: p.title, note: p.note || null, image_url: p.image_url || null }, ...d.pins] }); return; }
    const pin = await apiAddPin(p); setData((d) => d && { ...d, pins: [pin, ...d.pins] }); flash("An omen is pinned");
  };
  const onEdit = async (table: string, id: number, field: string, value: string) => {
    if (!DEMO) { try { await apiRow("PATCH", { table, id, field, value }); } catch (e) { flash("Not saved: " + (e as Error).message); throw e; } }
    setData((d) => d && { ...d, [table]: (d as any)[table].map((r: any) => (r.id === id ? { ...r, [field]: value === "" ? null : isNaN(+value) ? value : +value } : r)) });
    flash("Amended");
  };
  const onDelete = async (table: string, id: number) => {
    if (!DEMO) { try { await apiRow("DELETE", { table, id }); } catch (e) { return flash("Not deleted: " + (e as Error).message); } }
    if (table === "messages" && !DEMO) return load();
    setData((d) => d && { ...d, [table]: (d as any)[table].filter((r: any) => r.id !== id) });
    flash("Erased from the notebook");
  };

  const hourNow = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).slice(0, 2));
  const greet = hourNow < 5 ? "Still awake" : hourNow < 12 ? "Good morning" : hourNow < 17 ? "Good afternoon" : "Good evening";
  const notebookStats = useMemo(() => {
    if (!data) return { pages: 0, apples: 0 };
    const month = new Set(lastDays(30));
    return {
      pages: data.daily_counts.reduce((a, c) => a + c.n, 0),
      apples: data.daily_counts.filter((c) => month.has(c.d) && c.n >= 8).length,
    };
  }, [data]);
  const status = useMemo(() => (DEMO ? "DEMO DATA" : state === "synced" ? "EYES OPEN" : state === "loading" ? "TURNING PAGES" : "NOTEBOOK UNREACHABLE"), [state]);

  return (
    <div className="relative min-h-screen pb-32">
      <NotebookIntro />
      <Ash />
      <AppleDrop run={apple} />
      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-surface/80 backdrop-blur-md">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3 md:px-8">
          <a href="#gaze" onClick={() => setView("Gaze")} className="flex items-center gap-2.5">
            <Emblem />
            <span className="font-frak text-[30px] leading-none tracking-[0.06em] text-ink">RYUK</span>
          </a>
          <nav className="hidden justify-center md:flex" aria-label="Views">
            <div className="flex gap-1 rounded-full border border-hairline bg-canvas/60 p-1">
              {VIEWS.map((v) => (
                <button key={v} onClick={() => setView(v)} aria-current={view === v ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${view === v ? "bg-raised text-ink shadow-[inset_0_0_0_1px_#24242C]" : "text-slate hover:text-ink"}`}>{VIEW_LABEL[v]}</button>
              ))}
            </div>
          </nav>
          <div className="flex items-center justify-end gap-2">
            <span className="hidden items-center gap-2.5 lg:flex" title={OWNER.title}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-apple/50 bg-apple/[0.08] font-serif text-[16px] text-ink">{OWNER.name[0]}</span>
              <span className="leading-tight">
                <span className="block text-[12.5px] text-ink">{OWNER.name}</span>
                <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate">{OWNER.title}</span>
              </span>
            </span>
            <button onClick={() => setEyesOpen(true)} aria-label="Open the shinigami eyes (E)" title="Shinigami eyes (E)"
              className="group flex h-9 items-center justify-center rounded-full border border-apple/40 px-2.5 transition hover:border-apple hover:bg-apple/10">
              <ShinigamiEye size={15} />
            </button>
            <button onClick={load} aria-label="Refresh" className="hidden rounded-full p-2 text-slate transition hover:text-ink sm:block">
              <RefreshCw size={14} className={state === "loading" ? "animate-spin" : ""} />
            </button>
            <span className="flex items-center gap-2 rounded-full border border-hairline bg-canvas/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-slate">
              {state === "error" ? <span className="h-2 w-2 rounded-full bg-slate-dim" /> : <LiveDot />}
              <span className="hidden sm:inline">RYUK // OBSERVING •</span> {status}
            </span>
          </div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-2.5 md:hidden" aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] ${view === v ? "bg-raised text-ink shadow-[inset_0_0_0_1px_#24242C]" : "text-slate"}`}>{VIEW_LABEL[v]}</button>
          ))}
        </nav>
      </header>

      {/* ---------- page ---------- */}
      <main className="relative z-10 mx-auto max-w-[1400px] px-4 pt-8 md:px-8">
        <div className="mb-7 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">{greet}, {OWNER.name} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}</p>
            <h1 key={view} className="ink-write mt-2 font-serif text-[40px] leading-[1.02] text-ink md:text-[56px]">
              {view === "Gaze" ? <>Everything is <em className="text-apple/90">written.</em></> : view === "Notebook" ? <>The notebook, <em className="text-slate">page by page</em></> : view === "Ledger" ? <>The ledger</> : view === "Page" ? <>Write it <em className="text-slate">as it happens</em></> : view === "Shelf" ? <>The <em className="text-slate">shelf</em></> : <>Shinigami <em className="text-slate">eyes</em></>}
            </h1>
          </div>
          {view === "Gaze" && (
            <div className="flex items-end gap-8">
              <RuleOfTheNote />
              <div className="hidden pb-7 sm:block"><NotebookCover pages={notebookStats.pages} apples={notebookStats.apples} onOpen={() => setCapture(true)} /></div>
            </div>
          )}
        </div>
        {state === "error" && !data && view !== "Page" && view !== "Shelf" && (
          <div className="card p-10 text-center">
            <Watcher size={80} className="mx-auto mb-4" /><p className="font-serif text-2xl text-ink">The notebook could not be reached.</p>
            <p className="mt-2 font-mono text-xs text-slate">{err}</p>
            <button className="btn mt-6" onClick={load}><RefreshCw size={14} />Try again</button>
          </div>
        )}
        {!data && state === "loading" && view !== "Page" && view !== "Shelf" && <div className="grid gap-5 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card h-[420px] animate-pulse" />)}</div>}
        <div key={view} className="page-turn">
        {data && view === "Gaze" && <Overview data={data} onAddPin={onAddPin} onDeletePin={(id) => onDelete("pins", id)} demo={DEMO} />}
        {view === "Page" && <DeathPage store={store} onChanged={() => { if (!DEMO) load(); }} onApple={() => setApple((n) => n + 1)} />}
        {view === "Shelf" && <Shelf store={store} onChanged={() => { if (!DEMO) load(); }} />}
        {data && view === "Notebook" && <ChronicleView data={data} />}
        {data && view === "Ledger" && <VaultView data={data} onEdit={onEdit} onDelete={onDelete} />}
        {data && view === "Eyes" && <TelemetryView data={data} days={days} setDays={setDays} onOpenEyes={() => setEyesOpen(true)} />}
        </div>
      </main>

      {/* ---------- quick capture ---------- */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button onClick={() => setCapture(true)}
          className="pointer-events-auto group flex items-center gap-3 rounded-full border border-hairline bg-surface/85 py-2.5 pl-4 pr-2.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,.8)] backdrop-blur-md transition-colors hover:border-hover">
          <PenLine size={15} className="text-apple" />
          <span className="text-[13.5px] text-ink">Write in the notebook</span>
          <kbd className="hidden items-center gap-0.5 rounded-lg border border-hairline bg-canvas px-2 py-1 font-mono text-[10.5px] text-slate sm:flex"><Command size={10} />K</kbd>
        </button>
      </div>
      {data && <ShinigamiEyes open={eyesOpen} onClose={() => setEyesOpen(false)} data={data} />}
      <CaptureModal open={capture} onClose={() => setCapture(false)} onSubmit={onCapture} onInscribed={() => { setApple((n) => n + 1); flash("Inscribed"); }} />

      <div role="status" className={`fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border border-hairline bg-raised px-4 py-2 font-mono text-[11px] text-ink transition-opacity ${toast ? "opacity-100" : "pointer-events-none opacity-0"}`}>{toast}</div>
    </div>
  );
}
