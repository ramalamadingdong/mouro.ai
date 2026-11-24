# Mahjong — agent notes

Japanese (Riichi) and Hong Kong mahjong, four-handed or heads-up, shipped as
a static PWA at **https://mouro.ai/mahjong/**. One engine and one table screen
(`src/components/game-view.tsx`) serve:

- **The cats** — offline, the human against three computer cats, or one heads-up.
- **Online rooms** — two people heads-up, or 2–4 at a four-player table where
  **cats fill the empty seats** and the host's device plays them.
- **Teaching** — guided lessons (`routes/learn.tsx`, data in
  `learn/lessons.tsx`), the coach during play (`ai/decide.ts → advise`, shown
  when the player's `table.coach` setting is on), and the reference tabs in
  `components/help.tsx`.

The owner asked for all three ways of teaching, both rulesets, and a
two-player version (2026-11-22). Riichi is the default ruleset.

The app shell (rooms, join, lobby, presence, auth, code input, modal) was
copied from `games/dots` (itself from `games/holdem`) and changed as little as
possible. When fixing a bug in one of those files, check the other games too.

## Non-negotiable project constraints

- **Analytics tag stays in the page head** (`index.html`, or `src/app/+html.tsx` for
  Expo): `https://mouro.ai/static/js/analytics.js`. See "Analytics" in the root
  `CLAUDE.md`; CI fails without it.
- **Same stack as `games/dots` and `games/holdem`**: Vite + React 19 +
  TypeScript (strict), React Router v7, zustand v5, plain CSS custom
  properties, Vitest, oxlint. Its own `package.json` and lockfile; never npm
  workspaces.
- **Sub-path.** Vite `base` is `'/mahjong/'`; the router `basename` is derived
  from `import.meta.env.BASE_URL` in `src/app.tsx`. `infra/Caddyfile`,
  `scripts/preview.mjs` and the deploy/CI workflows must agree with it.
- **Backend = the mouro.ai realtime server**, through `@mouro/realtime`. The
  namespace is `mahjong` (`server/games.json`); renaming it orphans every room.
- **`database.rules.json` is production behaviour.** Read `RULES.md` before
  touching it, and adjust the "mahjong rules" cases in
  `server/test/realtime.test.js`.
- **No service worker**, like the other games.
- **No image assets in the UI.** Tiles and cat faces are inline SVG
  (`components/tile.tsx`, `components/avatar.tsx`). The only bitmaps are the
  app icons, rendered from `public/icons/icon.svg` by `scripts/render-icons.mjs`.

## The engine

`src/engine/` is pure TypeScript with no React / network / DOM imports, and
`src/ai/` depends only on the engine. They are the only layers with tests.

- **Two rulesets, one reducer.** `config.ruleset` is `'riichi'` or `'hk'`;
  everything that differs sits behind `isRiichi(state)` in `reducer.ts`.
  Riichi scoring is `riichi.ts` (yaku, dora, fu, limits, payments), Hong Kong's
  `scoring.ts`. Both feed one `Win` shape. **Seats are 2 or 4**
  (`state.players.length`); never assume 4 — `next()`, `pendingSeats()` and
  the claim order all use the length. Heads-up: chi from your one opponent;
  a tsumo is paid in full by them (`riichiPayments`); a Riichi draw pays 1,500
  instead of 3,000.
- **Riichi's dead wall** is three strings: `rinshan` (4 replacement tiles,
  topped up from the back of the live wall after each kan, so the live wall
  shrinks), `dora` and `ura` (5 indicators each, `doraShown` turned over).
- **Points are conserved**: scores + `sticks × 1000` = start × seats (0 for
  Hong Kong, 25,000 for Riichi). `normalize()` checks it.
- **Riichi state per player**: `riichi`, `riichiAt` (the sideways discard),
  `ippatsu` (cleared by their next discard or any call/kan), `furiten`
  (temporary: set when a winning tile goes by — passed or unclaimable — and
  cleared by their own discard unless in riichi). Permanent furiten (a wait in
  your own discards) is computed, not stored. A riichi whose own tile is ronned
  is refunded. Double riichi is "riichi on your first discard" — a call before
  that discard is not tracked (rare, in the player's favour).
- Not implemented (Riichi): red fives, abortive draws, nagashi mangan, double
  yakuman, kuikae, pao, agari-yame, uma/oka. Say so if asked.
- **A tile is one character** (`tiles.ts`): its index in `ALPHABET` is its
  kind, 0–33 playing tiles (four of each), 34–41 flowers and seasons (one
  each). Hands, melds, discards and the wall are strings — one scalar each on
  the wire, bounded by one regex in the rules. Melds are comma separated, a
  type letter then the tiles (`c` chow, `p` pung, `k` kong, `h` concealed kong).
- `applyMove(state, move, uid)` never throws or mutates. **A move names its
  seat** and the reducer checks `players[seat].uid === uid`. Online, cats carry
  the host's uid, which is how the host's device is allowed to move for them
  (and why `mySeat` is the first seat with your uid — the host is always seat 0).
- **Tile shorthand** (`notation.ts`, `t('123m 55z')`) is for lessons, the
  reference and tests; `<Notation n="…" />` renders it inline.
- **All randomness is a seed inside the move that deals** (`createGame`,
  `next`, `rematch`; `util/seed.ts → randomSeed`). Nothing in the engine calls
  `Math.random()`.
- **Phases:** `turn` (toAct has 14 and must discard / kong / win) →
  `claim` (a tile on offer; `claim.asks` has `?` for each seat that *could*
  call it — seats with nothing to call are never asked) → resolution
  (Mahjong, nearest seat first; then pung/kong; then chow; else the next seat
  draws) → `scored` / `gameover`. Drawing is automatic, including flower and
  kong replacements off the back of the wall.
- **Robbing a kong:** adding a tile to a pung opens a `claim` with
  `rob: true` where only Mahjong can be called.
- Hong Kong scoring (`scoring.ts`; Riichi's `riichi.ts` works the same way) tries every split of the concealed tiles and keeps
  the best. Limit is 10 faan; `POINTS` maps faan to points. Discarder pays
  double and the others single; self-drawn, all three pay double.
- **Dealer:** Hong Kong — stays on a dealer win or a drawn hand; Riichi —
  stays on a dealer win or when the dealer is ready at a draw (honba +1 either
  way, reset when someone else wins). Otherwise the deal passes on. When the
  deal returns to seat 0 the round wind moves on; `config.rounds` (Hong Kong 1
  or 4, Riichi 1 or 2) ends the game, and so does any Riichi score below zero. The last hand's result is shown in `gameover` (no `scored` step).
- **`normalize()` is the only cheat detection**: every tile of the ruleset's
  set (144 / 136) present exactly once (wall + dead wall + hands + melds +
  flowers + discards + a tile being robbed), hand sizes 13 (14 for whoever is
  on turn or has just won), points conserved. Old saved games without
  `ruleset` read as Hong Kong. Always run states through it, off the wire and out of localStorage.

## The cats and the coach (`src/ai/decide.ts`)

Riichi cats declare riichi whenever ready and closed (easy: 60%), throw the
drawn tile once in riichi, and only call when the hand keeps an obvious yaku
route (a scoring-honour pon, all simples, or one suit); hard cats also fold
against riichi using tiles the riichi player threw. `advise()` is medium's
decision plus one sentence of why — the coach. Keep it deterministic.

Shanten (distance to ready, computed one suit at a time and memoised — the
naive recursion is exponential) and ukeire (unseen tiles that improve the
hand). The three cats differ only in looks; difficulty is the table's choice.
`src/ai/__tests__` plays whole four-cat games through `normalize()` and checks
the better cats outscore easy. To compare levels, play a few hundred seeded
games — under a hundred is noise.

## Pacing

Every cat move is a visible step; the numbers are in `CPU_PACE` in
`src/pace.ts` (1.0–1.7s per throw, 0.7–1.1s per call decision). The owner asked
for computer players to be followable — do not speed them up to make a test
faster. Hands are dealt by a tap ("Next hand"), never automatically.

## Disconnects (online)

`hooks/use-online-away.ts`: if the table is waiting on a seat (on turn, or
deciding a claim) whose uid has no presence node, the other clients wait
`AWAY.graceMs` (30s; 2.5s once `sitOut`) and one sends `away`, which throws the
drawn tile or passes. That covers a host who leaves (their cats stop) as well.

## Verify before finishing

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` clean; for
rules changes also `npm test --prefix ../../server`. For UI changes, build and
`npm run preview` from the repo root, then play a hand against the cats and an
online game in two browser windows.
