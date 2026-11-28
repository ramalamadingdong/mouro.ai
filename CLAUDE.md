# mouro.ai — notes for coding agents

Monorepo for the personal site, the family games (five originals plus one new
cat game a week — see `games/WEEKLY.md`), and their realtime server.
Read the root `README.md` first, then the `AGENTS.md` in whichever folder you
are working in — those hold each project's non-negotiables.

## Layout

- `site/` — static HTML/CSS. No build step. Edit the HTML directly.
  `site/games/` (the games hub), `site/games/sudoku/`, `site/games/cat-cafe/` and the road trip games in `site/games/road-trip/` are deliberately
  separate from the portfolio: self-contained pages with their own styles,
  manifest and icons — they must not load `static/css/site.css`. Their icon
  PNGs come from the SVGs beside them via `scripts/render-icons.mjs`.
  `site/static/share/*.png` (link-preview cards) and `site/projects/<id>/index.html`
  (per-project share addresses) are written by `scripts/render-share-cards.mjs` —
  change the list in that script and re-run it, don't edit them by hand.
  `site/404.html` can be served at any path: root-relative addresses only.
- `games/<game>/` — independent apps with their own `package.json` and lockfile.
  Run npm inside the game folder. Never introduce npm workspaces or hoisting.
- `server/` — Node ≥22.13, plain ESM JavaScript, `ws` + built-in `node:sqlite`.
- `packages/realtime/` — the TypeScript client every game imports as
  `@mouro/realtime` (`file:` dependency). It must stay dependency-free and
  side-effect free at import (the Expo apps prerender in Node).
- `infra/` — Caddyfile (all routing), systemd unit, provision and activate scripts.

## Rules that matter

- **No Firebase.** The games use `@mouro/realtime`, which mirrors the Firebase
  RTDB modular API. If a game needs a database feature the client lacks, add it
  to `packages/realtime` and `server/` together, with a test in `server/test/`.
- **Security rules live in `games/<game>/database.rules.json`** and are enforced
  by `server/src/rules.js`. Changing a rule changes production behaviour on the
  next deploy — add or adjust a case in `server/test/realtime.test.js`.
- **Game namespaces are fixed** in `server/games.json` (`gin-rummy`,
  `backgammon`, `yahtzee`, `holdem`, `blackjack`, `dots`, `pawprints`, `tabby-eights`, `mahjong`, `road-trip`). Renaming one orphans its data.
- **URLs are fixed** — `/backgammon/`, `/gin-rummy/`, `/yahtzee/`, `/holdem/`, `/blackjack/`, `/dots/`, `/pawprints/`, `/tabby-eights/`, `/mahjong/`. Each is set
  in the app (Expo `experiments.baseUrl` + `WEB_BASE_PATH`, or Vite `base` +
  router `basename`) and in `infra/Caddyfile`; change them together.
- **Weekly games.** Only the newest one has a tile on the games hub (its
  "This week's game" spot); when a new one lands, the previous tile is removed
  from the hub, but its folder, namespace, rules, Caddy route, CI/deploy
  entries and tests all stay so its invite links keep working.
- **Road trip games.** The hub has two tabs: Mobile games (default) and Road
  trip games (`/games/#road-trip`). The road trip games are `site/games/road-trip/{trivia,photo,homes,categories}/`,
  each a page of markup sharing `site/games/road-trip/app.js` and `app.css`;
  `site/games/road-trip/index.html` only redirects old links.
- **No user may ever see another user's location.** That is the rule (the
  owner's words: "I don't mind it sent to mouro.ai, I just don't want a
  different user to see a different person's location"). Today the road trip
  pages send position only from the browser to OpenStreetMap and Wikimedia
  and store no places in localStorage, and their privacy notes say so
  (Home Price Guess also loads its state's home-value file from mouro.ai, so
  mouro.ai learns the state, never the position); if
  that changes (e.g. a mouro.ai lookup service), update the notes, never log
  or store positions where anyone else could read them, and keep them out of
  every realtime room. The `road-trip` realtime namespace (rules in
  `games/road-trip/`) is for the Categories word game only; its rules reject
  any other field.
- **Every new page and game gets the analytics tag.** See "Analytics" below;
  `scripts/check-analytics.mjs` fails CI if a page is missing it.
- Don't commit `.env` files, `server/data/`, or build output.

## Analytics (required on every new page and game)

The site and every game are tracked by a self-hosted Umami at
https://mouro.ai/stats (systemd `mouro-umami` on 127.0.0.1:3100, Caddy route
`/stats/*`, installed and upgraded with `infra/umami-setup.sh`). All tracking
goes through one file, `site/static/js/analytics.js`, which holds the website
ID, counts only the live `mouro.ai` hostname, never sends query strings, and
rewrites room codes (`/join|lobby|game/XXXXX`) to `:code`.

**When you add a page or a game, add this tag before `</head>`:**

| Kind | File | Tag |
|---|---|---|
| Static page in `site/` | the page's `.html` | `<script defer src="https://mouro.ai/static/js/analytics.js"></script>` |
| Vite game | `games/<game>/index.html` | same tag as above |
| Expo game | `games/<game>/src/app/+html.tsx` | `<script defer src="https://mouro.ai/static/js/analytics.js" />` |

- Always use the **absolute** address. Vite rewrites root-relative paths in
  `index.html` with its `base` (`/holdem/static/...` would 404), and the
  absolute URL also works from `404.html` at any path.
- Don't paste the Umami `script.js` tag or the website ID into a page; only
  `analytics.js` knows them.
- Instant-redirect pages are skipped on purpose (`site/projects/<id>/` share
  addresses, `site/games/road-trip/index.html`). Add any new one to `SKIP` in
  `scripts/check-analytics.mjs`, with the reason.
- A game whose URLs carry something private other than a room code must
  extend the clean-up in `analytics.js` first.
- **Custom events** (`window.umami?.track('name', { ... })`, always with `?.`
  because blockers and dev builds have no tracker): only coarse, anonymous
  facts, e.g. a mode or a player count. Never location, room codes, names,
  chat or anything a player typed.
- A page that touches location must say in its privacy note that visits are
  counted (see the road trip trivia and photo footers).
- Check with `node scripts/check-analytics.mjs`; it runs in CI.

## Verify before finishing

```bash
npm run typecheck && npm test        # from the repo root (includes the analytics check)
```

For UI changes, also `npm run build && npm run preview` and try it at
http://localhost:8080 with two browser windows.
