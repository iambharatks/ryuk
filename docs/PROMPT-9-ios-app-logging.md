# PROMPT 9 — Ryuk iOS App: Quick-Log Native UX

## Context

Ryuk is a personal life-logging dashboard (Cloudflare Workers + D1 + R2).
The web dashboard exists and works in mobile Safari. This prompt adds an
iOS app that wraps the dashboard AND provides a faster, phone-native
logging experience. The user has a Windows machine (no Mac) and a free
Apple ID (no paid Developer Program).

Read `CLAUDE.md` and `HANDOFF.md` first. Ask before anything that deploys
or changes Cloudflare settings.

**Reference:** PROMPT-5 (`/tmp/PROMPT-5-ios-app.md`) covers the Capacitor
shell, Codemagic build, and Sideloadly install. This prompt extends it
with a logging-first UX. If PROMPT-5 hasn't been implemented yet,
implement both together.

---

## Can This Be Done for Free?

**Yes.** Here's the full free stack:

| Component | Free option | Limit |
|-----------|-------------|-------|
| App framework | Capacitor (open source) | None |
| Build server | Codemagic | 500 min/month free (M2 Mac) |
| Install on iPhone | Sideloadly + free Apple ID | Re-sign every 7 days; max 3 sideloaded apps |
| Backend | Cloudflare Workers (already running) | 100k req/day free |
| Database | Cloudflare D1 (already running) | 5M reads, 100k writes/day free |
| Push notifications | NOT free (needs $99/yr Apple Developer) | Use local notifications instead |
| HealthKit | NOT reliable on free ID (entitlement drops on re-sign) | Use iOS Shortcuts instead (already built) |

**What you give up with a free Apple ID:**
- Must re-sign the app every 7 days (Sideloadly takes ~30 seconds)
- No push notifications (use local notifications instead — they work)
- No HealthKit (keep using the iOS Shortcuts you already built)
- No App Store / TestFlight distribution
- Max 3 sideloaded apps at once

**This is totally fine for a personal-use app.**

---

## 1. Architecture — Hybrid App with Native Quick-Log

The app has two layers:

### Layer 1: Dashboard WebView (from PROMPT-5)
- Full dashboard loaded from `https://ryuk-dash.iambharatks.workers.dev`
- Same as browser but in a native shell with Cloudflare Access login
- Shows Gaze, Notebook, Shelf, Ledger, everything

### Layer 2: Native Quick-Log Overlay
- A floating action button (FAB) that's ALWAYS visible over the WebView
- Tapping it opens a native-feeling quick-log panel
- This is where the app becomes better than the browser

---

## 2. Quick-Log Panel — The Core Feature

### Why
On a phone, opening the browser → navigating to the site → waiting for
load → tapping the right field → typing → submitting is too many steps.
The app should let you log something in **under 5 seconds**.

### Visual Design

**A. The FAB (Floating Action Button):**
- Position: bottom-right, 24px from edges, above safe area
- Size: 56px circle
- Color: Ryuk red (#c62828) with subtle glow
- Icon: a quill/pen icon (CSS-drawn or inline SVG, NOT a Death Note logo)
- Always visible over the WebView on every screen
- Subtle pulse animation (8-second cycle, very faint shadow expansion)

**B. The Quick-Log Panel:**
When FAB is tapped, a panel slides up from the bottom (iOS sheet style):

```
┌──────────────────────────────────────┐
│  ─── (drag handle)                   │
│                                      │
│  What's happening?                   │
│  ┌──────────────────────────────────┐│
│  │ (text input, multiline, auto-   ││
│  │  focus, keyboard opens)         ││
│  └──────────────────────────────────┘│
│                                      │
│  Quick tags:                         │
│  [🏋️ Gym] [📖 Read] [🍽️ Food]      │
│  [💭 Thought] [💰 Spend] [⏰ Task]   │
│                                      │
│  ┌────────────────────────────┐      │
│  │     ✍️ Log it               │      │
│  └────────────────────────────┘      │
│                                      │
└──────────────────────────────────────┘
```

**C. How it works:**

1. **Tap FAB** → panel slides up, keyboard opens, cursor in text field.
2. **Type anything** — unstructured text: "did 4 sets bench press 60kg"
   or "reading atomic habits chapter 6" or "spent 250 at swiggy".
3. **Optional: tap a quick tag** — prepends a category hint to the text
   (e.g. tapping [🏋️ Gym] prepends "gym: " to the input). This helps
   Gemini classify faster but isn't required.
4. **Tap "Log it"** or **swipe down on the panel** → sends POST to
   `/ingest` (for general logs) or `/ingest/log` (for text logs) with
   the INGEST_KEY or LOG_KEY.
5. **Haptic feedback** (light tap) on successful log.
6. **Panel auto-dismisses** with a brief "✓ Logged" confirmation.
7. Total time: open app → tap FAB → type → tap Log = **under 5 seconds**.

**D. Quick tags are configurable:**
- Stored locally (Capacitor Preferences, not D1) so they work offline.
- Default set: Gym, Read, Food, Thought, Spend, Task.
- User can add/remove/reorder tags in a settings screen.
- Each tag is just a text prefix — the backend/Gemini does the real
  classification.

### Implementation

The Quick-Log panel is a Capacitor overlay, NOT a WebView element:
- Build it as a native-feeling HTML/CSS component that sits in the
  Capacitor app layer (above the WebView).
- Use `@capacitor/keyboard` to manage keyboard appearance.
- Use `@capacitor/haptics` for feedback.
- The panel component lives in `ios-app/src/quicklog/` — separate from
  the dashboard web code.
- It makes direct HTTP calls to the Worker API (same as the iOS Shortcuts).

### API calls from the Quick-Log panel

```typescript
// General log (Gemini classifies it)
POST https://ryuk-dash.iambharatks.workers.dev/ingest
Headers: { Authorization: "Bearer <INGEST_KEY>" }
Body: { source: "app", text: "<user's text>" }

// Text-only log (for thoughts/notes)
POST https://ryuk-dash.iambharatks.workers.dev/ingest/log
Headers: { Authorization: "Bearer <LOG_KEY>" }
Body: { text: "<user's text>" }
```

**Key storage:**
- The API keys (INGEST_KEY, LOG_KEY) must be entered ONCE by the user
  in an in-app settings screen and stored in Capacitor Preferences
  (encrypted local storage on iOS).
- Do NOT hardcode keys in the app bundle.
- Settings screen: simple form with two password-masked fields +
  "Save" button. Show a "Test connection" button that sends a ping
  to verify the keys work.

---

## 3. Quick-Log Enhancements

### A. Voice-to-text (free, uses iOS built-in)
- Add a microphone icon button next to the text input.
- Tapping it activates iOS dictation (built into the keyboard — no API
  needed, just focus the text field and the dictation button is on the
  iOS keyboard already).
- Mention this in the UI: "Tip: tap 🎙️ on keyboard to speak your log"

### B. Recent logs preview
- Below the text input, show the last 3 logs as a compact list:
  ```
  12:30  🏋️ 4 sets bench press 60kg
  11:15  📖 reading atomic habits ch 6
  09:00  🍽️ oats with banana and peanut butter
  ```
- Helps the user see what they've already logged today.
- Fetched from the dashboard API on panel open.

### C. Daily goal quick-add
- A second tab in the Quick-Log panel: "Goal" (next to "Log").
- Switching to it shows a simple text input: "Today's goal:"
- Submits to `POST /api/goals` (from PROMPT-8).
- Goals added here appear on the Gaze view's Goals Board.

### D. Offline queue
- If the phone has no connection, store logs locally (Capacitor
  Preferences as a JSON array).
- When connection returns (`@capacitor/network` listener), flush
  the queue in order.
- Show a small "📶 2 logs queued" indicator on the FAB when offline
  logs are waiting.

---

## 4. App Settings Screen

A simple settings screen accessible from a gear icon in the app's
top bar (or a swipe-right menu):

```
┌──────────────────────────────────┐
│  ⚙️ Ryuk Settings               │
│                                  │
│  API Keys                        │
│  Ingest Key: ••••••••••  [Test]  │
│  Log Key:    ••••••••••  [Test]  │
│  Health Key: ••••••••••  [Test]  │
│                                  │
│  Quick Tags                      │
│  [🏋️ Gym] [📖 Read] [🍽️ Food]   │
│  [💭 Thought] [💰 Spend] [+ Add] │
│                                  │
│  Dashboard URL                   │
│  https://ryuk-dash...workers.dev │
│                                  │
│  About                           │
│  Ryuk v1.0 • Sideload expires:   │
│  Dec 3, 2026 (7-day re-sign)     │
│                                  │
└──────────────────────────────────┘
```

---

## 5. Local Notifications (Free, No Apple Developer Account)

Since push notifications need a $99/yr Apple Developer account, use
local notifications instead (they work with a free Apple ID):

- **21:00 Daily nudge:** "Have you written today?" — scheduled via
  `@capacitor/local-notifications`. Set up once on first app launch.
- **Goal reminder:** If a goal is added with the Quick-Log, schedule
  a local notification 2 hours later: "Goal check: <goal text>"
- **Re-sign reminder:** 6 days after install, notify: "Re-sign Ryuk
  tomorrow (Sideloadly)" — this is a lifesaver for the 7-day limit.

The dashboard bridge (`window.RyukNative?.schedule(...)`) lets the
WebView also trigger local notifications.

---

## 6. Project Structure

```
ios-app/
├── capacitor.config.ts
├── package.json
├── src/
│   ├── quicklog/            -- Quick-Log panel
│   │   ├── QuickLog.html
│   │   ├── QuickLog.css
│   │   └── QuickLog.ts
│   ├── settings/            -- Settings screen
│   │   ├── Settings.html
│   │   ├── Settings.css
│   │   └── Settings.ts
│   ├── bridge.ts            -- RyukNative bridge for WebView
│   ├── offline-queue.ts     -- Offline log queue
│   └── app.ts               -- Main entry, FAB, panel manager
├── www/                     -- Fallback offline page
│   └── index.html
├── ios/                     -- Generated by `npx cap add ios`
├── resources/               -- Icons and splash (generated)
└── README.md
```

---

## 7. Build & Install (All Free)

### Build on Codemagic (free tier):
See PROMPT-5 for the full `codemagic.yaml` setup. Summary:
1. Push code to GitHub (private repo).
2. Codemagic: sign in with GitHub, add repo, run `ios-unsigned` workflow.
3. Codemagic builds an unsigned `.ipa` on a free M2 Mac (~5-8 minutes).
4. Download `Ryuk.ipa` from Codemagic artifacts.

### Install with Sideloadly (free):
1. Windows: install iTunes + iCloud from apple.com (NOT Microsoft Store).
2. Install Sideloadly (sideloadly.io — free).
3. Connect iPhone via USB.
4. Drag `Ryuk.ipa` into Sideloadly, sign with Apple ID, Start.
5. iPhone: Settings → General → VPN & Device Management → trust Apple ID.
6. iPhone: Settings → Privacy & Security → Developer Mode → on (restart).
7. Open Ryuk, sign in via Cloudflare Access, enter API keys in Settings.

### Re-signing every 7 days:
- Same Sideloadly process, same Apple ID, same bundle ID.
- Never delete the app (data persists across re-signs).
- Enable Sideloadly's "automatic refresh over Wi-Fi" to avoid manual
  re-signing (requires both devices on same network).
- The app sets a local notification reminder on day 6.

---

## 8. What the App Gives You vs. Browser

| Feature | Browser | App |
|---------|---------|-----|
| View dashboard | ✅ | ✅ |
| Log entries | ✅ (slow: navigate, type, submit) | ✅ **FAB → type → done in 5 sec** |
| Quick tags | ❌ | ✅ |
| Offline logging | ❌ | ✅ (queued, auto-synced) |
| Haptic feedback | ❌ | ✅ |
| Daily nudge notification | ❌ | ✅ (local) |
| Goal reminder | ❌ | ✅ (local) |
| Re-sign reminder | N/A | ✅ |
| HealthKit | ❌ | ❌ (use Shortcuts; Phase 2 with paid ID) |

---

## 9. Implementation Order

1. **Set up Capacitor project** (`ios-app/`, config, fallback page).
2. **FAB + Quick-Log panel** — the core feature. HTML/CSS/TS overlay
   with text input, quick tags, and API call.
3. **Settings screen** — API key entry and storage.
4. **Offline queue** — local storage + network listener.
5. **Local notifications** — daily nudge, goal reminders, re-sign reminder.
6. **WebView bridge** — `window.RyukNative` for dashboard→native calls.
7. **Icons and splash** — generated from Ryuk emblem SVG.
8. **Codemagic workflow** — `codemagic.yaml` for unsigned build.
9. **Install guide** — `docs/IOS-INSTALL.md` (from PROMPT-5).
10. **Test checklist** — sign in, log, quick-log, offline queue, notifications.

---

## Hard Rules

- NEVER hardcode API keys in the app bundle or source code.
- NEVER ship copyrighted Death Note characters/logos/lettering.
- API keys stored in Capacitor Preferences (iOS Keychain-backed).
- The app holds no secrets at build time — keys entered by user post-install.
- Keep the web dashboard fully functional — the app is an enhancement,
  not a replacement.
- Ask before: `wrangler deploy`, `d1 execute`, `git push`, any secrets.
- Run `npm test` before and after all changes.

---

## What NOT to Do

- Don't build a React Native or Flutter app — Capacitor wraps the
  existing web dashboard with minimal native additions.
- Don't add HealthKit in this phase — it requires a paid Apple Developer
  account for reliable entitlements.
- Don't attempt App Store submission — this is a sideloaded personal app.
- Don't add a custom camera/photo feature — text-only logging for now.
- Don't add push notifications — local notifications are the free alternative.
- Don't add any server-side changes for the app — it uses the existing
  Worker API endpoints.