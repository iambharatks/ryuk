# Ryuk dashboard sign-in: passkeys

Status: built and tested locally, **not deployed**. This document describes the change and how it works.
`<dash-host>` below means your dashboard's workers.dev host.

---

## 1. Summary

**Before:** Cloudflare Access protected the dashboard, with Google sign-in on Cloudflare's own page. The iOS app
skipped that login with an Access *service token* compiled into the app. That token also leaked to GitHub.

**After:** the dashboard Worker runs its own sign-in.

- **Browser:** you get Ryuk's own page with one button. Face ID (or Touch ID, or the device's screen lock) unlocks it with a **passkey**.
- **Who can sign in:** only passkeys you registered can open a session.
- **iOS app:** it signs in through Apple's sign-in sheet and receives a one-time code. Nothing secret is stored in the app.
- **Changeover:** while Cloudflare Access is still switched on, an Access login still counts, so the switch can't lock you out.
- **Service tokens are no longer accepted.**

---

## 2. What changed

| | Before | After |
|---|---|---|
| What you see | Cloudflare page → Google | Ryuk page → Face ID |
| Proof of identity | Google account, checked by Access | A passkey: a private key held on your device behind Face ID |
| Credential sent to the Worker | Access JWT (`Cf-Access-Jwt-Assertion`) | Session cookie `__Host-ryuk` (Access JWT also accepted until Access is off) |
| Who checks it | Cloudflare Access, plus the Worker re-checking the JWT | The Worker (`dash/src/auth.ts`) |
| iOS app | Service token (client ID and secret) compiled into Info.plist | Apple sign-in sheet → one-time code → session cookie |
| Service tokens | Accepted if `ALLOWED_SERVICE_TOKEN` matched | Rejected (`email_mismatch`) |
| Signed-out API call | 403 `Forbidden (no_access_token)` | 401 `{"error":"signed out"}` |
| Signed-out page load | Cloudflare login page | 302 → `/login?next=…` |

Ingest endpoints (`/ingest/*` on the bot Worker) are **unchanged**: they still use their own keys.

---

## 3. Files

| File | Role |
|---|---|
| `dash/src/auth.ts` | Sessions, passkey registration and sign-in (WebAuthn), the iOS code hand-off, the cross-site check, throttles |
| `dash/src/login.ts` | The `/login` page (HTML, CSS, a small script; no outside resources) |
| `dash/src/index.ts` | The gate in front of every route (section 6); service-token acceptance removed; `frame-ancestors 'none'` added to the page's security policy (CSP) |
| `dash/ui/src/auth.ts` | Browser side: on any 401 go to `/login`; calls for the key panel |
| `dash/ui/src/components/Keys.tsx` | Key panel (header key button): list, add, rename and remove passkeys; sign out; sign out everywhere |
| `ios-app/ios/App/App/RyukWebViewDelegate.swift` | iOS: intercepts sign-in, runs `ASWebAuthenticationSession`, redeems the code |
| `ios-app/www/index.html` | iOS loader page: shows the sign-in status and a button |
| `schema.sql`, `migrations/005_passkeys.sql` | Five new tables (section 4) |
| `tests/softkey.mjs`, `tests/dash.test.mjs` | A software passkey (real P-256 key and signatures) and about 40 sign-in tests |

Library: `@simplewebauthn/server` v14 does the WebAuthn checks (signature, challenge, origin, RP ID, flags).
Ryuk code doesn't do any cryptography itself.

Removed: `ios-app/ios/secrets.xcconfig.example`, the `RyukCFClientId` and `RyukCFClientSecret` keys in Info.plist, and the `#include? "secrets.xcconfig"` lines.

---

## 4. Data stored (D1)

| Table | One row is | Key fields | Never stored |
|---|---|---|---|
| `auth_credentials` | A registered passkey | `id` (credential ID), `public_key` (COSE), `counter`, `name`, `last_used_at` | Private keys (those never leave the device) |
| `auth_sessions` | A signed-in browser or app | `token_hash` = SHA-256(cookie), `credential_id`, `kind` (browser/app), `expires_at` | The cookie value itself |
| `auth_challenges` | One sign-in or registration attempt in progress | `challenge`, `purpose` (login/register/setup), `created_at` | (deleted when used, or after 5 minutes) |
| `auth_app_codes` | A one-time code for the iOS app | `code_hash` = SHA-256(code), `created_at` | The code itself |
| `auth_throttle` | A rate-limit counter | `key` (`setup`), `n`, `window_start` | |

Because only hashes are stored, a copy of the database can't be used to sign in or to take over a session.

---

## 5. Flows

### 5.1 Signing in (browser)

```
Browser                          Worker (dash/src/auth.ts)                     D1
GET /            ───────────▶    no cookie → 302 /login?next=/
GET /login       ───────────▶    login page (script nonce, strict CSP)
[tap Unlock]
POST /auth/login/options ───▶    random challenge, allowCredentials = []  ──▶ auth_challenges
navigator.credentials.get()      (iOS shows Face ID; the device signs the challenge
                                  with the passkey's private key)
POST /auth/login/verify  ───▶    1. take and delete the challenge (single use, ≤ 5 min, purpose = login)
                                 2. look up the credential by id  ◀──────────  auth_credentials
                                 3. check: signature, challenge, origin = https://<dash-host>,
                                    RP ID = <dash-host>, user verified (UV flag), counter
                                 4. new random 32-byte token → store SHA-256  ──▶ auth_sessions
                 ◀───────────    Set-Cookie: __Host-ryuk=<token>; Secure; HttpOnly; SameSite=Lax
location.replace(next)
```

- `allowCredentials: []` means passkeys are *discoverable*: the server never sends a list of your credential IDs to whoever asks.
- `userVerification: required` means a passkey used without Face ID or the passcode is refused.

### 5.2 Registering the first passkey

A first passkey can be registered only in one of these two ways:

**A. From today's Cloudflare Access login** (the planned route). Signed in through Access, open the key panel and tap
**Add**. The Worker treats the Access JWT as signed in, so the normal add-a-device flow (5.3) runs.

**B. With `AUTH_SETUP_CODE`** (recovery, or if Access is already off). While **no passkey exists**, `/login`
shows a setup-code field if the secret is set. If it isn't set, `/login` explains how to add a passkey instead. `/auth/setup/options` and `/auth/setup/verify` require all of these:
- `AUTH_SETUP_CODE` is set and at least 16 characters long
- the number of passkeys is 0
- fewer than 10 attempts in the last hour
- the code matches (compared through SHA-256, so timing reveals nothing)

Once one passkey exists, setup is closed for good. The code can't add a second one.

### 5.3 Adding a device (signed in)

The key panel calls `POST /auth/register/options`, then `navigator.credentials.create()` (Face ID), then
`POST /auth/register/verify`:
- Options require `residentKey: required`, `userVerification: required` and `attestation: none`.
- `excludeCredentials` lists existing passkeys, so the same device can't register twice.
- On Apple devices the passkey syncs through iCloud Keychain, so one registration usually covers your iPhone and Mac.

### 5.4 iOS app

```
App WebView               RyukViewController               Apple sheet (Safari context)        Worker
load https://<dash-host>/ ─────────────────────────────────────────────────────────────────▶  302 /login (no cookie)
navigation to /login  ──▶ NavigationGuard cancels it
                          state = 24 random bytes
                          ASWebAuthenticationSession(
                            /login?app=1&state=…,
                            callbackURLScheme "ryuk",
                            ephemeral = true)        ──▶  Ryuk login page, Face ID
                                                          POST /auth/login/verify {app,state} ──▶ verify (5.1 steps 1–3)
                                                                                                 code = random, SHA-256 stored,
                                                                                                 60 s, one use
                                                     ◀──  ryuk://auth?code=…&state=…        ◀── {redirect}
                          check state matches
load /auth/app/redeem?code=… ──────────────────────────────────────────────────────────────▶  burn code, new session (kind=app)
                                                                                         ◀──  Set-Cookie + 302 /
dashboard opens; the WebView keeps the cookie (30 days, renewed while used)
```

- Passkeys work in `ASWebAuthenticationSession` without any app entitlement, so a free Apple ID is enough.
- The `ryuk://` callback goes straight to the sheet that started it. Another app registering the same scheme can't intercept it.
- `ephemeral = true` means nothing lingers in Safari, so each app sign-in asks for Face ID. That happens only when the app's session has ended.
- While Cloudflare Access is on, the dashboard redirects to `*.cloudflareaccess.com` instead of `/login`. The guard catches that too and opens the same sheet, where Google sign-in is allowed. `/login?app=1` then sees the Access JWT and issues the code straight away.

### 5.5 Sign out, sign out everywhere, removing a passkey

| Action | Effect |
|---|---|
| Sign out | Deletes this session's row and clears the cookie (`Max-Age=0`) |
| Sign out everywhere | Deletes **all** session rows, app included |
| Remove a passkey | Deletes the credential **and every session it opened**. The last passkey can't be removed. |
| Idle 30 days | Session expires; the next request gets 401 / 302 → `/login` |

---

## 6. The gate: what runs on every request (`dash/src/index.ts`)

```
1. Cross-site check   non-GET with Origin ≠ https://<dash-host> (or Sec-Fetch-Site cross-site) → 403 cross_site
2. Who is it?         a. session cookie valid and not expired → signed in (renews expires_at, at most once an hour)
                      b. else, if Cloudflare attached Cf-Access-Jwt-Assertion → verify JWT (team keys, AUD, expiry,
                         email = ALLOWED_EMAIL) → signed in; an invalid JWT → 403 Forbidden(reason)
3. Public routes      /login, /auth/login/*, /auth/setup/*, /auth/app/redeem   (answered with or without sign-in)
4. Not signed in      GET page → 302 /login?next=…   ·   anything else → 401 {"error":"signed out"}
5. Private routes     /auth/me, /auth/register/*, /auth/passkeys, /auth/logout, /auth/logout-all
6. Everything else    the existing /, /api/*, uploads …   (unchanged)
```

In the dashboard UI, `watchSession()` wraps `fetch`: any same-origin 401 sends the page to `/login?next=<current page>`.
In the iOS app, the guard turns that navigation into the sign-in sheet.

---

## 7. Endpoints

| Method and path | Needs sign-in | Purpose |
|---|---|---|
| `GET /login` | no | Login page; signed in → redirect to `next`; with `?app=1&state=` and signed in → `ryuk://auth?code` |
| `POST /auth/login/options` | no | Challenge for sign-in (at most 100 open at once, else 429) |
| `POST /auth/login/verify` | no | Verify passkey → cookie (browser) or app redirect (`app: true`) |
| `POST /auth/setup/options`, `/auth/setup/verify` | no, but setup code + zero passkeys | First passkey |
| `GET /auth/app/redeem?code=` | no, but a valid one-time code | App: code → session cookie |
| `GET /auth/me` | yes | How you're signed in, your passkeys, active session count |
| `POST /auth/register/options`, `/auth/register/verify` | yes | Add a device |
| `PATCH /auth/passkeys` | yes | Rename a passkey |
| `DELETE /auth/passkeys` | yes | Remove a passkey (not the last) |
| `POST /auth/logout`, `/auth/logout-all` | yes | Sign out here, or everywhere |

---

## 8. Security properties

| Threat | What stops it |
|---|---|
| Someone else signs in | They'd need your device and your Face ID. No passwords or codes exist to guess (setup closes after the first passkey). |
| Phishing site | A passkey is bound to `<dash-host>`; the browser won't use it on another site. Responses signed for another origin are refused (tested). |
| Replaying a captured sign-in | Challenges are single use and expire in 5 minutes (tested). |
| Passkey used without Face ID | `userVerification: required` (tested). |
| Stolen cookie via script on the page | `HttpOnly`: page scripts can't read the cookie at all. The CSP loads nothing from other origins (the main page's scripts are its own inlined bundle; the login page runs only its nonce'd script). |
| Cookie sent to another site or over http | `__Host-` prefix forces `Secure`, `Path=/` and no `Domain`. |
| Another site triggering actions (CSRF) | `SameSite=Lax`, and non-GET requests with a foreign `Origin` get 403 (tested). |
| Dashboard framed inside another site (clickjacking) | `frame-ancestors 'none'` on both pages. |
| Database copy leaks | Only SHA-256 of cookies and app codes, plus passkey *public* keys, are stored. |
| Setup code guessed | Valid only while zero passkeys exist; 10 tries an hour; at least 16 characters. |
| App code intercepted | 60 s, single use, stored hashed, delivered only to the sheet that asked, checked against `state`. |
| Leaked service token | No longer accepted by the Worker (tested). Delete it in Cloudflare too. |
| Lost phone | Remove its passkey from another signed-in device (this ends its sessions), or use recovery (section 10). |

**Trade-off:** with Access switched off, Cloudflare no longer stops anyone before the Worker. The Worker's gate
(section 6) is the only wall, and the tests cover it. Every route except the five public ones needs a session.

---

## 9. Rollout (in this order)

| Step | Who | Command or action | What changes for you |
|---|---|---|---|
| 1 | Claude, with your OK | `npx wrangler d1 execute ryuk --remote --file=migrations/005_passkeys.sql` | Nothing visible (new tables only) |
| 2 | Claude, with your OK | `npm run deploy:dash` | Browser: same Access login as today. **The installed iOS app stops opening** (old service token refused) until step 6. |
| 3 | You | Dashboard → key button → **Add** (Face ID) on iPhone, optionally Mac | You have a passkey |
| 4 | You | Zero Trust → Access → Applications → ryuk-dash → delete (or turn off Access on the workers.dev route) | Browser shows the Ryuk Face ID page |
| 5 | You | Zero Trust → Access → Service Auth → delete the leaked token. Remove `ALLOWED_SERVICE_TOKEN` from `dash/wrangler.toml`. | The leaked token is dead everywhere |
| 6 | You, on the Mac | `git pull` → `cd ios-app && npx cap sync ios` → Xcode ▶ | App opens the Face ID sheet; no `secrets.xcconfig` needed |

Undo: `npx wrangler rollback --config dash/wrangler.toml` puts back the previous dashboard (Access only). The new tables are
harmless if left in place.

---

## 10. Recovery (every passkey lost)

Run these yourself; the first one deletes data:

```bash
npx wrangler d1 execute ryuk --remote --command "DELETE FROM auth_credentials; DELETE FROM auth_sessions"
npx wrangler secret put AUTH_SETUP_CODE --config dash/wrangler.toml     # paste 32+ random characters
```

Then open `/login`. It shows the setup-code field, and you register a new passkey. Afterwards, delete the secret
(`npx wrangler secret delete AUTH_SETUP_CODE --config dash/wrangler.toml`) or leave it: it can't be used while a passkey exists.

---

## 11. Tests (`npm run test:dash`)

`tests/softkey.mjs` is a software authenticator: a real P-256 key, real `attestationObject` / `authenticatorData` and
real ECDSA signatures, the same bytes a phone sends. The tests sign in end to end and cover:

- signed out → 302 or 401
- setup refused without the secret, with a wrong code, and once a passkey exists
- the cookie's flags
- an off-site `next` is ignored
- device names are cleaned
- the cookie value isn't stored
- sign-in works; the counter is kept
- replay refused; another origin refused; no user verification refused; an unknown passkey refused
- a forged cookie is refused
- a cross-site write is refused
- app code issued with no cookie; the code redeems once; `state` required
- add, list and remove a device; the last passkey can't be removed
- sign out; sign out everywhere ends the app's session
- an Access login still works
- service tokens are refused

---

## 12. Known limits

- **The Swift code hasn't been compiled yet** (it was written on Windows). It has to be built and tried on the Mac.
- Each app sign-in asks for Face ID, because the sign-in sheet is ephemeral. With a 30-day sliding session this happens rarely.
- The Access JWT path stays in the code as a fallback. Once Access is deleted, nothing can produce a valid JWT for your AUD tag, so it is inert.
- Sign-in attempts are limited (100 open challenges), but there's no per-IP rate limit. Passkeys can't be brute-forced, so this only guards against D1 write spam.
