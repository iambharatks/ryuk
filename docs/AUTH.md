# Ryuk sign-in: passkeys on the website, a Secure Enclave key in the iOS app

`<dash-host>` means your dashboard's workers.dev host.

---

## 1. Summary

You sign in with Face ID, and nothing else.

| Where | How | What you see |
|---|---|---|
| **Website** | A **passkey** (WebAuthn / FIDO2). The private key sits on your iPhone or Mac, syncs through iCloud Keychain, and needs Face ID or Touch ID to use. | Ryuk's own page → **Unlock with Face ID** → dashboard |
| **iOS app** | A **device key** the app makes in the iPhone's **Secure Enclave**. It can't be copied off the phone, and every use needs Face ID. You pair the app once with a 6-digit code. | Open the app → Face ID → dashboard. No browser, no redirect, no Google. |

Either one gives a **session**: a random 256-bit token kept in a hardened cookie. Only the token's SHA-256 is stored.

There's no Google, no Cloudflare Access, no password, and no secret inside the app.

---

## 2. What changed

| | Before | Now |
|---|---|---|
| Website sign-in | Cloudflare Access page → Google | Ryuk page → passkey (Face ID) |
| iOS app sign-in | Cloudflare service token compiled into the app (leaked) | Secure Enclave key + Face ID, paired once with a code |
| Who checks it | Cloudflare Access | The dashboard Worker (`dash/src/auth.ts`) |
| Cloudflare Access sign-ins and service tokens | Accepted | **Ignored.** Switch Access off; it now only adds a second, pointless login. |
| Signed-out API call | 403 | 401 `{"error":"signed out"}` |
| Signed-out page | Cloudflare login | 302 → `/login?next=…` |

Ingest endpoints on the bot Worker (`/ingest/*`, Shortcut keys) are **unchanged**.

---

## 3. Standards used

| Topic | What Ryuk does | Reference |
|---|---|---|
| Authenticator | Passkeys (WebAuthn Level 3 / FIDO2), user verification required, discoverable credentials, attestation `none` | W3C WebAuthn; FIDO Alliance |
| App key | ECDSA P-256 key in the Secure Enclave with `biometryCurrentSet`, `privateKeyUsage`, this-device-only, passcode required | Apple Platform Security guide |
| Assurance | Phishing-resistant, possession + biometric | NIST SP 800-63B AAL2 (passkeys), OWASP ASVS V2 |
| Session token | 256-bit random, server-side, only its hash stored, a new one at every sign-in | OWASP Session Management |
| Cookie | `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` | RFC 6265bis, OWASP |
| Timeouts | 30 days idle, **90 days absolute** | OWASP Session Management |
| CSRF | SameSite plus a server-side `Origin` check on every write | OWASP CSRF Prevention |
| Headers | CSP with a per-request script nonce on `/login`, `frame-ancestors 'none'`, `no-store`, `nosniff`, `no-referrer` | OWASP Secure Headers |

One deliberate departure: the app's device key isn't a WebAuthn passkey. In-app native passkeys need Apple's
*Associated Domains* entitlement, which needs the paid Apple Developer Program ($99 a year). The Secure Enclave key
uses the same cryptography (P-256, device-bound, biometric-gated) and is free. Because the app only talks to one
hard-coded host, the phishing protection WebAuthn adds isn't needed there.

---

## 4. Files

| File | Role |
|---|---|
| `dash/src/auth.ts` | Sessions; website passkeys (via `@simplewebauthn/server` v14); app pairing and device sign-in (WebCrypto ECDSA); throttles; the cross-site check |
| `dash/src/login.ts` | The `/login` page |
| `dash/src/index.ts` | The gate in front of every route (section 7) |
| `dash/ui/src/auth.ts` | Browser: any 401 → `/login`; calls for the key panel |
| `dash/ui/src/components/Keys.tsx` | Key panel (header key icon): passkeys, paired iPhones, **Pair the iPhone app** code, sign out |
| `ios-app/ios/App/App/RyukWebViewDelegate.swift` | iOS: Secure Enclave key, pairing, Face ID sign-in, cookie into the WebView, `/login` guard |
| `ios-app/www/index.html` | iOS start page: pairing-code entry and status |
| `ios-app/ios/App/App/Info.plist` | `NSFaceIDUsageDescription` added; the token keys removed |
| `schema.sql`, `migrations/005_passkeys.sql`, `migrations/006_app_devices.sql` | Tables (section 5) |
| `tests/softkey.mjs`, `tests/dash.test.mjs` | A software passkey and a software device key; the sign-in tests |

---

## 5. Data stored (D1)

| Table | A row is | Holds | Never holds |
|---|---|---|---|
| `auth_credentials` | A website passkey | id, COSE public key, sign counter, name, last used | Private key |
| `auth_devices` | A paired iPhone app | random id, P-256 public key (65-byte point), name, last used | Private key (stays in the Secure Enclave) |
| `auth_sessions` | A signed-in browser or app | SHA-256(token), which key opened it (`<passkey id>` or `device:<id>`), kind, created, idle expiry | The token |
| `auth_challenges` | A sign-in in progress | random challenge, purpose (`login`/`register`/`setup`/`device`) | Deleted on use, or after 5 minutes |
| `auth_pairings` | The current pairing code | SHA-256(6-digit code), created | The code |
| `auth_throttle` | A rate-limit counter | `setup`, `pair` | |
| `auth_app_codes` | *(left over from the first design; unused, empty)* | | |

A copy of the database can't sign anyone in. It holds only public keys and hashes.

---

## 6. Flows

### 6.1 Website sign-in

```
GET /                      → no session → 302 /login?next=/
GET /login                 → page (script runs only with this response's nonce)
POST /auth/login/options   → random challenge; allowCredentials = [] (no credential IDs given out)
  navigator.credentials.get → Face ID → the device signs (challenge, origin, RP ID) with the passkey
POST /auth/login/verify    → challenge burned (one use, ≤ 5 min); signature, origin, RP ID, user-verified flag
                             and counter checked against the stored public key
                           → new session; Set-Cookie: __Host-ryuk=<token>; Secure; HttpOnly; SameSite=Lax
```

### 6.2 Website: the first passkey, and more devices

- **First passkey** (only while **none** exists): `/login` shows a setup-code field, as long as the secret
  `AUTH_SETUP_CODE` is set and at least 16 characters long. The code is compared through SHA-256, with 10 tries an
  hour. Once one passkey exists, setup is closed.
  - *Already done: your iPhone passkey was registered on 27 Nov through the earlier Cloudflare-Access route.*
- **More devices:** signed in → key panel → **Add this device**. Apple devices also get it through iCloud Keychain.

### 6.3 iOS app: pairing (once)

```
Website (signed in)  Keys → "Pair the iPhone app"
  POST /auth/pair/start          → 6 digits (uniform random), stored hashed, 5 min, one use; a new code cancels the old
App
  creates a P-256 key in the Secure Enclave   (biometryCurrentSet: Face ID needed for every use)
  signs  "ryuk-pair\n<code>\n<public key>"    → Face ID
  POST /auth/device/pair {code, public_key, signature, name}
Server
  20 tries/hour for everyone · code hash exists and < 5 min · signature valid for that public key
  → code deleted · auth_devices row · returns device_id (the app stores it; not a secret)
```

The signature proves the app really holds the private key for the public key it sent.

### 6.4 iOS app: every launch

```
App  POST /auth/device/challenge                 → random 256-bit challenge (one use, 5 min)
     signs "ryuk-device-login\n<challenge>\n<device_id>"   → Face ID
     POST /auth/device/login {device_id, challenge, signature}
Srv  challenge burned · device exists · ECDSA signature verifies with its public key
     → that device's earlier session deleted (one live session per iPhone) → new session, Set-Cookie
App  copies the cookie into the WebView's cookie store → loads the dashboard
```

If the dashboard later navigates to `/login` (the session ended), the app cancels that navigation and repeats this
flow. A login page never appears inside the app.

| App situation | What happens |
|---|---|
| Not paired yet | Start page asks for the 6-digit code |
| Face ID cancelled | "Face ID was cancelled." with an **Unlock** button |
| Unpaired on the website | Server answers `unpaired`; the app deletes its key and asks for a new code |
| A face added or removed in Face ID settings | iOS invalidates the key; the app asks to pair again |
| Cloudflare Access still on | "Cloudflare Access is still switched on…" (the app can't get through it) |

### 6.5 Ending sessions

| Action | Effect |
|---|---|
| Sign out | This session deleted; cookie cleared |
| Sign out everywhere | All sessions deleted, apps included |
| Remove a passkey | It and every session it opened are deleted (the last passkey can't be removed) |
| Unpair an iPhone | Its device key and session are deleted; it needs a new code |
| 30 days unused, or 90 days in all | The session ends; the next request gets 401 → `/login` (website) or Face ID (app) |

---

## 7. The gate (every request, `dash/src/index.ts`)

```
1. Cross-site     non-GET whose Origin ≠ https://<dash-host> (or Sec-Fetch-Site cross-site) → 403
                  (the app's native calls send no Origin, so they pass)
2. Session        cookie → SHA-256 → auth_sessions row, not idle-expired, < 90 days old
3. Public routes  /login · /auth/login/* · /auth/setup/* · /auth/device/{pair,challenge,login}
4. No session     page → 302 /login?next=…    anything else → 401
5. Private        /auth/me · /auth/register/* · /auth/passkeys · /auth/pair/start · /auth/devices · /auth/logout(-all)
6. The dashboard  /, /api/*, files … (unchanged)
```

---

## 8. Threats

| Threat | Stopped by |
|---|---|
| Someone signs in as you | They'd need your unlocked device and your face. There are no passwords or codes to guess (setup closes after the first passkey). |
| Phishing site | A passkey only works on `<dash-host>`; the app only ever talks to `<dash-host>` |
| Replaying a captured sign-in | Challenges are single use, last 5 minutes, and are bound to the device id |
| Use without Face ID | Website: the user-verified flag is required. App: the Secure Enclave won't sign without Face ID. |
| Pairing code guessed | 6 digits, 5 minutes, one use, 20 tries an hour, plus proof of the key. A random guess succeeds 1 time in about 50,000. |
| Stolen cookie | `HttpOnly` (page scripts can't read it), `Secure`, `__Host-`; it dies after 30 days idle or 90 days in all |
| Cross-site actions (CSRF), framing (clickjacking) | `SameSite=Lax` + `Origin` check; `frame-ancestors 'none'` |
| Database leaked | Only public keys and hashes are stored |
| App bundle inspected | Nothing secret is in it |
| Lost iPhone | Sign in on another device → Keys → remove its passkey and unpair the app |

---

## 9. Rollout

| # | Who | What | Result |
|---|---|---|---|
| 1 | Claude ✔ | `005_passkeys.sql` and the dashboard deploy (27 Nov) | Passkey sign-in live behind Access |
| 2 | You ✔ | Registered the iPhone passkey | `auth_credentials` has "iPhone" |
| 3 | Claude, with your OK | `npx wrangler d1 execute ryuk --remote --file=migrations/006_app_devices.sql`, then `npm run deploy:dash` | Access sign-ins ignored. **While Access is still on: Google first, then Face ID.** |
| 4 | You | Cloudflare: Workers & Pages → ryuk-dash → **Access** tab → turn the Access rule off. Then Zero Trust → Access → Applications → delete the ryuk-dash app. | Website: Ryuk's Face ID page only |
| 5 | You | Zero Trust → Access → Service Auth → delete the leaked token. Remove `ALLOWED_SERVICE_TOKEN`, `TEAM_DOMAIN`, `POLICY_AUD` and `ALLOWED_EMAIL` from `dash/wrangler.toml` (no longer read). | Old credentials are gone |
| 6 | You (Mac) | `git pull` → `cd ios-app && npx cap sync ios` → Xcode ▶ on the iPhone → website Keys → **Pair the iPhone app** → type the code into the app | App opens with Face ID |

Undo: `npx wrangler rollback --config dash/wrangler.toml`.

---

## 10. Recovery (every passkey lost)

Run these yourself; the first one deletes data:

```bash
npx wrangler d1 execute ryuk --remote --command "DELETE FROM auth_credentials; DELETE FROM auth_sessions"
npx wrangler secret put AUTH_SETUP_CODE --config dash/wrangler.toml     # paste 32+ random characters
```

Open `/login`, enter the code, and Face ID registers a new passkey. Then pair the app again from the key panel.

---

## 11. Tests

`npm run test:dash` (154 checks), using a software passkey (real WebAuthn bytes) and a software device key
(real ECDSA DER signatures):

- **Website:** signed out → 302 or 401; setup gating; cookie flags; replay, wrong origin, no user verification, unknown passkey and forged cookie all refused; cross-site write refused; add, list and remove passkeys
- **App:** pairing needs a signed-in website; code is 6 digits and stored hashed; wrong code refused; signature proof required; a code works once; device sign-in issues a cookie; challenge replay refused; another key refused; one session per device; unpairing ends the session and the sign-in
- **Sessions:** 90-day absolute end; sign out; sign out everywhere; Cloudflare Access JWTs and the old service token open nothing

---

## 12. Known limits

- **The Swift code hasn't been compiled yet** (it was written on Windows). It has to be built and tried on the iPhone (the simulator has no Secure Enclave).
- Every cold launch of the app asks for Face ID. That's intended: it works as an app lock.
- There's no per-IP rate limit. Passkeys and device keys can't be brute-forced; the challenge cap (100 open) and the pairing throttle cover the rest.
