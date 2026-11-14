# Yahtzee

A no-signup online Yahtzee, shipped as a static PWA at
**https://mouro.ai/yahtzee/**.

- **Online, 1–4 players.** The host creates a room and shares a five-character
  code or an invite link. No account, no email — identity is an anonymous
  uid held in the browser.
- **Pass-and-play.** One device, 1–4 seats, no network at all. It runs the same
  reducer and the same screens as an online game.
- **Installable.** Add it to your home screen and it opens standalone. There is
  deliberately **no service worker**, so it will not launch offline — that trade
  buys never stranding a player on a stale cached bundle of a site that gets
  redeployed often.

Stack: Vite + React 19 + TypeScript (strict), React Router v7, zustand v5,
the mouro.ai realtime server via `@mouro/realtime`, plain CSS
custom properties, Vitest. No native app, no Expo, no React Native, no CSS-in-JS.

`src/engine/` is pure TypeScript with zero React / network / DOM imports, and
it is where the tests live — including a 2,000-game fuzz suite. See `AGENTS.md`
for the project's non-negotiables and `DESIGN.md` for the data model.

## Local development

```bash
npm install
npm run dev          # Vite dev server — note it serves at /yahtzee/, not /
npm test             # Vitest, engine suite
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve the built dist/ exactly as it will be deployed
```

`npm run typecheck` clean and `npm test` green are the bar before anything
ships. Both deploy paths gate on them.

Because `base` is `/yahtzee/`, the app lives at
`http://localhost:5173/yahtzee/` in dev too. Vite 302-redirects the bare root
there for you, so either URL works.

### Online play

Online play runs on the mouro.ai realtime server (`../../server`) through
`@mouro/realtime` — a Firebase-shaped API (`ref`, `runTransaction`, `onValue`,
`onDisconnect`, anonymous auth) over a WebSocket, stored in SQLite. There is no
third-party backend and nothing to sign up for.

- **Web:** nothing to configure — the page talks to `/rt` on its own host.
- **Locally:** `npm start` in `../../server`, then point the URL at
  `ws://localhost:8787/rt` via `VITE_REALTIME_URL`. Or build everything and run
  `npm run preview` at the repo root to get the whole site on one port.

The security rules are `database.rules.json` in this folder (Firebase rules
syntax). The server evaluates them on every read and write; they ship with the
server, so there is no separate rules deploy.

### Testing the PWA install

Install prompts require a **secure context**: HTTPS, with `http://localhost`
explicitly exempt. So installing works from `localhost` and from
https://mouro.ai/yahtzee/, but **not** from `http://192.168.x.x:5173` — testing
install on a phone over the LAN needs the deployed site, not the dev server.

### Icons

`public/icons/*.png` and `public/favicon.svg` are generated, not hand-drawn:

```bash
node scripts/make-icons.mjs
```

The script rasterises the die and encodes PNG using only `node:zlib`, so there
is no image dependency to install. Geometry is expressed as fractions of the
canvas, so every size is the same drawing, and the script hard-fails if the die
ever grows outside the maskable safe zone (the centre 80% circle Android may
crop to). Edit the constants at the top of the script and re-run; don't edit the
PNGs.

## The sub-path: three places that must agree

The app is served from `/yahtzee/` rather than a domain root, and **three
independent conventions** encode that. Getting any of them out of step yields a
blank page whose assets load fine with a 200 — the worst failure mode there is,
because nothing anywhere reports an error.

| Where | Value | Convention |
|---|---|---|
| `vite.config.ts` → `base` | `'/yahtzee/'` | leading **and trailing** slash |
| React Router → `basename` | `'/yahtzee'` | leading slash, **no** trailing one |
| `public/manifest.webmanifest` → `start_url` / `scope` / icon `src` | `'./'` | base-path-agnostic, no slash at all |

1. **Vite's `base`** prefixes every emitted asset URL. Without it the bundle
   requests `/assets/…`, which 404s under the sub-path.
2. **React Router's `basename`** strips the prefix before matching routes. If it
   carried a trailing slash it would not match, and every route would fall
   through to the not-found branch.
3. **The manifest's `./`** works because a manifest's relative URLs resolve
   against *the manifest's own URL* (`/yahtzee/manifest.webmanifest`) — so they
   land on `/yahtzee/` with no build-time substitution and no per-deployment
   edit. Absolute paths here would have to be hand-synced with Vite's `base`,
   and the failure is silent: the app still installs, then launches into the
   wrong scope.

`index.html` is a fourth consumer but not a fourth source of truth: its favicon,
apple-touch-icon and manifest links are written **root-relative**
(`/favicon.svg`), and Vite rewrites them to `base` in both dev and build. Note
the two tempting alternatives are both wrong there — `./favicon.svg` resolves
against the current deep route (`/yahtzee/game/AB3CD`), and `%BASE_URL%` gets
base applied twice by the dev server, so the icons 404 under `npm run dev` while
the production build looks fine.

Both deploy paths grep the built `dist/index.html` for `/yahtzee/assets/` and
refuse to ship if it's missing. That guard exists precisely because the failure
returns HTTP 200.

## Deploying

Pushing to `main` deploys: the repo's GitHub Actions workflow builds every app
and the server, and rsyncs the result to the VPS. See the root README.

## Layout

```
src/
  engine/     pure TS — no React, no network, no DOM. All the tests live here.
  net/        config, realtime, auth, rooms, presence
  store/      gameStore (online), localStore (pass-and-play), settingsStore
  theme/      tokens.css (:root custom properties) + tokens.ts (as const mirror)
  util/       seed.ts — crypto.getRandomValues, room codes
public/       manifest.webmanifest, favicon.svg, icons/
database.rules.json + RULES.md   security rules, enforced by ../../server
scripts/      make-icons.mjs
```

`src/theme/tokens.css` and `src/theme/tokens.ts` are mirrored **by hand** and
must be edited together, value for value. There is no codegen step, on purpose.
