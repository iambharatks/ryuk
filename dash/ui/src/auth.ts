/**
 * The dashboard's side of passkey sign-in: send you to /login when the session ends, and the calls the key panel uses.
 * The ceremonies themselves run on the server (dash/src/auth.ts); this only shuttles bytes to the browser's passkey prompt.
 */
const b2u = (b: ArrayBuffer) => { let s = ""; for (const c of new Uint8Array(b)) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const u2b = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Any same-origin call that comes back 401 means the session ended: go to the login page and come back here after. */
export function watchSession() {
  const orig = window.fetch.bind(window);
  let leaving = false;
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const same = url.startsWith("/") || url.startsWith(location.origin);
    if (res.status === 401 && same && !leaving) {
      leaving = true;
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
    }
    return res;
  };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  return out as T;
}

export type Passkey = { id: string; name: string | null; created_at: string; last_used_at: string | null };
export type AppDevice = { id: string; name: string | null; created_at: string; last_used_at: string | null };
export type Me = { current: string | null; kind: string; passkeys: Passkey[]; devices: AppDevice[]; sessions: number; pairing: boolean };

export const me = () => call<Me>("GET", "/auth/me");
export const renamePasskey = (id: string, name: string) => call("PATCH", "/auth/passkeys", { id, name });
export const removePasskey = (id: string) => call("DELETE", "/auth/passkeys", { id });
export const startPairing = () => call<{ code: string; expires_in: number }>("POST", "/auth/pair/start", {});
export const removeDevice = (id: string) => call("DELETE", "/auth/devices", { id });
export const signOut = () => call("POST", "/auth/logout", {});
export const signOutEverywhere = () => call("POST", "/auth/logout-all", {});
export const passkeysWork = () => typeof window !== "undefined" && !!window.PublicKeyCredential;

/** Make a passkey on this device (Face ID / Touch ID / a security key) and register it. */
export async function addPasskey(name: string) {
  const o: any = await call("POST", "/auth/register/options", {});
  const cred = (await navigator.credentials.create({ publicKey: {
    challenge: u2b(o.challenge), rp: o.rp, user: { id: u2b(o.user.id), name: o.user.name, displayName: o.user.displayName },
    pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: "none", authenticatorSelection: o.authenticatorSelection,
    excludeCredentials: (o.excludeCredentials || []).map((c: any) => ({ type: "public-key", id: u2b(c.id), transports: c.transports })),
  } })) as PublicKeyCredential;
  const r = cred.response as AuthenticatorAttestationResponse;
  return call("POST", "/auth/register/verify", { name, response: {
    id: cred.id, rawId: b2u(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: (cred as any).authenticatorAttachment,
    response: { clientDataJSON: b2u(r.clientDataJSON), attestationObject: b2u(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] },
  } });
}

export const thisDevice = () => {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows PC" : "This device";
};
