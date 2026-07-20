# Yahtzee

A no-signup online Yahtzee, shipped as a static PWA at
**https://mouro.ai/yahtzee/**.

- **Online, 1–4 players.** The host creates a room and shares a five-character
  code or an invite link. No account, no email — identity is an anonymous
  Firebase uid held in the browser.
- **Pass-and-play.** One device, 1–4 seats, no network at all. It runs the same
  reducer and the same screens as an online game.
- **Installable.** Add it to your home screen and it opens standalone. There is
  deliberately **no service worker**, so it will not launch offline — that trade
  buys never stranding a player on a stale cached bundle of a site that gets
  redeployed often.

Stack: Vite + React 19 + TypeScript (strict), React Router v7, zustand v5,
Firebase JS SDK v12 (Realtime Database + Anonymous Auth, Spark plan), plain CSS
custom properties, Vitest. No native app, no Expo, no React Native, no CSS-in-JS.

`src/engine/` is pure TypeScript with zero React / Firebase / DOM imports, and
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

### Online play needs a `.env`

```bash
cp .env.example .env    # then paste your Firebase web config
```

Restart `npm run dev` afterwards — Vite reads `.env` at server start, not per
request. `.env.example` documents every variable and which two actually gate
connectivity.

**Without a `.env` the app still builds and runs.** `isFirebaseConfigured` is
false, online play is disabled in the UI, and **pass-and-play works exactly as
normal** because it never touches the network. An unconfigured build is a real,
shippable thing — just probably not the one you meant.

The Firebase web config is **not a secret**. It ships inside every client bundle
by definition; security is enforced by `firebase/database.rules.json`. `.env` is
git-ignored so the repo doesn't point at a live backend, not because leaking it
would be a breach.

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

Two paths, same result. Neither touches DNS, TLS or Cloudflare — the tunnel
already covers every path under mouro.ai, so a new sub-path needs zero
certificate work.

**Manual, from your working tree** (no commit or push needed):

```bash
npm run deploy                          # = bash scripts/deploy-web.sh
bash scripts/deploy-web.sh --skip-typecheck
```

It typechecks, tests, builds, then tars `dist/` over SSH to the NUC and swaps it
into `/home/rami/yahtzee/` with a single `mv`, so the live directory is never
half-written. It probes several addresses for the NUC because the box has no one
stable address; override with `NUC_SSH=user@host`.

**Automatic, on push:** `.github/workflows/deploy-web.yml` runs on every push to
`master` (and on `workflow_dispatch`), builds with the `VITE_FIREBASE_*` repo
secrets, and rsyncs `dist/` to the same directory. If a secret is unset the
build still succeeds and ships with online play disabled.

### One-time nginx install

Before the first-ever deploy, the nginx location block has to exist on the NUC.
Copy the whole `deploy/` directory to the box and run it there, once:

```bash
sudo bash install-nginx.sh
```

It injects `deploy/yahtzee.location` ahead of the Django catch-all proxy,
validates with `nginx -t`, and automatically restores its backup if validation
fails, so a bad edit cannot take mouro.ai down. It is idempotent — a second run
detects the existing block and exits cleanly. After it succeeds, deploys are
pure file syncs and never touch nginx again.

If a deploy reports the site returning something other than 200, this is the
first thing to check.

### Database rules deploy SEPARATELY

Neither deploy path ships `firebase/database.rules.json`. Nothing in this repo
does. Rules go up on their own:

```bash
firebase deploy --only database
```

**Until you run that, every write the rules are supposed to authorise is
denied — and mostly silently.** The default rules on a new project reject the
whole game path, and RTDB reports that asynchronously: presence, dice holds,
rematch votes and room cleanup swallow the rejection by design (they are
cosmetic and must never interrupt a game), so the symptom is not an error
message. It is a room that never appears, an opponent who never shows as online,
and a move that appears to land and then reverts. If online play is inexplicably
inert against a correctly configured project, deploy the rules.

`firebase/RULES.md` explains what every rule enforces and why — RTDB rules files
reject comments, so the reasoning lives next door. Read changes critically:
there is no emulator run in this project, and a broken rule fails as permission
denied everywhere, which looks exactly like a bug in the app.

## Layout

```
src/
  engine/     pure TS — no React, no Firebase, no DOM. All the tests live here.
  fb/         config, firebase, auth, rooms, presence
  store/      gameStore (online), localStore (pass-and-play), settingsStore
  theme/      tokens.css (:root custom properties) + tokens.ts (as const mirror)
  util/       seed.ts — crypto.getRandomValues, room codes
public/       manifest.webmanifest, favicon.svg, icons/
firebase/     database.rules.json + RULES.md
scripts/      deploy-web.sh, make-icons.mjs
deploy/       one-time nginx block + installer (run on the NUC)
.github/workflows/deploy-web.yml
```

`src/theme/tokens.css` and `src/theme/tokens.ts` are mirrored **by hand** and
must be edited together, value for value. There is no codegen step, on purpose.
