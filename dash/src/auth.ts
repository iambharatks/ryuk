/**
 * Dashboard login: passkeys (Face ID / Touch ID / a security key), nothing else.
 *
 * Who gets in
 *   - A session cookie (__Host-ryuk) made by signing in with a passkey you registered.
 *   - While Cloudflare Access is still switched on: a valid Access JWT for ALLOWED_EMAIL (index.ts) also counts,
 *     so you can register your first passkey from today's login and nothing locks you out during the switch.
 *
 * Who can register a passkey
 *   - Anyone already signed in (to add another device).
 *   - With AUTH_SETUP_CODE (a secret only you set) — and only while no passkey exists yet. Throttled.
 *
 * iOS app
 *   The app opens /login?app=1&state=… in Apple's sign-in sheet. After Face ID the page sends the sheet to
 *   ryuk://auth?code=…&state=… (a one-time code, 60 s). The app loads /auth/app/redeem?code=… in its WebView,
 *   which swaps the code for a session cookie. No secret ever lives in the app.
 *
 * Stored: credential public keys, SHA-256 of session cookies and app codes. Never the cookie values themselves.
 */
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { loginPage } from "./login";

export interface AuthEnv {
  DB: D1Database;
  AUTH_SETUP_CODE?: string;   // optional secret: registers the first passkey when none exists
}
export type Who = { via: "passkey"; tokenHash: string; credentialId: string | null; kind: string } | { via: "access"; email: string };

export const COOKIE = "__Host-ryuk";
const SESSION_DAYS = 30;
const CHALLENGE_MS = 5 * 60e3;
const APP_CODE_MS = 60e3;
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
const sessionCookie = (token: string) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}`;
const clearCookie = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
const deviceName = (ua: string) => /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : "This device";
const cleanName = (v: unknown, ua: string) => String(v ?? "").replace(/[^\p{L}\p{N} '’._-]/gu, "").trim().slice(0, 40) || deviceName(ua);
const safeNext = (v: string | null) => (v && /^\/(?!\/)[\w\-./?=&#%]*$/.test(v) ? v : "/");
const safeState = (v: string | null) => (v && /^[\w-]{8,128}$/.test(v) ? v : null);

/** Requests that change things must come from this site (a second wall behind SameSite=Lax). */
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
  const row = await env.DB.prepare(`SELECT credential_id, kind, expires_at, last_seen_at FROM auth_sessions WHERE token_hash = ?`).bind(tokenHash)
    .first<{ credential_id: string | null; kind: string; expires_at: string; last_seen_at: string | null }>();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  // slide the 30 days forward, at most once an hour
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 3600e3) {
    const now = new Date();
    await env.DB.prepare(`UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`)
      .bind(now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400e3).toISOString(), tokenHash).run();
  }
  return { via: "passkey", tokenHash, credentialId: row.credential_id, kind: row.kind };
}

async function newSession(env: AuthEnv, req: Request, credentialId: string | null, kind: "browser" | "app") {
  const token = randomToken();
  const now = new Date();
  await env.DB.prepare(`INSERT INTO auth_sessions (token_hash, credential_id, kind, created_at, expires_at, last_seen_at, user_agent) VALUES (?,?,?,?,?,?,?)`)
    .bind(await sha256(token), credentialId, kind, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400e3).toISOString(), now.toISOString(),
      (req.headers.get("user-agent") ?? "").slice(0, 200)).run();
  // old sessions tidy themselves away
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`).bind(now.toISOString()).run();
  return token;
}

// ---------------- challenges and throttles ----------------
async function newChallenge(env: AuthEnv, purpose: string, challenge: string) {
  const now = Date.now();
  await env.DB.prepare(`DELETE FROM auth_challenges WHERE created_at < ?`).bind(now - CHALLENGE_MS).run();
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_challenges`).first<{ n: number }>();
  if ((open?.n ?? 0) >= 100) return false;          // someone is hammering the login page
  await env.DB.prepare(`INSERT INTO auth_challenges (challenge, purpose, created_at) VALUES (?,?,?)`).bind(challenge, purpose, now).run();
  return true;
}
/** Take (and burn) the challenge the browser signed. */
async function takeChallenge(env: AuthEnv, purpose: string, response: any): Promise<string | null> {
  let challenge: string;
  try { challenge = JSON.parse(new TextDecoder().decode(unb64u(String(response?.response?.clientDataJSON ?? "")))).challenge; } catch { return null; }
  if (typeof challenge !== "string" || !/^[\w-]{16,200}$/.test(challenge)) return null;
  const row = await env.DB.prepare(`SELECT purpose, created_at FROM auth_challenges WHERE challenge = ?`).bind(challenge).first<{ purpose: string; created_at: number }>();
  await env.DB.prepare(`DELETE FROM auth_challenges WHERE challenge = ?`).bind(challenge).run();
  return row && row.purpose === purpose && Date.now() - row.created_at <= CHALLENGE_MS ? challenge : null;
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

// ---------------- ceremonies ----------------
async function registrationOptions(env: AuthEnv, url: URL, purpose: "register" | "setup") {
  const { results } = await env.DB.prepare(`SELECT id, transports FROM auth_credentials`).all<{ id: string; transports: string | null }>();
  const opts = await generateRegistrationOptions({
    rpName: "Ryuk", rpID: url.hostname, userName: "owner", userDisplayName: "Ryuk", userID: USER_ID,
    attestationType: "none", timeout: 120000,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: (results ?? []).map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
  });
  if (!(await newChallenge(env, purpose, opts.challenge))) return json({ error: "too many sign-in attempts in progress; try again in a few minutes" }, 429);
  return json(opts);
}

async function registrationVerify(env: AuthEnv, req: Request, url: URL, body: any, purpose: "register" | "setup") {
  const expectedChallenge = await takeChallenge(env, purpose, body?.response);
  if (!expectedChallenge) return { error: json({ error: "that request expired; try again" }, 400) };
  let v;
  try {
    v = await verifyRegistrationResponse({ response: body.response, expectedChallenge, expectedOrigin: url.origin, expectedRPID: url.hostname, requireUserVerification: true });
  } catch (e) { return { error: json({ error: "the passkey could not be verified" }, 400) }; }
  if (!v.verified || !v.registrationInfo) return { error: json({ error: "the passkey could not be verified" }, 400) };
  const c = v.registrationInfo.credential;
  await env.DB.prepare(`INSERT INTO auth_credentials (id, public_key, counter, transports, name) VALUES (?,?,?,?,?)`)
    .bind(c.id, b64u(c.publicKey), c.counter, JSON.stringify(c.transports ?? body.response?.response?.transports ?? []), cleanName(body?.name, req.headers.get("user-agent") ?? "")).run();
  return { id: c.id };
}

async function loginOptions(env: AuthEnv, url: URL) {
  // discoverable passkeys: no list of credential IDs is handed to whoever asks
  const opts = await generateAuthenticationOptions({ rpID: url.hostname, userVerification: "required", timeout: 120000, allowCredentials: [] });
  if (!(await newChallenge(env, "login", opts.challenge))) return json({ error: "too many sign-in attempts in progress; try again in a few minutes" }, 429);
  return json(opts);
}

async function loginVerify(env: AuthEnv, url: URL, body: any): Promise<{ credentialId: string } | Response> {
  const id = String(body?.response?.id ?? "");
  const expectedChallenge = await takeChallenge(env, "login", body?.response);
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

async function appCode(env: AuthEnv, credentialId: string | null, state: string) {
  const code = randomToken(24), now = Date.now();
  await env.DB.prepare(`DELETE FROM auth_app_codes WHERE created_at < ?`).bind(now - APP_CODE_MS).run();
  await env.DB.prepare(`INSERT INTO auth_app_codes (code_hash, credential_id, created_at) VALUES (?,?,?)`).bind(await sha256(code), credentialId, now).run();
  return `ryuk://auth?code=${code}&state=${state}`;
}

// ---------------- routes ----------------
const html = (body: string, nonce: string, status = 200, extra: Record<string, string> = {}) => new Response(body, {
  status,
  headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    ...extra,
  },
});

/** Routes anyone can reach: the login page and the passkey ceremonies. `who` is set if already signed in. */
export async function publicRoute(req: Request, env: AuthEnv, url: URL, who: Who | null): Promise<Response | null> {
  const p = url.pathname, m = req.method;

  if (p === "/login" && m === "GET") {
    const app = url.searchParams.get("app") === "1", state = safeState(url.searchParams.get("state"));
    if (app && !state) return new Response("Bad request", { status: 400 });
    // already in (a session, or Cloudflare Access during the switch): straight through
    if (who && app) return Response.redirect(await appCode(env, who.via === "passkey" ? who.credentialId : null, state!), 302);
    if (who) return Response.redirect(new URL(safeNext(url.searchParams.get("next")), url).toString(), 302);
    const nonce = randomToken(16);
    return html(loginPage({ nonce, hasPasskeys: (await passkeyCount(env)) > 0, setupEnabled: !!env.AUTH_SETUP_CODE, app, state, next: safeNext(url.searchParams.get("next")) }), nonce);
  }

  if (p === "/auth/login/options" && m === "POST") return loginOptions(env, url);
  if (p === "/auth/login/verify" && m === "POST") {
    const body = await req.json().catch(() => null) as any;
    const r = await loginVerify(env, url, body);
    if (r instanceof Response) return r;
    const state = safeState(body?.state ?? null);
    if (body?.app) {
      if (!state) return json({ error: "bad request" }, 400);
      return json({ ok: true, redirect: await appCode(env, r.credentialId, state) });   // no cookie: the sign-in sheet is thrown away
    }
    const token = await newSession(env, req, r.credentialId, "browser");
    return json({ ok: true, redirect: safeNext(body?.next ?? null) }, 200, { "set-cookie": sessionCookie(token) });
  }

  // first passkey, with the setup code, only while none exists
  if (p === "/auth/setup/options" && m === "POST") {
    const body = await req.json().catch(() => null) as any;
    const bad = await setupGate(env, body);
    return bad ?? registrationOptions(env, url, "setup");
  }
  if (p === "/auth/setup/verify" && m === "POST") {
    const body = await req.json().catch(() => null) as any;
    const bad = await setupGate(env, body);
    if (bad) return bad;
    const r = await registrationVerify(env, req, url, body, "setup");
    if ("error" in r) return r.error!;
    const state = safeState(body?.state ?? null);
    if (body?.app && state) return json({ ok: true, redirect: await appCode(env, r.id, state) });
    const token = await newSession(env, req, r.id, "browser");
    return json({ ok: true, redirect: safeNext(body?.next ?? null) }, 200, { "set-cookie": sessionCookie(token) });
  }

  // the iOS app swaps its one-time code for a session cookie inside its own WebView
  if (p === "/auth/app/redeem" && m === "GET") {
    const code = url.searchParams.get("code") ?? "";
    if (!/^[\w-]{20,64}$/.test(code)) return Response.redirect(new URL("/login?error=code", url).toString(), 302);
    const h = await sha256(code);
    const row = await env.DB.prepare(`SELECT credential_id, created_at FROM auth_app_codes WHERE code_hash = ?`).bind(h).first<{ credential_id: string | null; created_at: number }>();
    await env.DB.prepare(`DELETE FROM auth_app_codes WHERE code_hash = ?`).bind(h).run();   // one use, even if late
    if (!row || Date.now() - row.created_at > APP_CODE_MS) return Response.redirect(new URL("/login?error=code", url).toString(), 302);
    const token = await newSession(env, req, row.credential_id, "app");
    return new Response(null, { status: 302, headers: { location: "/", "set-cookie": sessionCookie(token), "cache-control": "no-store" } });
  }
  return null;
}

async function setupGate(env: AuthEnv, body: any): Promise<Response | null> {
  if (!env.AUTH_SETUP_CODE || env.AUTH_SETUP_CODE.length < 16) return json({ error: "setup is off: sign in through Cloudflare Access and add a passkey from the dashboard, or set AUTH_SETUP_CODE" }, 403);
  if ((await passkeyCount(env)) > 0) return json({ error: "a passkey already exists; add new devices from a signed-in dashboard" }, 403);
  if (await throttled(env, "setup", 10, 3600e3)) return json({ error: "too many tries; wait an hour" }, 429);
  if (!(await sameSecret(String(body?.code ?? ""), env.AUTH_SETUP_CODE))) return json({ error: "that setup code is wrong" }, 403);
  return null;
}

/** Routes for a signed-in visitor: manage passkeys, sign out. */
export async function privateRoute(req: Request, env: AuthEnv, url: URL, who: Who): Promise<Response | null> {
  const p = url.pathname, m = req.method;
  if (p === "/auth/me" && m === "GET") {
    const { results } = await env.DB.prepare(`SELECT id, name, created_at, last_used_at FROM auth_credentials ORDER BY created_at`).all();
    const sessions = await env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at > ?`).bind(new Date().toISOString()).first<{ n: number }>();
    return json({
      via: who.via, current: who.via === "passkey" ? who.credentialId : null, kind: who.via === "passkey" ? who.kind : "browser",
      passkeys: results, sessions: sessions?.n ?? 0,
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
  if (p === "/auth/logout" && m === "POST") {
    if (who.via === "passkey") await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).bind(who.tokenHash).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie });
  }
  if (p === "/auth/logout-all" && m === "POST") {
    await env.DB.prepare(`DELETE FROM auth_sessions`).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie });
  }
  return null;
}
