# Pawprints — agent notes

Five in a row with paw prints on a quilt, shipped as a static PWA at
**https://mouro.ai/pawprints/**. The first weekly cat game (added
2026-11-15; see `../WEEKLY.md`). Two modes on one engine and one screen
(`src/components/game-view.tsx`):

- **The cats** — offline, the human against 1–3 computer players.
- **Online rooms** — 2–4 humans, room code + invite link, no computer players.

The app shell (rooms, join, lobby, presence, auth, code input, modal) was
copied from `games/dots` (which took it from `games/holdem`) and changed as
little as possible. When fixing a bug in one of those files, check the other
games too.

## Non-negotiable project constraints

- **Same stack as `games/dots`, `games/holdem` and `games/yahtzee`**: Vite +
  React 19 + TypeScript (strict), React Router v7, zustand v5, plain CSS
  custom properties, Vitest, oxlint. Its own `package.json` and lockfile;
  never npm workspaces.
- **Sub-path.** Vite `base` is `'/pawprints/'`; the router `basename` is
  derived from `import.meta.env.BASE_URL` in `src/app.tsx`.
  `infra/Caddyfile`, `scripts/preview.mjs` and the deploy/CI workflows must
  agree with it. The URL is fixed: invite links depend on it.
- **Backend = the mouro.ai realtime server**, through `@mouro/realtime`. The
  namespace is `pawprints` (`server/games.json`); renaming it orphans every
  room.
- **`database.rules.json` is production behaviour.** Read `RULES.md` before
  touching it, and adjust the "pawprints rules" cases in
  `server/test/realtime.test.js`.
- **No service worker**, like the other games.
- **No image assets in the UI.** The quilt, paws and cat faces are inline
  SVG. The only bitmaps are the app icons, rendered from
  `public/icons/icon.svg` by `scripts/render-icons.mjs`.
- **Light and dark.** `src/theme/tokens.css` has a night palette under
  `prefers-color-scheme: dark`; `index.html` repeats `--page` for both in its
  anti-flash style. Change them together.

## The engine

`src/engine/` is pure TypeScript with no React / network / DOM imports, and
`src/ai/` depends only on the engine. They are the only layers with tests.

- **The board is one string**, `size × size` characters row by row: `.` or
  the seat digit of the paw there. One scalar on the wire, bounded by one
  regex in the rules. Geometry is in `grid.ts`.
- **Line length** is `needFor(players)`: 5 for two players, 4 for three or
  four (five is nearly unwinnable when everyone blocks). Longer lines count.
- `applyMove(state, move, uid)` never throws or mutates; the sender's uid is
  an argument. Every success path ends at `commit`, which bumps `version`,
  re-derives `turnUid` and stamps `lastMove`.
- **No randomness at all.** The first game is started by seat 0 (the host /
  the human); each rematch passes the first paw to the next seat, which is
  the only fairness measure (the first player has the edge in gomoku; there
  is no swap rule or renju restriction — this is casual freestyle).
- **`away`** plays `autoCell(state)` for the absent player — deterministic
  (win, else block the next player, else best window score, ties to the
  middle), so racing clients would all play the same point — and sets
  `sitOut`, which the player's own next paw clears.
- **`normalize()` is the only cheat detection.** Nobody ever passes, so the
  board alone says whose turn it is: paw counts must step down by at most one
  in turn order from `starter`, `toAct` must be the next seat, any finished
  line must belong to whoever played last and run through `lastMove.cell`,
  and the phase must match. Always run states through it, off the wire and
  out of localStorage.
- `threat.ts` is the shared position measure: for each point, the windows of
  `need` points through it that hold no other seat's paw, weighted by how
  full they are. `autoCell` and every cat use it.

## The cats (`src/ai/decide.ts`)

Difficulty is how well they play; the three cats differ only in looks.

- **easy** usually takes a win and usually blocks one, otherwise picks among
  the six best-looking points, and sometimes wanders.
- **medium** always wins when it can, always blocks the next player's win,
  otherwise plays the best window score (small random tie-break).
- **hard** adds forks (two winning threats at once) and a one-move look
  ahead that discounts points leaving the next player a strong reply.

The test in `src/ai/__tests__` checks that medium beats easy and hard beats
medium over seeded games on 13×13 (many hard-vs-medium games are draws; the
test asks hard to win more than it loses). Keep it passing when tuning.

## UI notes

- A **touch** only chooses a point (a pulsing ghost paw); the "Leave a paw
  here" button or a second tap on the same point plays it. A **mouse** click
  plays at once. The pointer type is remembered from `pointerdown` because
  Safari's `click` has no `pointerType`.
- Paw pieces differ by colour and by the ring inside them, so colour is not
  the only cue.
- Do not put a CSS `transform` animation on the paw groups: it replaces the
  SVG `translate` attribute and the paw jumps to the corner.

## Pacing

Every cat paw is its own visible step; the numbers are in `CPU_PACE` in
`src/pace.ts` (1.1–1.9s per ordinary paw, 0.8–1.2s when someone is one paw
from a line). The owner asked for computer players to be followable — do not
speed them up to make a test faster.

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
