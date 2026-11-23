# Plainhand on Mobile (iPhone & Android)

Plainhand supports **iPhone and Android today** through both **mobile browsers** and an **installable Progressive Web App (PWA)**. A native iOS app (`.ipa` / App Store build) is intentionally deferred for a later phase.

## 1. Mobile options available today

### Option A: Mobile browser (iPhone Safari, Android Chrome / Edge / Firefox)
Open your hosted Plainhand workspace in your phone's browser. Plainhand adapts automatically for phones:
- **Thumb-reachable bottom navigation** (`Home`, `Jobs`, `Apps`, `Profile`, `More`) with due follow-up and active task badges.
- **Full-screen role sheets** for evaluating fit, reviewing resume/cover-letter packets, checking claims, logging interviews, and setting next actions.
- **Mobile-first ergonomics**: 44px+ touch targets, 16px form controls (preventing iOS Safari auto-zoom), safe-area inset support for iPhone notch / Dynamic Island / home indicator, and light/dark theme sync.

### Option B: Installable Web App (PWA) for iPhone & Android
Installing Plainhand as a PWA puts it on your Home Screen and launches it in standalone full-screen mode without browser chrome.

- **iPhone & iPad (Safari):**
  1. Open Plainhand in **Safari**.
  2. Tap the **Share** button in Safari's toolbar.
  3. Tap **Add to Home Screen**, then tap **Add**.
- **Android (Chrome, Edge, Brave, Samsung Internet):**
  1. Open Plainhand in your browser.
  2. Tap **Install app** in the browser menu — or open **Workspace → Use on your phone** and tap **Install Plainhand app**.
  3. **Android Share Target:** Once installed on Android, you can tap **Share → Plainhand** from Chrome, LinkedIn, Indeed, or messaging apps to open Plainhand's **Add a job** dialog pre-filled with the job URL and title (no automation or scraping of job boards).
  4. **App shortcuts:** Long-press the Plainhand Home Screen icon to jump straight to **Home briefing**, **Add a job**, **Applications**, or **Profile & brain**.

### Option C: Read-only Remote Dashboard PWA (for local-only users)
If you run Plainhand locally on your computer (`127.0.0.1:3210`) and turn on **Workspace → Open from anywhere**, the published password-protected Vercel dashboard is also an installable PWA on iPhone and Android for checking applications, reports, and PDFs on the go.

## 2. What works on your phone vs. on a computer

| Task | Phone (browser & PWA) | Computer (desktop browser / local app) |
| --- | --- | --- |
| Check today's briefing & overdue follow-ups | Yes | Yes |
| Save job links (or Android Share → Plainhand) | Yes | Yes |
| Review evaluations, claim calibration & packets | Yes | Yes |
| Approve packets & copy tailored answers / cover letters | Yes | Yes |
| Log interviews, contacts, next actions & confirm submissions | Yes | Yes |
| Chat with connected Claude / ChatGPT (using your mobile AI app) | Yes (once connected) | Yes |
| Initial AI connector setup (ChatGPT / Claude custom MCP) | Needs computer once | Yes |
| Automatic browser form filling (extension or local Playwright) | Not supported on mobile browsers | Yes |

## 3. Privacy & offline behavior

Plainhand's service worker (`/sw.js`) follows a strict privacy-first boundary:
- **Cached:** Only public, non-personal static interface assets (`/css/*`, `/fonts/*`, `/icons/*`, `/ui/*`, `/vendor/*`, `/manifest.webmanifest`, `/offline.html`).
- **Never cached:** `/api/*`, `/auth/*`, `/oauth/*`, `/account/*`, `/signin`, `/mcp`, `/dashboard-data.json`, `/reports/*`, `/output/*`, and authenticated HTML documents containing session/CSRF tokens.
- **Offline fallback:** If you open the PWA while offline, Plainhand displays a branded offline screen (`/offline.html`) and keeps all saved workspace data untouched.

## 4. Deferred: Native iOS app (`.ipa`)

A native iPhone / iPad `.ipa` build (App Store / TestFlight distribution) is **deferred for later** on purpose:
- **Why deferred:** The mobile web app + Safari PWA already delivers full-screen Home Screen launch, safe-area layout, dark/light themes, session persistence, and instant updates on both iPhone and Android without Apple Developer Program signing overhead, Xcode build pipelines, or App Store review delays.
- **When to revisit `.ipa` later:**
  - If iOS users specifically need an **iOS Share Extension** (to share job links from the iOS LinkedIn/Indeed apps directly into Plainhand, which iOS Safari PWAs do not support natively).
  - If **native push reminders** for follow-ups/interviews, **Face ID / Touch ID app lock**, or **App Store discoverability** become top priorities.
- **Planned architecture when resumed:** A thin native wrapper (Capacitor or SwiftUI WebView shell + iOS Share Extension) talking to the same hosted Plainhand API and OAuth endpoints — keeping the single web UI as the source of truth rather than duplicating business logic.
