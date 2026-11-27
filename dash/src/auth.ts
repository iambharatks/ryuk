/**
 * Dashboard sign-in. Two kinds of key, both Face ID–gated private keys that never leave your devices:
 *
 *   Website  — a passkey (WebAuthn / FIDO2). Ryuk's own /login page, one tap, Face ID / Touch ID.
 *   iOS app  — a device key the app makes in the iPhone's Secure Enclave (non-exportable, every use needs Face ID).
 *              Paired once with a 6-digit code shown on the signed-in website. Then: open the app, Face ID, in.
 *              No browser, no redirect, no Google.
 *
 * Either one yields a session: a random 256-bit token in the cookie __Host-ryuk (HttpOnly, Secure, SameSite=Lax).
 * Only its SHA-256 is stored. A session ends after 30 days unused or 90 days in all, on sign-out, or when the key
 * that opened it is removed.
 *
 * Who can add a key
 *   - Passkey: anyone already signed in; or, while no passkey exists at all, whoever holds AUTH_SETUP_CODE (a secret).
 *   - App device: whoever types the pairing code that a signed-in website session just showed (5 min, one use).
 *
 * Stored: public keys; SHA-256 of session tokens and pairing codes. Never a private key, cookie or code.
 */
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { loginPage } from "./login";

export interface AuthEnv {
  DB: D1Database;
  AUTH_SETUP_CODE?: string;   // optional secret: registers the first passkey while none exists
}
/** A signed-in visitor. keyId: the passkey id, or "device:<id>" for the app. */
export type Who = { tokenHash: string; keyId: string | null; kind: string };

export const COOKIE = "__Host-ryuk";
const IDLE_DAYS = 30;            // unused this long → signed out
const MAX_DAYS = 90;             // and never longer than this in all
const CHALLENGE_MS = 5 * 60e3;
const PAIR_MS = 5 * 60e3;
const USER_ID = new Uint8Array(new TextEncoder().encode("ryuk-owner"));

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sameSecret(a: string, b: string) {
  // compare digests so the time taken says nothing about the secret
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = x.length ^ y.length; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i % y.length);
  return d === 0;
}
const cookieOf = (req: Request, name: string) => {
  for (const part of (req.headers.get("cookie") ?? "").split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
};
const sessionCookie = (token: string) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${MAX_DAYS * 86400}`;
const clearCookie = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
const deviceName = (ua: string) => /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : "This device";
const cleanName = (v: unknown, ua: string) => String(v ?? "").replace(/[^\p{L}\p{N} '’._-]/gu, "").trim().slice(0, 40) || deviceName(ua);
const safeNext = (v: string | null) => (v && /^\/(?!\/)[\w\-./?=&#%]*$/.test(v) ? v : "/");

/** Requests that change things must come from this site (a second wall behind SameSite=Lax). The app's native calls send no Origin. */
export function crossSite(req: Request, url: URL): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  const origin = req.headers.get("origin");
  if (origin) return origin !== url.origin;
  const site = req.headers.get("sec-fetch-site");
  return !!site && site !== "same-origin" && site !== "none";
}

// ---------------- sessions ----------------
export async function sessionFrom(req: Request, env: AuthEnv): Promise<Who | null> {
  const token = cookieOf(req, COOKIE);
  if (!token || !/^[\w-]{20,100}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT credential_id, kind, created_at, expires_at, last_seen_at FROM auth_sessions WHERE token_hash = ?`).bind(tokenHash)
    .first<{ credential_id: string | null; kind: string; created_at: string; expires_at: string; last_seen_at: string | null }>();
  const now = Date.now();
  if (!row || Date.parse(row.expires_at) < now) return null;
  const hardEnd = Date.parse(row.created_at) + MAX_DAYS * 86400e3;
  if (hardEnd < now) return null;
  // slide the idle limit forward (never past the hard end), at most once an hour
  if (!row.last_seen_at || now - Date.parse(row.last_seen_at) > 3600e3) {
    await env.DB.prepare(`UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`)
      .bind(new Date(now).toISOString(), new Date(Math.min(now + IDLE_DAYS * 86400e3, hardEnd)).toISOString(), tokenHash).run();
  }
  return { tokenHash, keyId: row.credential_id, kind: row.kind };
}

async function newSession(env: AuthEnv, req: Request, keyId: string, kind: "browser" | "app") {
  const token = randomToken();
  const now = new Date();
  await env.DB.prepare(`INSERT INTO auth_sessions (token_hash, credential_id, kind, created_at, expires_at, last_seen_at, user_agent) VALUES (?,?,?,?,?,?,?)`)
    .bind(await sha256(token), keyId, kind, now.toISOString(), new Date(now.getTime() + IDLE_DAYS * 86400e3).toISOString(), now.toISOString(),
      (req.headers.get("user-agent") ?? "").slice(0, 200)).run();
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at < ? OR created_at < ?`)
    .bind(now.toISOString(), new Date(now.getTime() - MAX_DAYS * 86400e3).toISOString()).run();
  return token;
}

// ---------------- challenges and throttles ----------------
async function newChallenge(env: AuthEnv, purpose: string, challenge: string) {
  const now = Date.now();
  await env.DB.prepare(`DELETE FROM auth_challenges WHERE created_at < ?`).bind(now - CHALLENGE_MS).run();
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_challenges`).first<{ n: number }>();
  if ((open?.n ?? 0) >= 100) return false;          // someone is hammering the sign-in endpoints
  await env.DB.prepare(`INSERT INTO auth_challenges (challenge, purpose, created_at) VALUES (?,?,?)`).bind(challenge, purpose, now).run();
  return true;
}
/** Burn a challenge; true only if it existed, was for this purpose and is under 5 minutes old. */
async function burnChallenge(env: AuthEnv, purpose: string, challenge: unknown): Promise<boolean> {
  if (typeof challenge !== "string" || !/^[\w-]{16,200}$/.test(challenge)) return false;
  const row = await env.DB.prepare(`SELECT purpose, created_at FROM auth_challenges WHERE challenge = ?`).bind(challenge).first<{ purpose: string; created_at: number }>();
  await env.DB.prepare(`DELETE FROM auth_challenges WHERE challenge = ?`).bind(challenge).run();
  return !!row && row.purpose === purpose && Date.now() - row.created_at <= CHALLENGE_MS;
}
/** The challenge inside a WebAuthn response's clientDataJSON, burned. */
async function takeWebAuthnChallenge(env: AuthEnv, purpose: string, response: any): Promise<string | null> {
  let challenge: unknown;
  try { challenge = JSON.parse(new TextDecoder().decode(unb64u(String(response?.response?.clientDataJSON ?? "")))).challenge; } catch { return null; }
  return (await burnChallenge(env, purpose, challenge)) ? (challenge as string) : null;
}
async function throttled(env: AuthEnv, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await env.DB.prepare(`SELECT n, window_start FROM auth_throttle WHERE key = ?`).bind(key).first<{ n: number; window_start: number }>();
  if (!row || now - row.window_start > windowMs) { await env.DB.prepare(`INSERT OR REPLACE INTO auth_throttle (key, n, window_start) VALUES (?, 1, ?)`).bind(key, now).run(); return false; }
  if (row.n >= max) return true;
  await env.DB.prepare(`UPDATE auth_throttle SET n = n + 1 WHERE key = ?`).bind(key).run();
  return false;
}
const passkeyCount = async (env: AuthEnv) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_credentials`).first<{ n: number }>())?.n ?? 0;
const tooBusy = () => json({ error: "too many sign-in attempts in progress; try again in a few minutes" }, 429);

// ---------------- website: passkeys (WebAuthn) ----------------
async function registrationOptions(env: AuthEnv, url: URL, purpose: "register" | "setup") {
  const { results } = await env.DB.prepare(`SELECT id, transports FROM auth_credentials`).all<{ id: string; transports: string | null }>();
  const opts = await generateRegistrationOptions({
    rpName: "Ryuk", rpID: url.hostname, userName: "owner", userDisplayName: "Ryuk", userID: USER_ID,
    attestationType: "none", timeout: 120000,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: (results ?? []).map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
  });
  if (!(await newChallenge(env, purpose, opts.challenge))) return tooBusy();
  return json(opts);
}

async function registrationVerify(env: AuthEnv, req: Request, url: URL, body: any, purpose: "register" | "setup") {
  const expectedChallenge = await takeWebAuthnChallenge(env, purpose, body?.response);
  if (!expectedChallenge) return { error: json({ error: "that request expired; try again" }, 400) };
  let v;
  try {
    v = await verifyRegistrationResponse({ response: body.response, expectedChallenge, expectedOrigin: url.origin, expectedRPID: url.hostname, requireUserVerification: true });
  } catch { return { error: json({ error: "the passkey could not be verified" }, 400) }; }
  if (!v.verified || !v.registrationInfo) return { error: json({ error: "the passkey could not be verified" }, 400) };
  const c = v.registrationInfo.credential;
  await env.DB.prepare(`INSERT INTO auth_credentials (id, public_key, counter, transports, name) VALUES (?,?,?,?,?)`)
    .bind(c.id, b64u(c.publicKey), c.counter, JSON.stringify(c.transports ?? body.response?.response?.transports ?? []), cleanName(body?.name, req.headers.get("user-agent") ?? "")).run();
  return { id: c.id };
}

async function loginOptions(env: AuthEnv, url: URL) {
  // discoverable passkeys: no list of credential IDs is handed to whoever asks
  const opts = await generateAuthenticationOptions({ rpID: url.hostname, userVerification: "required", timeout: 120000, allowCredentials: [] });
  if (!(await newChallenge(env, "login", opts.challenge))) return tooBusy();
  return json(opts);
}

async function loginVerify(env: AuthEnv, url: URL, body: any): Promise<{ credentialId: string } | Response> {
  const id = String(body?.response?.id ?? "");
  const expectedChallenge = await takeWebAuthnChallenge(env, "login", body?.response);
  if (!expectedChallenge) return json({ error: "that request expired; try again" }, 400);
  const cred = await env.DB.prepare(`SELECT id, public_key, counter, transports FROM auth_credentials WHERE id = ?`).bind(id)
    .first<{ id: string; public_key: string; counter: number; transports: string | null }>();
  if (!cred) return json({ error: "this passkey isn't registered for Ryuk" }, 401);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge, expectedOrigin: url.origin, expectedRPID: url.hostname, requireUserVerification: true,
      credential: { id: cred.id, publicKey: unb64u(cred.public_key), counter: cred.counter, transports: cred.transports ? JSON.parse(cred.transports) : undefined },
    });
  } catch { return json({ error: "the passkey could not be verified" }, 401); }
  if (!v.verified) return json({ error: "the passkey could not be verified" }, 401);
  await env.DB.prepare(`UPDATE auth_credentials SET counter = ?, last_used_at = ? WHERE id = ?`).bind(v.authenticationInfo.newCounter, new Date().toISOString(), cred.id).run();
  return { credentialId: cred.id };
}

// ---------------- iOS app: Secure Enclave device keys ----------------
// The app signs these exact UTF-8 strings with ECDSA P-256 / SHA-256 (DER signature, as iOS produces it).
const pairMessage = (code: string, publicKey: string) => `ryuk-pair\n${code}\n${publicKey}`;
const loginMessage = (challenge: string, deviceId: string) => `ryuk-device-login\n${challenge}\n${deviceId}`;

/** DER (SEQUENCE{INTEGER r, INTEGER s}) → raw r||s, which WebCrypto verifies. Null if malformed. */
function derToRaw(der: Uint8Array): Uint8Array | null {
  let i = 0;
  if (der[i++] !== 0x30) return null;
  let len = der[i++]; if (len & 0x80) { const n = len & 0x7f; if (n !== 1) return null; len = der[i++]; }
  if (len !== der.length - i) return null;
  const int = () => {
    if (der[i++] !== 0x02) return null;
    const l = der[i++]; if (l < 1 || l > 33 || i + l > der.length) return null;
    let v = der.slice(i, i + l); i += l;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) return null;
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = int(), s = int();
  if (!r || !s || i !== der.length) return null;
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

async function verifyDeviceSignature(publicKeyB64: string, message: string, sigB64: string): Promise<boolean> {
  try {
    const pub = unb64u(publicKeyB64);
    if (pub.length !== 65 || pub[0] !== 0x04) return false;              // X9.63 uncompressed P-256 point
    const raw = derToRaw(unb64u(sigB64));
    if (!raw) return false;
    const key = await crypto.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, new TextEncoder().encode(message));
  } catch { return false; }
}

function sixDigits(): string {
  // uniform 000000–999999 (reject the top sliver of the 32-bit range)
  const buf = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(buf); if (buf[0] < 4294000000) return String(buf[0] % 1_000_000).padStart(6, "0"); }
}

// ---------------- routes ----------------
const html = (body: string, nonce: string) => new Response(body, {
  headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  },
});

/** Routes anyone can reach: the login page and the two sign-in ceremonies. `who` is set if already signed in. */
export async function publicRoute(req: Request, env: AuthEnv, url: URL, who: Who | null): Promise<Response | null> {
  const p = url.pathname, m = req.method;

  if (p === "/login" && m === "GET") {
    if (who) return Response.redirect(new URL(safeNext(url.searchParams.get("next")), url).toString(), 302);
    const nonce = randomToken(16);
    return html(loginPage({ nonce, hasPasskeys: (await passkeyCount(env)) > 0, setupEnabled: !!env.AUTH_SETUP_CODE, next: safeNext(url.searchParams.get("next")) }), nonce);
  }

  // website: passkey sign-in
  if (p === "/auth/login/options" && m === "POST") return loginOptions(env, url);
  if (p === "/auth/login/verify" && m === "POST") {
    const body = await req.json().catch(() => null) as any;
    const r = await loginVerify(env, url, body);
    if (r instanceof Response) return r;
    const token = await newSession(env, req, r.credentialId, "browser");
    return json({ ok: true, redirect: safeNext(body?.next ?? null) }, 200, { "set-cookie": sessionCookie(token) });
  }

  // website: the first passkey, with the setup code, only while none exists
  if ((p === "/auth/setup/options" || p === "/auth/setup/verify") && m === "POST") {
    const body = await req.json().catch(() => null) as any;
    const bad = await setupGate(env, body);
    if (bad) return bad;
    if (p === "/auth/setup/options") return registrationOptions(env, url, "setup");
    const r = await registrationVerify(env, req, url, body, "setup");
    if ("error" in r) return r.error!;
    const token = await newSession(env, req, r.id, "browser");
    return json({ ok: true, redirect: safeNext(body?.next ?? null) }, 200, { "set-cookie": sessionCookie(token) });
  }

  // app: pair a Secure Enclave key using the code the signed-in website showed
  if (p === "/auth/device/pair" && m === "POST") {
    const b = await req.json().catch(() => null) as any;
    const code = String(b?.code ?? ""), publicKey = String(b?.public_key ?? "");
    if (!/^\d{6}$/.test(code) || !/^[\w-]{80,100}$/.test(publicKey)) return json({ error: "bad request" }, 400);
    if (await throttled(env, "pair", 20, 3600e3)) return json({ error: "too many tries; wait an hour" }, 429);
    const h = await sha256(code);
    const row = await env.DB.prepare(`SELECT created_at FROM auth_pairings WHERE code_hash = ?`).bind(h).first<{ created_at: number }>();
    if (!row || Date.now() - row.created_at > PAIR_MS) return json({ error: "that code is wrong or has expired; show a new one on the website" }, 403);
    // proof the app holds the private key for this public key (and that Face ID let it sign)
    if (!(await verifyDeviceSignature(publicKey, pairMessage(code, publicKey), String(b?.signature ?? "")))) return json({ error: "the device key could not be verified" }, 400);
    await env.DB.prepare(`DELETE FROM auth_pairings WHERE code_hash = ?`).bind(h).run();
    const id = randomToken(16);
    await env.DB.prepare(`INSERT INTO auth_devices (id, public_key, name) VALUES (?,?,?)`).bind(id, publicKey, cleanName(b?.name, "iPhone")).run();
    return json({ ok: true, device_id: id });
  }

  // app: sign in with the device key
  if (p === "/auth/device/challenge" && m === "POST") {
    const challenge = randomToken(32);
    if (!(await newChallenge(env, "device", challenge))) return tooBusy();
    return json({ challenge });
  }
  if (p === "/auth/device/login" && m === "POST") {
    const b = await req.json().catch(() => null) as any;
    const deviceId = String(b?.device_id ?? ""), challenge = String(b?.challenge ?? "");
    if (!(await burnChallenge(env, "device", challenge))) return json({ error: "that request expired; try again" }, 400);
    const dev = await env.DB.prepare(`SELECT id, public_key FROM auth_devices WHERE id = ?`).bind(deviceId).first<{ id: string; public_key: string }>();
    if (!dev) return json({ error: "unknown device", code: "unpaired" }, 401);
    if (!(await verifyDeviceSignature(dev.public_key, loginMessage(challenge, dev.id), String(b?.signature ?? "")))) return json({ error: "the device key could not be verified" }, 401);
    const keyId = `device:${dev.id}`;
    await env.DB.batch([
      env.DB.prepare(`UPDATE auth_devices SET last_used_at = ? WHERE id = ?`).bind(new Date().toISOString(), dev.id),
      env.DB.prepare(`DELETE FROM auth_sessions WHERE credential_id = ?`).bind(keyId),        // one live session per device
    ]);
    const token = await newSession(env, req, keyId, "app");
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
  }
  return null;
}

async function setupGate(env: AuthEnv, body: any): Promise<Response | null> {
  if (!env.AUTH_SETUP_CODE || env.AUTH_SETUP_CODE.length < 16) return json({ error: "setup is off: set AUTH_SETUP_CODE to register the first passkey" }, 403);
  if ((await passkeyCount(env)) > 0) return json({ error: "a passkey already exists; add new devices from a signed-in dashboard" }, 403);
  if (await throttled(env, "setup", 10, 3600e3)) return json({ error: "too many tries; wait an hour" }, 429);
  if (!(await sameSecret(String(body?.code ?? ""), env.AUTH_SETUP_CODE))) return json({ error: "that setup code is wrong" }, 403);
  return null;
}

/** Routes for a signed-in visitor: manage passkeys and app devices, pair the app, sign out. */
export async function privateRoute(req: Request, env: AuthEnv, url: URL, who: Who): Promise<Response | null> {
  const p = url.pathname, m = req.method;
  if (p === "/auth/me" && m === "GET") {
    const [keys, devices, sessions, pairing] = await env.DB.batch([
      env.DB.prepare(`SELECT id, name, created_at, last_used_at FROM auth_credentials ORDER BY created_at`),
      env.DB.prepare(`SELECT id, name, created_at, last_used_at FROM auth_devices ORDER BY created_at`),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at > ?`).bind(new Date().toISOString()),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_pairings WHERE created_at > ?`).bind(Date.now() - PAIR_MS),
    ]);
    return json({
      current: who.keyId, kind: who.kind, passkeys: keys.results, devices: devices.results,
      sessions: (sessions.results[0] as any)?.n ?? 0, pairing: ((pairing.results[0] as any)?.n ?? 0) > 0,
    });
  }
  if (p === "/auth/register/options" && m === "POST") return registrationOptions(env, url, "register");
  if (p === "/auth/register/verify" && m === "POST") {
    const r = await registrationVerify(env, req, url, await req.json().catch(() => null), "register");
    return "error" in r ? r.error! : json({ ok: true, id: r.id });
  }
  if (p === "/auth/passkeys" && m === "PATCH") {
    const b = await req.json().catch(() => null) as any;
    await env.DB.prepare(`UPDATE auth_credentials SET name = ? WHERE id = ?`).bind(cleanName(b?.name, ""), String(b?.id ?? "")).run();
    return json({ ok: true });
  }
  if (p === "/auth/passkeys" && m === "DELETE") {
    const b = await req.json().catch(() => null) as any;
    if ((await passkeyCount(env)) <= 1) return json({ error: "that's your only passkey; add another device first" }, 400);
    const id = String(b?.id ?? "");
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM auth_credentials WHERE id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM auth_sessions WHERE credential_id = ?`).bind(id),   // its sessions end with it
    ]);
    return json({ ok: true });
  }
  // pairing code for the iOS app: 6 digits, 5 minutes, one use; showing a new one cancels the old
  if (p === "/auth/pair/start" && m === "POST") {
    const code = sixDigits();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM auth_pairings`),
      env.DB.prepare(`INSERT INTO auth_pairings (code_hash, created_at) VALUES (?, ?)`).bind(await sha256(code), Date.now()),
    ]);
    return json({ code, expires_in: PAIR_MS / 1000 });
  }
  if (p === "/auth/devices" && m === "DELETE") {
    const b = await req.json().catch(() => null) as any;
    const id = String(b?.id ?? "");
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM auth_devices WHERE id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM auth_sessions WHERE credential_id = ?`).bind(`device:${id}`),
    ]);
    return json({ ok: true });
  }
  if (p === "/auth/logout" && m === "POST") {
    await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).bind(who.tokenHash).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie });
  }
  if (p === "/auth/logout-all" && m === "POST") {
    await env.DB.prepare(`DELETE FROM auth_sessions`).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie });
  }
  return null;
}
