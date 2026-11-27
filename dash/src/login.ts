/**
 * The login page: one button, Face ID. In the Ryuk look, with no outside fonts, scripts or images.
 * Served by auth.ts with a per-request script nonce. The passkey prompt itself is the browser's / iOS's own.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function loginPage(o: { nonce: string; hasPasskeys: boolean; setupEnabled: boolean; app: boolean; state: string | null; next: string }): string {
  const cfg = JSON.stringify({ app: o.app, state: o.state, next: o.next, setup: !o.hasPasskeys }).replace(/</g, "\\u003c");
  const setup = !o.hasPasskeys;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0B0E">
<meta name="robots" content="noindex, nofollow">
<title>Ryuk</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230B0B0E'/%3E%3Ccircle cx='16' cy='17' r='9' fill='none' stroke='%23C84B31' stroke-width='2'/%3E%3Cpath d='M16 8c1-3 3-4 5-4' stroke='%23F4F4F6' stroke-width='1.6' fill='none'/%3E%3C/svg%3E">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; min-height: 100%; background: #0d0a0f; color: #F4F4F6; }
  body { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center;
    padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
  body::before { content: ""; position: fixed; inset: 0; z-index: -1; background: radial-gradient(ellipse at 30% 18%, #1d1622 0%, #0d0a0f 62%); }
  main { width: 100%; max-width: 360px; text-align: center; animation: rise .6s cubic-bezier(.3,.8,.3,1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  .emblem { width: 64px; height: 64px; margin: 0 auto 18px; filter: drop-shadow(0 0 18px rgba(200,75,49,.35)); }
  h1 { margin: 0; font: 600 34px/1 "Iowan Old Style", "Palatino Linotype", Georgia, serif; letter-spacing: .18em; }
  .sub { margin: 12px 0 34px; color: #8E8E9A; font: italic 17px/1.4 "Iowan Old Style", Georgia, serif; }
  button { width: 100%; min-height: 54px; border-radius: 14px; border: 1px solid rgba(200,75,49,.55); background: linear-gradient(180deg, #1b1419, #141016);
    color: #F4F4F6; font: 600 16px/1 inherit; letter-spacing: .02em; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;
    box-shadow: 0 10px 30px -12px rgba(200,75,49,.45), inset 0 1px 0 rgba(255,255,255,.05); transition: transform .12s, border-color .2s, box-shadow .2s; }
  button:hover { border-color: #C84B31; box-shadow: 0 12px 34px -10px rgba(200,75,49,.6), inset 0 1px 0 rgba(255,255,255,.06); }
  button:active { transform: scale(.985); }
  button:disabled { opacity: .55; cursor: default; }
  button svg { flex: none; }
  input { width: 100%; min-height: 48px; margin: 0 0 10px; padding: 0 14px; border-radius: 12px; border: 1px solid #24242C; background: #0B0B0E;
    color: #F4F4F6; font: 16px/1 ui-monospace, "SF Mono", Menlo, monospace; text-align: center; outline: none; }
  input:focus { border-color: rgba(200,75,49,.6); }
  label { display: block; margin: 0 0 8px; color: #8E8E9A; font: 11px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .2em; text-transform: uppercase; }
  .msg { min-height: 22px; margin: 16px 0 0; color: #8E8E9A; font-size: 13.5px; }
  .msg.err { color: #E07A62; }
  .foot { margin-top: 38px; color: #5E5E6A; font: 10.5px/1.6 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .16em; text-transform: uppercase; }
  .rule { width: 72px; height: 1px; margin: 0 auto 22px; background: linear-gradient(90deg, transparent, #C84B31, transparent); }
  @media (prefers-reduced-motion: reduce) { main { animation: none; } }
</style>
</head><body>
<main>
  <svg class="emblem" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 6.5c-1.2-2.2-3-3.2-5-3.4" stroke="#F4F4F6" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M16.6 7.2c1.6-2.6 4.4-3.3 6.4-2.6-.6 2.3-3 3.7-6.4 2.6Z" fill="#F4F4F6"/>
    <path d="M24.9 12.2A10 10 0 1 0 25.4 22.6" stroke="#C84B31" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="16" cy="17.4" r="3.2" stroke="#F4F4F6" stroke-width="1.2"/>
  </svg>
  <h1>RYUK</h1>
  <p class="sub">${setup ? "A new notebook. Bind it to you." : "The notebook is closed."}</p>
  <div class="rule"></div>
  ${setup ? (o.setupEnabled ? `
  <label for="code">Setup code</label>
  <input id="code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="from your wrangler secret">
  <button id="go" type="button">${KEY}<span>Create my passkey</span></button>` : `
  <p class="msg">No passkey yet. Sign in once through Cloudflare Access and add one from the dashboard's key menu, or set <b>AUTH_SETUP_CODE</b> and reload.</p>`) : `
  <button id="go" type="button" autofocus>${FACE}<span>Unlock with Face ID</span></button>`}
  <p id="msg" class="msg" role="status" aria-live="polite">${o.app ? "Signing in to the app." : ""}</p>
  <div class="foot">only the keeper's devices</div>
</main>
<script nonce="${esc(o.nonce)}">
(() => {
  const cfg = ${cfg};
  const $ = (id) => document.getElementById(id);
  const go = $("go"), msg = $("msg");
  if (!go) return;
  if (!window.PublicKeyCredential) { say("This browser can't use passkeys. Open Ryuk in Safari or Chrome.", true); go.disabled = true; return; }
  const b2u = (b) => { let s = ""; for (const c of new Uint8Array(b)) s += String.fromCharCode(c); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
  const u2b = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  function say(t, err) { msg.textContent = t; msg.className = "msg" + (err ? " err" : ""); }
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  const device = () => /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Mac/.test(navigator.userAgent) ? "Mac" : /Android/.test(navigator.userAgent) ? "Android" : /Windows/.test(navigator.userAgent) ? "Windows" : "This device";
  const done = (j) => { say("Open.", false); location.replace(j.redirect || "/"); };
  const cancelled = (e) => e && (e.name === "NotAllowedError" || e.name === "AbortError");

  async function unlock() {
    go.disabled = true; say("");
    try {
      const o = await post("/auth/login/options");
      const cred = await navigator.credentials.get({ publicKey: {
        challenge: u2b(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification || "required", allowCredentials: [],
      } });
      const r = cred.response;
      done(await post("/auth/login/verify", { app: cfg.app, state: cfg.state, next: cfg.next, response: {
        id: cred.id, rawId: b2u(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment,
        response: { clientDataJSON: b2u(r.clientDataJSON), authenticatorData: b2u(r.authenticatorData), signature: b2u(r.signature), userHandle: r.userHandle ? b2u(r.userHandle) : undefined },
      } }));
    } catch (e) { go.disabled = false; say(cancelled(e) ? "Cancelled. Tap to try again." : (e.message || "That didn't work."), !cancelled(e)); }
  }

  async function setup() {
    const code = ($("code").value || "").trim();
    if (!code) { say("Enter the setup code first.", true); $("code").focus(); return; }
    go.disabled = true; say("");
    try {
      const o = await post("/auth/setup/options", { code });
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: u2b(o.challenge), rp: o.rp, user: { id: u2b(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: "none",
        authenticatorSelection: o.authenticatorSelection, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ type: "public-key", id: u2b(c.id), transports: c.transports })),
      } });
      const r = cred.response;
      done(await post("/auth/setup/verify", { code, name: device(), app: cfg.app, state: cfg.state, next: cfg.next, response: {
        id: cred.id, rawId: b2u(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment,
        response: { clientDataJSON: b2u(r.clientDataJSON), attestationObject: b2u(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] },
      } }));
    } catch (e) { go.disabled = false; say(cancelled(e) ? "Cancelled." : (e.message || "That didn't work."), !cancelled(e)); }
  }

  go.addEventListener("click", cfg.setup ? setup : unlock);
  if (cfg.setup) $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") setup(); });
  if (new URLSearchParams(location.search).get("error") === "code") say("That sign-in link expired. Unlock again.", true);
})();
</script>
</body></html>`;
}

const FACE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C84B31" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2"/><path d="M9 9v1.5M15 9v1.5M12 9v4.5h-1M9.5 16.2c1.4 1.1 3.6 1.1 5 0"/></svg>`;
const KEY = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C84B31" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3M16 7l3 3M18 5l2 2"/></svg>`;
