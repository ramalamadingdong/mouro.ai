# Cat Café — agent notes

A tile-drafting puzzle, shipped as a static PWA at **https://mouro.ai/cat-cafe/**.
Two modes on one engine and one screen (`src/components/game-view.tsx`):

- **The cats** — offline, the human against 1–3 computer players.
- **Online rooms** — 2–4 humans, room code + invite link, no computer players.

The app shell (rooms, join, lobby, presence, auth, code input, modal) was
copied from `games/dots` (which took it from `games/holdem`) and changed as
little as possible, so they stay recognisable side by side. When fixing a bug
in one of those files, check the other games too.

`/games/cat-cafe/` was this game's address when it was a single static page;
`infra/Caddyfile` redirects it here.

## Non-negotiable project constraints

- **Same stack as `games/dots`, `games/holdem` and `games/yahtzee`**: Vite +
  React 19 + TypeScript (strict), React Router v7, zustand v5, plain CSS custom
  properties, Vitest, oxlint. Its own `package.json` and lockfile; never npm
  workspaces.
- **Sub-path.** Vite `base` is `'/cat-cafe/'`; the router `basename` is derived
  from `import.meta.env.BASE_URL` in `src/app.tsx`. `infra/Caddyfile`,
  `scripts/preview.mjs` and the deploy/CI workflows must agree with it.
- **Backend = the mouro.ai realtime server**, through `@mouro/realtime`. The
  namespace is `cat-cafe` (`server/games.json`); renaming it orphans every room.
- **`database.rules.json` is production behaviour.** Read `RULES.md` before
  touching it, and adjust the "cat-cafe rules" cases in
  `server/test/realtime.test.js`.
- **No service worker**, like the other games.
- **No image assets in the UI.** Floors and cats are SVG built by
  `src/components/draw.ts`. The only bitmaps are the app icons, rendered from
  `public/icons/icon.svg` by `scripts/render-icons.mjs`.

## The game

Each round, players + 2 cats wait at the door. In turn, every player takes one
and seats it on their own 7×7 floor (or sends it away). The first pick moves
one seat along every round. Twelve rounds. Scoring (`engine/score.ts`): +2 per
pair of touching cats with the same coat, −3 per pair of touching rivals
(Ginger/Smoke, Tuxedo/Snow), +5 per full row.

## The engine

`src/engine/` is pure TypeScript with no React / network / DOM imports, and
`src/ai/` depends only on the engine. They are the only layers with tests.

- **The door and the floors are strings** (`tiles.ts`): a tile is coat letter +
  shape digit, a seated cat is tile + orientation + x + y. A string is one
  scalar on the wire (it cannot be holed or reordered like an array) and the
  rules bound it with one regex.
- **Round and turn are derived from `picks`** (`seatOnTurn`), never stored
  independently; `toAct` / `turnUid` are denormalized copies for the rules.
- `applyMove(state, move, uid, rnd)` never throws or mutates; the sender's uid
  is an argument. Every success path ends at `commit`.
- **Randomness is an argument.** The only random thing is which cats come to
  the door, and whoever makes the pick that ends a round draws them. There is
  no hidden deck in the state. The engine never calls `Math.random`; the stores
  and `net/rooms.ts` pass it in.
- **`away`** plays `autoMove(state)` for the absent player — deterministic —
  and sets `sitOut`, which the player's own next pick clears.
- **`normalize()` is the only cheat detection**: cats must be on the floor and
  not overlap, nobody may have more cats than turns, the door must be missing
  exactly this round's picks, and phase and turn must match `picks`. Always run
  states through it, off the wire and out of localStorage.

## The cats (`src/ai/decide.ts`)

Difficulty is how well they play; the three cats differ only in looks. Every
legal placement gets a value: **easy** is points plus a lot of noise,
**medium** also likes big cats, **hard** also avoids unfillable gaps, builds
rows, and weighs what a cat is worth to the next player. A test checks that
hard clearly beats easy over a run of seeded games.

## Pacing

Every cat pick is its own visible step; the numbers are in `CPU_PACE` in
`src/pace.ts`. The owner asked for computer players to be followable — do not
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
