# PROMPT 10 — Build Ryuk iOS App on Mac

## Context

Ryuk is a personal life-logging system: Cloudflare Workers + D1 + R2.
The web dashboard is live at `https://ryuk-dash.iambharatks.workers.dev`.
This prompt builds an iOS app that wraps the dashboard and adds a native
Quick-Log panel for fast entry logging from the phone.

Read `CLAUDE.md` and `HANDOFF.md` first. Ask before anything that deploys
or changes Cloudflare settings.

**Reference prompts (read these for full feature specs):**
- PROMPT-5 (`/tmp/PROMPT-5-ios-app.md`) — Capacitor shell, config, native features
- PROMPT-9 (`/tmp/PROMPT-9-ios-app-logging.md`) — Quick-Log panel, FAB, offline queue, settings

This prompt is the BUILD INSTRUCTIONS for the Mac. PROMPT-5 and PROMPT-9
define WHAT to build. This defines HOW.

---

## Prerequisites (one-time Mac setup)

### 1. Install Xcode
```bash
# From Mac App Store (search "Xcode") — ~12 GB download
# OR command line:
xcode-select --install
```
After install, open Xcode once and accept the license agreement.
Then install iOS simulator runtime if prompted.

### 2. Install Homebrew (if not installed)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 3. Install Node.js
```bash
brew install node
node -v   # should be 18+ 
npm -v
```

### 4. Install CocoaPods (Capacitor may need it)
```bash
sudo gem install cocoapods
# OR if on Apple Silicon:
brew install cocoapods
```

### 5. Clone the repo
```bash
git clone <your-ryuk-repo-url>
cd ryuk
```

### 6. Sign into Xcode with Apple ID
- Open Xcode → Settings (Cmd+,) → Accounts tab → click "+" → Apple ID
- Sign in with your free Apple ID
- This creates a "Personal Team" signing identity

### 7. Enable Developer Mode on iPhone
- iPhone: Settings → Privacy & Security → Developer Mode → ON
- iPhone will restart
- After restart, confirm Developer Mode when prompted

---

## Build Steps

### Step 1: Create the Capacitor project
```bash
# From the ryuk repo root
mkdir ios-app
cd ios-app
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/ios
npm install @capacitor/app @capacitor/haptics @capacitor/keyboard
npm install @capacitor/local-notifications @capacitor/network
npm install @capacitor/preferences @capacitor/status-bar
npx cap init Ryuk com.iambharatks.ryuk --web-dir www
```

### Step 2: Create capacitor.config.ts
```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iambharatks.ryuk',
  appName: 'Ryuk',
  webDir: 'www',
  server: {
    url: 'https://ryuk-dash.iambharatks.workers.dev',
    cleartext: false,
    allowNavigation: [
      'ryuk-dash.iambharatks.workers.dev',
      'iambharatks.cloudflareaccess.com',
      '*.cloudflareaccess.com'
    ]
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#c62828'
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B0B0E'
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    }
  },
  ios: {
    contentInset: 'always',
    allowsLinkPreview: false,
    scrollEnabled: true,
    backgroundColor: '#0B0B0E'
  }
};

export default config;
```

### Step 3: Create the fallback offline page
```bash
mkdir -p www
```
Create `www/index.html` — a simple dark page that says "No connection —
your drafts are safe" with a retry button. This shows when the Worker
is unreachable.

### Step 4: Build the Quick-Log panel, FAB, settings, and offline queue
See PROMPT-9 for the full spec. Summary of files to create:
- `src/app.ts` — main entry, FAB button, panel manager
- `src/quicklog/QuickLog.html` + `.css` + `.ts` — the bottom-sheet log panel
- `src/settings/Settings.html` + `.css` + `.ts` — API key entry screen
- `src/bridge.ts` — `window.RyukNative` bridge for WebView→native calls
- `src/offline-queue.ts` — stores logs locally when offline, flushes on reconnect

### Step 5: Add iOS platform
```bash
npx cap add ios
npx cap sync ios
```

### Step 6: Open in Xcode
```bash
npx cap open ios
```

### Step 7: Configure signing in Xcode
1. In Xcode's left sidebar, click the top-level project (blue icon) "App"
2. Select the "App" target
3. Go to "Signing & Capabilities" tab
4. Check "Automatically manage signing"
5. Team → select your "Personal Team (Your Name)"
6. Bundle Identifier → `com.iambharatks.ryuk`
   - If it says "not available", try `com.iambharatks.ryuk2` or similar
7. Wait for Xcode to resolve — it should show a green checkmark

### Step 8: Connect iPhone and build
1. Connect iPhone to Mac via USB cable
2. iPhone: tap "Trust This Computer" when prompted
3. In Xcode's top bar, click the device dropdown → select your iPhone
   (not a Simulator — select the actual device name)
4. Press ▶️ (Run) or Cmd+R
5. First build takes 2-3 minutes. Subsequent builds ~30 seconds.

### Step 9: Trust the app on iPhone
First launch will fail with "Untrusted Developer":
1. iPhone → Settings → General → VPN & Device Management
2. Find your Apple ID under "Developer App"
3. Tap it → "Trust <your Apple ID>"
4. Go back and open Ryuk — it should launch

### Step 10: Enter API keys
1. Open the app → go to Settings (gear icon)
2. Enter your three API keys:
   - Ingest Key: (same value you set with `npx wrangler secret put INGEST_KEY`)
   - Health Key: (same value you set with `npx wrangler secret put HEALTH_KEY`)
   - Log Key: (same value you set with `npx wrangler secret put LOG_KEY`)
3. Tap "Test" next to each to verify they connect

---

## Day-to-Day Usage

### After code changes (dashboard or app):
```bash
cd ios-app
npx cap sync ios    # sync web assets + plugins
npx cap run ios     # build and install on connected iPhone
# OR: open Xcode and press ▶️
```

Dashboard-only changes (Worker/UI deployed via Wrangler) need NO rebuild —
the app loads the live URL.

### Re-signing every 7 days:
Free Apple ID apps expire after 7 days. To re-sign:
1. Connect iPhone to Mac via USB
2. Open Xcode (or terminal: `cd ios-app && npx cap run ios`)
3. Press ▶️
4. Done. App data is preserved — nothing is lost.

The app schedules a local notification on day 6 to remind you.

### No Mac available?
If you're away from the Mac and the app expires:
- Use the web dashboard in Safari — it still works
- Use iOS Shortcuts for health/finance logging — they still work
- Re-sign when you're back at the Mac

---

## Troubleshooting

### "Unable to verify app" after 7 days
→ Re-sign: connect to Mac, Xcode ▶️

### "Developer Mode" not showing in Settings
→ It only appears after you've connected to Xcode at least once.
   Connect iPhone, run Xcode build, then check Settings again.

### Cloudflare Access login loop
→ Make sure `allowNavigation` in `capacitor.config.ts` includes
   `*.cloudflareaccess.com`. Then `npx cap sync ios` and rebuild.

### "No provisioning profiles" error in Xcode
→ Signing & Capabilities → make sure "Automatically manage signing" is
   checked and your Personal Team is selected. Try changing the Bundle
   Identifier slightly.

### App crashes on launch
→ Check the Xcode console (bottom panel) for errors. Common cause:
   the Worker URL is wrong or Access is blocking the WebView.

### "Maximum 3 apps" limit
→ Free Apple IDs can only have 3 sideloaded apps. Delete one you don't
   need from iPhone, then rebuild.

---

## What Claude Code Should Build

When you connect Claude Code on the Mac, give it PROMPT-9 and tell it:

> "Build the Ryuk iOS app as described in PROMPT-9. The Mac has Xcode
> and Node installed. The repo is cloned at ~/ryuk (or wherever).
> Create the ios-app/ folder, Capacitor config, Quick-Log panel, FAB,
> settings screen, offline queue, and local notifications. Don't deploy
> anything — just build the app so I can run it from Xcode."

Claude Code will:
1. Create `ios-app/` with all dependencies
2. Build the Quick-Log panel and FAB overlay
3. Build the settings screen for API key entry
4. Build the offline queue
5. Set up local notifications (daily nudge, re-sign reminder)
6. Run `npx cap add ios` and `npx cap sync ios`
7. Tell you to open Xcode and hit ▶️

---

## Hard Rules
- NEVER hardcode API keys in source code or the app bundle
- NEVER ship copyrighted Death Note characters/logos
- API keys are entered by the user post-install, stored in iOS Keychain
  via Capacitor Preferences
- Ask before: `wrangler deploy`, `d1 execute`, `git push`
- The app makes NO server-side changes — it uses existing Worker endpoints