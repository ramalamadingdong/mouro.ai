# mouro.ai — notes for coding agents

Monorepo for the personal site, three family games, and their realtime server.
Read the root `README.md` first, then the `AGENTS.md` in whichever folder you
are working in — those hold each project's non-negotiables.

## Layout

- `site/` — static HTML/CSS. No build step. Edit the HTML directly.
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
  `backgammon`, `yahtzee`). Renaming one orphans its data.
- **URLs are fixed** — `/backgammon/`, `/gin-rummy/`, `/yahtzee/`. Each is set
  in the app (Expo `experiments.baseUrl` + `WEB_BASE_PATH`, or Vite `base` +
  router `basename`) and in `infra/Caddyfile`; change them together.
- Don't commit `.env` files, `server/data/`, or build output.

## Verify before finishing

```bash
npm run typecheck && npm test        # from the repo root
```

For UI changes, also `npm run build && npm run preview` and try it at
http://localhost:8080 with two browser windows.
