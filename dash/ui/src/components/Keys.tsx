import { useEffect, useState } from "react";
import { KeyRound, LogOut, Plus, Trash2, X } from "lucide-react";
import { type Me, addPasskey, me, passkeysWork, removePasskey, renamePasskey, signOut, signOutEverywhere, thisDevice } from "../auth";

const when = (iso: string | null) => (iso ? new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "never");

/** The key panel: which passkeys can open Ryuk, add this device, sign out. */
export function Keys({ onClose, demo }: { onClose: () => void; demo: boolean }) {
  const [info, setInfo] = useState<Me | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(thisDevice());

  const load = () => (demo
    ? Promise.resolve(setInfo({ via: "passkey", current: "a", kind: "browser", sessions: 2, passkeys: [
      { id: "a", name: "iPhone", created_at: "2026-11-27T10:00:00Z", last_used_at: new Date().toISOString() },
      { id: "b", name: "Mac", created_at: "2026-11-27T10:05:00Z", last_used_at: null }] }))
    : me().then(setInfo).catch((e) => setErr((e as Error).message)));
  useEffect(() => { load(); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const run = async (f: () => Promise<unknown>, after?: () => void) => {
    if (demo) { setErr("Demo mode: nothing to change."); return; }
    setBusy(true); setErr("");
    try { await f(); after ? after() : await load(); }
    catch (e) { const x = e as Error; setErr(x.name === "NotAllowedError" ? "Cancelled." : x.name === "InvalidStateError" ? "This device already has a Ryuk passkey." : x.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="safe-pad fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Keys" className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-hairline bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5"><KeyRound size={17} className="text-apple" /><h3 className="font-serif text-[22px] text-ink">Keys</h3></div>
          <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-slate hover:text-ink md:h-8 md:w-8"><X size={16} /></button>
        </div>

        {info && (
          <p className="mb-4 text-[13px] text-slate">
            {info.via === "access"
              ? <>You're in through <span className="text-ink">Cloudflare Access</span>. Add a passkey below, then Access can be switched off.</>
              : <>Signed in with a passkey{info.kind === "app" ? " (the app)" : ""}. Only these devices can open Ryuk.</>}
          </p>
        )}

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
          {info && !info.passkeys.length && <li className="px-3 py-3 text-[13px] text-apple">No passkey yet. Add this device now.</li>}
          {!info && !err && <li className="px-3 py-3 text-[13px] text-slate">Reading…</li>}
        </ul>

        <div className="mt-4 rounded-xl border border-hairline p-3">
          <div className="eyebrow mb-2">Add this device</div>
          {passkeysWork() ? (
            <div className="flex gap-2">
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Name for this device" />
              <button className="btn shrink-0 !border-apple/50" disabled={busy} onClick={() => run(() => addPasskey(name.trim() || thisDevice()))}><Plus size={14} />Add</button>
            </div>
          ) : <p className="text-[13px] text-slate">This browser can't make passkeys.</p>}
          <p className="mt-2 text-[11.5px] text-slate-dim">Uses Face ID, Touch ID or the device's screen lock. On iPhone and Mac the passkey syncs through iCloud Keychain to your other Apple devices.</p>
        </div>

        {err && <p role="alert" className="mt-3 text-[12.5px] text-apple">{err}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
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
