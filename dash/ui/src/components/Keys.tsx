import { useEffect, useRef, useState } from "react";
import { KeyRound, LogOut, Plus, Smartphone, Trash2, X } from "lucide-react";
import { type Me, addPasskey, me, passkeysWork, removeDevice, removePasskey, renamePasskey, signOut, signOutEverywhere, startPairing, thisDevice } from "../auth";

const when = (iso: string | null) => (iso ? new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "never");

/** The key panel: passkeys for the website, paired iPhone apps, sign out. */
export function Keys({ onClose, demo }: { onClose: () => void; demo: boolean }) {
  const [info, setInfo] = useState<Me | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(thisDevice());
  const [pair, setPair] = useState<{ code: string; until: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const devicesBefore = useRef(0);

  const load = () => (demo
    ? Promise.resolve(setInfo({ current: "a", kind: "browser", sessions: 2, pairing: false,
      passkeys: [{ id: "a", name: "iPhone", created_at: "2026-11-27T10:00:00Z", last_used_at: new Date().toISOString() }],
      devices: [{ id: "d", name: "iPhone (app)", created_at: "2026-11-27T10:10:00Z", last_used_at: new Date().toISOString() }] }))
    : me().then((m) => { setInfo(m); return m; }).catch((e) => setErr((e as Error).message)));
  useEffect(() => { load(); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  // while a pairing code is showing: tick the countdown, and notice when the app has paired
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(async () => {
      setNow(Date.now());
      if (Date.now() > pair.until) { setPair(null); return; }
      if (demo) return;
      const m = await me().catch(() => null);
      if (m && m.devices.length > devicesBefore.current) { setInfo(m); setPair(null); }
    }, 3000);
    return () => clearInterval(t);
  }, [pair, demo]);

  const run = async (f: () => Promise<unknown>, after?: () => void) => {
    if (demo) { setErr("Demo mode: nothing to change."); return; }
    setBusy(true); setErr("");
    try { await f(); after ? after() : await load(); }
    catch (e) { const x = e as Error; setErr(x.name === "NotAllowedError" ? "Cancelled." : x.name === "InvalidStateError" ? "This device already has a Ryuk passkey." : x.message); }
    finally { setBusy(false); }
  };
  const showCode = () => run(async () => {
    devicesBefore.current = info?.devices.length ?? 0;
    const r = await startPairing();
    setPair({ code: r.code, until: Date.now() + r.expires_in * 1000 }); setNow(Date.now());
  }, () => {});

  const left = pair ? Math.max(0, Math.ceil((pair.until - now) / 1000)) : 0;
  return (
    <div className="safe-pad fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Keys" className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-hairline bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5"><KeyRound size={17} className="text-apple" /><h3 className="font-serif text-[22px] text-ink">Keys</h3></div>
          <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-slate hover:text-ink md:h-8 md:w-8"><X size={16} /></button>
        </div>
        <p className="mb-4 text-[13px] text-slate">Only these keys open Ryuk. Each one is a private key on your device that needs Face ID; Ryuk keeps only the public half.</p>

        {/* website passkeys */}
        <div className="eyebrow mb-2">Website · passkeys</div>
        <ul className="divide-y divide-hairline rounded-xl border border-hairline">
          {info?.passkeys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
              <input defaultValue={k.name ?? ""} aria-label="Passkey name" maxLength={40}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none focus:underline"
                onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== k.name) run(() => renamePasskey(k.id, v)); }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
              <span className="shrink-0 text-right font-mono text-[10.5px] text-slate-dim">
                {info.current === k.id ? <span className="text-apple">this one · </span> : null}used {when(k.last_used_at)}
              </span>
              <button aria-label={`Remove ${k.name}`} disabled={busy || info.passkeys.length <= 1} title={info.passkeys.length <= 1 ? "Your only passkey: add another first" : "Remove"}
                onClick={() => confirm(`Remove the passkey "${k.name}"? That device signs out and can't open Ryuk again.`) && run(() => removePasskey(k.id))}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-dim hover:bg-apple/10 hover:text-apple disabled:opacity-30"><Trash2 size={14} /></button>
            </li>
          ))}
          {!info && !err && <li className="px-3 py-3 text-[13px] text-slate">Reading…</li>}
        </ul>
        {passkeysWork() && (
          <div className="mt-2 flex gap-2">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Name for this device" />
            <button className="btn shrink-0" disabled={busy} onClick={() => run(() => addPasskey(name.trim() || thisDevice()))}><Plus size={14} />Add this device</button>
          </div>
        )}

        {/* iOS app devices */}
        <div className="eyebrow mb-2 mt-6">iPhone app · paired devices</div>
        <ul className="divide-y divide-hairline rounded-xl border border-hairline">
          {info?.devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <Smartphone size={14} className="shrink-0 text-slate" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{d.name}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-slate-dim">{info.current === `device:${d.id}` ? <span className="text-apple">this one · </span> : null}used {when(d.last_used_at)}</span>
              <button aria-label={`Unpair ${d.name}`} disabled={busy}
                onClick={() => confirm(`Unpair "${d.name}"? The app signs out and needs a new code to open Ryuk.`) && run(() => removeDevice(d.id))}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-dim hover:bg-apple/10 hover:text-apple"><Trash2 size={14} /></button>
            </li>
          ))}
          {info && !info.devices.length && <li className="px-3 py-3 text-[13px] text-slate">No app paired yet.</li>}
        </ul>
        {pair ? (
          <div className="mt-2 rounded-xl border border-apple/40 bg-apple/[0.06] p-4 text-center">
            <div className="text-[12.5px] text-slate">In the Ryuk app, enter</div>
            <div className="my-1.5 font-mono text-[34px] tracking-[0.3em] text-ink tabular-nums" aria-live="polite">{pair.code.slice(0, 3)} {pair.code.slice(3)}</div>
            <div className="font-mono text-[11px] text-slate-dim">works once · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left</div>
          </div>
        ) : (
          <button className="btn mt-2 w-full justify-center" disabled={busy} onClick={showCode}><Smartphone size={14} />Pair the iPhone app</button>
        )}

        {err && <p role="alert" className="mt-3 text-[12.5px] text-apple">{err}</p>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <button className="btn" disabled={busy} onClick={() => run(signOut, () => location.assign("/login"))}><LogOut size={14} />Sign out</button>
          <button className="btn !text-apple" disabled={busy}
            onClick={() => confirm("Sign out on every device, the app included?") && run(signOutEverywhere, () => location.assign("/login"))}>
            Sign out everywhere{info?.sessions ? ` (${info.sessions})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
