# Gin Rummy 🃏

A cross-platform (Android, iOS, and **web**) online **2-player gin rummy** game
built with Expo / React Native. No sign-up: one player creates a game and gets a
short room code, the other enters it. Real-time play runs on Firebase's free
tier — there is no server for you to run or pay for.

- **Framework:** Expo SDK 54 + expo-router + TypeScript
- **Backend:** Firebase Realtime Database + Anonymous Auth (free Spark plan)
- **Testing on iPhone:** the Expo Go app (no Mac required)
- **Web:** the same app exports to a static, installable PWA (see §6)

---

## 1. Prerequisites

- Node.js (LTS recommended) and npm
- An Android emulator (via Android Studio) **or** the **Expo Go** app on your phone
- A free Google account for Firebase

Install JS dependencies:

```bash
npm install
```

## 2. Firebase setup (one-time, ~5 minutes) — REQUIRED for online play

The app cannot connect until you create a Firebase project and paste its config.
Everything here stays on the **free Spark plan** — never enter a credit card.

1. Go to <https://console.firebase.google.com> → **Add project** → name it
   `gin-rummy` (Google Analytics: off). Finish.
2. In the project: **Build → Authentication → Get started → Sign-in method →**
   enable **Anonymous**.
3. **Build → Realtime Database → Create database →** location **United States
   (us-central1)** → start in **Locked mode**.
4. **Project settings** (gear icon) **→ Your apps → Web (`</>`)** → register an
   app (any nickname) → copy the `firebaseConfig` object it shows you.
5. Copy [`.env.example`](.env.example) to `.env` and paste those values,
   replacing the `PASTE_ME` placeholders. **Make sure `databaseURL` is filled
   in** — it looks like `https://gin-rummy-default-rtdb.firebaseio.com`. Then
   restart the dev server with a cleared cache: `npx expo start -c`.

   > `.env` is git-ignored and stays on your machine. The config is read from
   > `EXPO_PUBLIC_*` variables in [`src/fb/config.ts`](src/fb/config.ts); the
   > repo ships only placeholders.

### Deploy the security rules

The database rules (who can read/write which room) live in
[`firebase/database.rules.json`](firebase/database.rules.json). Deploy them once:

```bash
npm install -g firebase-tools
firebase login
firebase use --add           # pick your gin-rummy project, alias it "default"
firebase deploy --only database
```

> The Firebase web config values are **not secrets** — they're public
> identifiers that ship inside every client anyway. Security is enforced by the
> database rules, not by hiding the config. This repo keeps them in a
> git-ignored `.env` only so a fork brings its own Firebase project rather than
> writing to mine.

## 3. Run the app

```bash
npx expo start
```

Then:

- **Android emulator:** press `a` in the terminal.
- **iPhone (no Mac needed):** install **Expo Go** from the App Store, then scan
  the QR code. If your phone can't reach the dev server on Windows/Wi-Fi, run
  `npx expo start --tunnel` instead.

To play a real game you need **two devices** (e.g. the Android emulator + your
iPhone): create a game on one, share the code, join on the other.

## 4. Run the tests

The game engine (rules, deadwood, scoring) is pure TypeScript with a full Jest
suite, including a fuzz test that plays thousands of random games:

```bash
npm test          # run once
npm run typecheck # tsc --noEmit
```

## 5. Distributing to family & friends (invite-only)

This is a private, code-to-join game — no public matchmaking. The simplest way
to get it onto relatives' phones is **not** a public store listing but a direct
build you share.

### One-time EAS setup

```bash
npm install -g eas-cli
eas login
eas init            # links this project to your Expo account
```

Because `.env` is git-ignored, EAS builds don't receive it — register the same
Firebase values as **EAS environment variables** (they're public identifiers,
so plaintext visibility is fine) for the `preview` and `production` profiles:

```bash
eas env:create --environment preview --environment production \
  --visibility plaintext --name EXPO_PUBLIC_FIREBASE_API_KEY --value "…"
# …repeat for AUTH_DOMAIN, DATABASE_URL, PROJECT_ID, STORAGE_BUCKET,
#   MESSAGING_SENDER_ID, APP_ID, MEASUREMENT_ID (same names as in .env)
```

### Android — shareable APK (free)

```bash
eas build -p android --profile preview
```

EAS returns a download link; send it to family. They tap it, allow "install
from this source," and it installs like a normal app. Re-run to ship updates.

### iPhone — TestFlight (needs the $99/yr Apple Developer Program)

```bash
eas build -p ios --profile production   # cloud build; no Mac required
eas submit -p ios                       # uploads to App Store Connect
```

Then in **App Store Connect → TestFlight**, add testers by email or enable a
public invite link. No public App Store listing and only a light review are
required. TestFlight builds expire after 90 days — rebuild to refresh.

> The app IDs are already set in [`app.json`](app.json)
> (`com.ramimouro.ginrummy`). Change them **before** your first build if you
> want a different identifier — they're permanent once published.

### Free / zero-account fallback

Family can instead install **Expo Go** and open your project over `eas update`
or a live `npx expo start --tunnel` session — no developer accounts, but it
needs the Expo Go app and isn't a standalone icon.

## 6. Web app / installable PWA

The exact same codebase also runs in a browser via `react-native-web`, and the
web export is configured as an **installable PWA** — friends can open a URL and
"Add to Home Screen" to get a full-screen app icon, no App Store or Expo Go.

### Build the static site

```bash
npx expo export --platform web
```

This writes a self-contained static site to `dist/` (git-ignored). The PWA
pieces come from two committed files:

- [`public/manifest.json`](public/manifest.json) + `public/icons/` — the web app
  manifest and the 192/512/apple-touch icons (copied verbatim to the site root).
- [`src/app/+html.tsx`](src/app/+html.tsx) — injects the `<link rel="manifest">`
  and the iOS "Add to Home Screen" meta tags into every page's `<head>`. This
  file is web-export-only and never affects the native app.

There is deliberately **no service worker**, so there's no stale-cache class of
bugs — the site always loads fresh. (Online play needs a connection anyway.)

> The Firebase config must be present at export time the same way it is for the
> dev server: fill in `.env` (§2). Because those `EXPO_PUBLIC_*` values are
> baked into the JS bundle, whoever you hand the built `dist/` to can play
> online without any further setup.

### Host it locally (your own machine)

`dist/` is just static files — serve them with anything. From the project root:

```bash
npx serve dist          # → http://localhost:3000
# or:  python -m http.server 8000 --directory dist
```

Open the URL in a browser to play. To let other devices on your Wi-Fi connect,
point them at your machine's LAN IP (e.g. `http://192.168.1.20:3000`).

> **Installing needs HTTPS** (browsers only offer "Install" over `https://`, with
> `localhost` exempted). So the desktop/local URL is fine for testing, but for
> the tap-to-install experience on phones you'll want the machine reachable over
> HTTPS — e.g. a self-signed cert on your LAN, or a tunnel like
> `cloudflared tunnel --url http://localhost:3000`.

### Install it

- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.
- **Android / desktop Chrome:** an **Install** icon appears in the address bar
  (or menu → *Install app*).

### Deploy to mouro.ai/gin-rummey (automatic)

The public site is hosted at **<https://mouro.ai/gin-rummey>** on a home server
(nginx; mouro.ai itself is a Django app). Two pieces make the **sub-path** work:

- [`app.json`](app.json) sets `experiments.baseUrl: "/gin-rummey"` so Expo
  prefixes every asset URL. [`src/app/+html.tsx`](src/app/+html.tsx) prefixes its
  hand-written `<link>` tags with `process.env.EXPO_BASE_URL`, and
  [`public/manifest.json`](public/manifest.json) uses **relative** paths — so the
  same export works at a domain root or any sub-path.
- An nginx `location /gin-rummey/` block (`root /home/rami`, SPA fallback to
  `index.html`) serves `/home/rami/gin-rummey/`, ahead of the site's `/` proxy.

**Auto-deploy:** [`.github/workflows/deploy-web.yml`](.github/workflows/deploy-web.yml)
runs on every push to `master` — it typechecks, tests, runs
`expo export --platform web`, then rsyncs `dist/` to the server. Required repo
**secrets**:

| Secret(s) | Value |
| --- | --- |
| `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT` | Same SSH access the mouro.ai repo uses |
| `EXPO_PUBLIC_FIREBASE_*` (all 8) | The same public values as your `.env` |

The one-time nginx block is installed on the server with
`sudo bash /home/rami/deploy-gin-rummey/install-nginx.sh` (backs up the config,
injects the block, runs `nginx -t`, reloads, and auto-rolls-back on failure).

### Invite links

The lobby's **Share invite link** button (and tapping the big room code) shares a
link instead of making your friend retype five characters:

```
https://mouro.ai/gin-rummey/join/ABCDE
```

Opening it lands on `src/app/join/[code].tsx`, which prefills the code and shows
a **Join** button. It deliberately **does not auto-join** — link-preview
crawlers in iMessage/WhatsApp/Slack fetch shared URLs, and an auto-join would let
a preview bot take the guest seat of a strictly 2-player room before the human
tapped anything.

> **`WEB_BASE_PATH` in [`src/util/invite.ts`](src/util/invite.ts) must match
> `experiments.baseUrl` in [`app.json`](app.json).** Nothing enforces this —
> app.json is JSON with no place for a comment, and `EXPO_BASE_URL` exists only
> in the web bundle, not on native. If you move the site to a different
> sub-path, change both.

These are ordinary https links, **not** universal links / app links: those need
an `apple-app-site-association` file and a custom native build, which this
project rules out (Expo Go only, no Mac). So link handling is whatever the OS
does with a normal web URL:

- **Android:** an installed PWA usually *captures* in-scope links, so the invite
  opens inside the installed app.
- **iOS:** home-screen web apps do **not** capture links. The invite opens in
  **Safari**, and Safari has **separate storage** from the installed web app —
  therefore a **different anonymous Firebase uid**. Consequence, plainly: *a game
  joined from a link in Safari will not appear in the installed app.* An iPhone
  user who has added the app to their home screen should open the app and type
  the code, or just keep playing in the Safari tab they joined from.

> This deploys the **website** only. Updating the installed iOS/Android app is
> the separate EAS channel (§5) — a PWA and a native binary are different
> deliverables built from the same code.

## How to play (and test with two devices)

Online gin rummy needs **two players**, so use two devices — for example your
Android emulator and your iPhone running Expo Go, both pointed at the same
`npx expo start` session.

1. On device A: enter a nickname → **Create game**. You'll land in a lobby with a
   5-letter code.
2. On device B: enter a nickname → **Join game** → type the code.
3. The host's device deals automatically once the guest joins, and both jump to
   the table.
4. On your turn: tap a pile to **draw** (stock or discard), tap a card to select
   it, then tap the discard pile to **discard**. When your deadwood is 10 or
   less, the **Knock** / **Gin** / **Big Gin** button appears.
5. Rounds continue to 100 points; then you can **Rematch**.

If you close the app mid-game, reopening it restores your seat (the anonymous
account is remembered) and the **Resume** banner on Home takes you back in.

## Project structure

```
src/
  engine/      Pure TS gin rummy rules engine (no React/Firebase) + Jest tests
  fb/          Firebase: config, firebase (singleton), auth, rooms, presence
  store/       Zustand state (gameStore = live game, settingsStore = prefs)
  util/        seed.ts (crypto seed + room code), invite.ts (invite link URLs)
  components/  Cards + hand, and table/ (piles, opponent bar, action controls,
               reveal modals) and ui/ (button, code input, screen)
  hooks/       use-hand-sort (display ordering)
  app/         expo-router screens: index (Home), join/ (index = manual entry,
               [code] = invite link), lobby/[code], game/[code]
               plus +html.tsx (web-only <head>: PWA manifest + iOS meta tags)
  theme/       Felt-table color palette
public/        Static web assets copied to the site root: manifest.json + icons/
firebase/      database.rules.json, firebase.json, .firebaserc
```

The game rules live entirely in `src/engine` as a pure, framework-free module
with a full Jest suite (including a 2,000-game fuzz test). Both players run the
same reducer; a move is written to Realtime Database inside a transaction, and
the security rules enforce turn order and membership.

## Troubleshooting

- **"Firebase not configured" / can't connect:** finish step 2 (paste config,
  including `databaseURL`).
- **`Component auth has not been registered yet` / Firebase assertion at
  runtime:** open [`metro.config.js`](metro.config.js) and uncomment the
  `unstable_enablePackageExports = false` line, then restart with
  `npx expo start -c`.
- **iPhone can't load the app over Wi-Fi:** use `npx expo start --tunnel`.
- **Keep Expo Go working on iPhone:** stay on **SDK 54** and never add native
  modules (`@react-native-firebase/*`, etc.) — the App Store Expo Go supports
  SDK 54, and there's no Mac fallback for a custom native build.
