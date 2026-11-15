# Dots and Boxes — agent notes

Dots and Boxes, shipped as a static PWA at **https://mouro.ai/dots/**. Two
modes on one engine and one screen (`src/components/game-view.tsx`):

- **The cats** — offline, the human against 1–3 computer players.
- **Online rooms** — 2–4 humans, room code + invite link, no computer players.

The app shell (rooms, join, lobby, presence, auth, code input, modal) was
copied from `games/holdem` and changed as little as possible, so the two stay
recognisable side by side. When fixing a bug in one of those files, check the
other game too.

## Non-negotiable project constraints

- **Same stack as `games/holdem` and `games/yahtzee`**: Vite + React 19 +
  TypeScript (strict), React Router v7, zustand v5, plain CSS custom
  properties, Vitest, oxlint. Its own `package.json` and lockfile; never npm
  workspaces.
- **Sub-path.** Vite `base` is `'/dots/'`; the router `basename` is derived
  from `import.meta.env.BASE_URL` in `src/app.tsx`. `infra/Caddyfile`,
  `scripts/preview.mjs` and the deploy/CI workflows must agree with it.
- **Backend = the mouro.ai realtime server**, through `@mouro/realtime`. The
  namespace is `dots` (`server/games.json`); renaming it orphans every room.
- **`database.rules.json` is production behaviour.** Read `RULES.md` before
  touching it, and adjust the "dots rules" cases in
  `server/test/realtime.test.js`.
- **No service worker**, like the other games.
- **No image assets in the UI.** The board and cat faces are inline SVG. The
  only bitmaps are the app icons, rendered from `public/icons/icon.svg` by
  `scripts/render-icons.mjs`.

## The engine

`src/engine/` is pure TypeScript with no React / network / DOM imports, and
`src/ai/` depends only on the engine. They are the only layers with tests.

- **Edges and boxes are strings**, one character each: `.` or the seat digit
  of who drew / claimed it. A string is one scalar on the wire (it cannot be
  holed or reordered like an array) and the rules bound it with one regex.
  Edge numbering is in `board.ts`.
- `applyMove(state, move, uid)` never throws or mutates; the sender's uid is
  an argument. Every success path ends at `commit`, which bumps `version`,
  re-derives `turnUid` and stamps `lastMove`.
- **No randomness at all.** The first game is started by seat 0 (the host /
  the human); each rematch passes the first line to the next seat.
- **`away`** draws `autoEdge(state)` for the absent player — deterministic, so
  racing clients would all draw the same line — and sets `sitOut`, which the
  player's own next line clears.
- **`normalize()` is the only cheat detection**: every claimed box must have
  four drawn sides and every closed box must be claimed; marks must name real
  seats; the phase must match the board. Always run states through it, off
  the wire and out of localStorage.

## The cats (`src/ai/decide.ts`)

Difficulty is how well they play; the three cats differ only in looks.

- **easy** takes most free boxes, mostly avoids giving boxes away, sometimes
  draws anything.
- **medium** always takes a free box, never gives one away while a safe line
  exists, and when forced gives away the fewest boxes.
- **hard** adds the double-cross (decline the last two boxes of a chain so the
  opponent must open the next one) and hands over pairs by their middle line.
  It does not do full chain-parity counting; that would be the next step up.

The test in `src/ai/__tests__` checks that medium beats easy and hard beats
medium over many seeded games. Keep it passing when tuning.

## Pacing

Every cat line is its own visible step; all the numbers are in `CPU_PACE` in
`src/pace.ts` (about 1.1–1.9s per ordinary line, 0.55–0.85s per box while it
is eating a chain). The owner asked for computer players to be followable —
do not speed them up to make a test faster.

## Disconnects (online)

If the player on turn has no presence node, the other clients wait
`AWAY.graceMs` (30s; 2.5s once they are marked `sitOut`) and one sends `away`.
The rules allow it only while the presence node is absent. See
`src/hooks/use-online-away.ts` and RULES.md.

## Verify before finishing

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` clean; for
rules changes also `npm test --prefix ../../server`. For UI changes, build and
`npm run preview` from the repo root, then play a game against the cats and an
online game in two browser windows.
