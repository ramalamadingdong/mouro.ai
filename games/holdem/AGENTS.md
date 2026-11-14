# Texas Hold'em — agent notes

No-limit Texas Hold'em, shipped as a static PWA at
**https://mouro.ai/holdem/**. Two modes on one engine and one table component:

- **The cats** — offline, the human against 1–5 computer players.
- **Online rooms** — 2–6 humans, room code + invite link, no computer players.

## Non-negotiable project constraints

- **Same stack as `games/yahtzee`**, on purpose: Vite + React 19 + TypeScript
  (strict), React Router v7, zustand v5, plain CSS custom properties, Vitest,
  oxlint. No CSS-in-JS, no Tailwind, no native app. Its own `package.json` and
  lockfile; never npm workspaces.
- **Sub-path.** Vite `base` is `'/holdem/'`; the router `basename` is derived
  from `import.meta.env.BASE_URL` in `src/app.tsx` and never typed twice.
  `infra/Caddyfile` must agree with `base`.
- **Backend = the mouro.ai realtime server**, through `@mouro/realtime`
  (`file:../../packages/realtime`). Never Firebase. The namespace is `holdem`
  (`server/games.json`); renaming it orphans every room.
- **`database.rules.json` is production behaviour.** It ships with the server.
  Read `RULES.md` before touching it, and add or adjust a case in
  `server/test/realtime.test.js` ("holdem rules").
- **No service worker**, deliberately (same trade as the other games: never a
  stale cached bundle). Home-screen install works; a cold launch with no
  network does not, even though the cats need no server once loaded.
- **Path alias** `@/*` → `./src/*`, declared in `tsconfig.app.json` AND
  `vite.config.ts`.
- **No image assets in the UI.** Cards, suits, chips and the five cat faces are
  CSS and inline SVG. The only bitmaps are the app icons in `public/icons/`
  (the "cats playing poker" painting; the 1024px original is kept in
  `assets/cats-poker-1024.png`, outside `public/` so it is not deployed).

## The trust model — read this before "fixing" it

**Online play is client-authoritative, exactly like gin rummy.** The whole
`GameState` — every player's hole cards and the undealt deck — lives in
`rooms/<code>/state` and is readable by every seated player. Each client simply
does not *draw* cards that are not its own (`src/components/table.tsx` is the
one place that decides). A player with a modified client or the browser
devtools can see everyone's cards and the cards to come. That is accepted:
this is "casual play between friends", there is no money, and hiding hole
cards properly needs server-side dealing, which was explicitly ruled out.
Do not add half-measures (obfuscating the deck, splitting cards across nodes):
they add complexity and stop nobody. Outsiders are kept out — a `playing` room
is unreadable to anyone not seated.

## The engine is the point

`src/engine/` is pure TypeScript with **zero React / network / DOM imports**,
and `src/ai/` depends only on the engine. Both run in plain Node; they are the
only layers with tests.

- `applyMove(state, move, uid)` returns `{ ok, state } | { ok: false, error }`
  and never throws or mutates. The sender's uid is an argument, not a field on
  the move, so a payload cannot lie about who sent it.
- **All randomness is a seed inside the move that consumes it** (`deal`,
  `rematch`). Nothing in the engine calls `Math.random()`; `crypto` lives in
  `src/util/seed.ts`. A game replays exactly from options + ordered move log.
- **The dealer is explicit.** A closed betting round does NOT deal the next
  street: it sets `toAct = null` / `turnUid = '*'` and waits for a `next` move;
  a finished hand waits for `deal`. That is what lets the UI pace the deal and
  hold the showdown without the engine knowing about time, and it means that
  online the screen always shows exactly what is in the database. `next`
  carries the phase it was sent from, so two clients racing cannot advance two
  streets.
- `legalActions(state)` is the *only* statement of what the player on turn may
  do. The action bar, the cats and the fuzz test all read it.
- Every success path ends at the one commit point in `applyMove`, which bumps
  `version`, re-derives the denormalized `turnUid`, and stamps `lastMove` — the
  three things the database rules read.
- `pots.ts` (side pots, odd chips) is separate from the reducer so it can be
  tested alone. It is the part of poker software most often subtly wrong.

### Rules decisions worth knowing

- **Heads-up:** the button posts the small blind and acts first preflop.
- **Min-raise** is the size of the last full raise. A short all-in does not
  reopen the betting: players who already acted may call or fold only (the
  `acted` flag). Not implemented: several short all-ins *adding up* to a full
  raise reopening it.
- **Uncalled bets** are returned when the round closes (`refundUncalled`), so
  the pot on screen is the pot being played for.
- **A short big blind** still sets the price to call at the full big blind;
  what nobody could match is refunded.
- **Odd chips** go one each to the winners nearest the button's left.
- **Moving button**, not the casino dead-button rule: it passes to the next
  player with chips.
- **Blinds** start at 10/20 and step up every N hands (`RULES.BLIND_MULTIPLIERS`,
  doubling past the end of the table) so every game finishes.
- **Everyone left shows at showdown** — there is no mucking.
- **Game over** when one player has every chip, or no *human* has chips
  (offline: the human busting ends it even if cats remain).

## Things that have specific reasons

- **Always `normalize()` a state before use** — off the wire AND out of
  localStorage. The realtime DB prunes nulls and empty collections and returns
  holed arrays as integer-keyed objects: `toAct: null`, `result: null`,
  `board: []` and the null seats of `result.hands` all vanish in transit.
- **Seat-indexed collections are read by explicit index, never by key order.**
  Compacting a sparse node slides one player's hand onto another's seat.
- **`0` is a real value** (`toAct: 0` is seat 0, `won: 0` is "won nothing").
  Test with `=== null` / `Number.isInteger`, never truthiness.
- **`normalize()` is also the only cheat detection.** It rejects a state whose
  chips do not sum to `players × startingStack` or whose 52 cards are not all
  present exactly once. The server checks who may write, never what.
- **Presence is a sibling node, never inside `state`**, and is a bare number
  (see RULES.md on why every node a non-host writes must be a scalar).
- **Every online move is a transaction with `applyLocally: false`**
  (`net/rooms.ts → submitMove`): the screen only ever shows states the server
  accepted.
- **`RoomLayout` in `app.tsx` is the one owner of the room subscription.** Do
  not move `bindRoom` into a route: lobby → table must not reconnect, and any
  exit must tear down the presence writer.
- **Room codes always contain a digit** and the input extracts a code from a
  pasted invite (`extractRoomCode`): both are in `src/util/seed.ts`, copied
  from yahtzee with its tests. Keep the alphabet and length identical to the
  regex in `database.rules.json`.

## Pacing (the owner asked for this explicitly)

Computer players in the other games acted too fast to follow. Here every cat
action is its own timed step, and **every number is in the `CPU_PACE` block in
`src/pace.ts`**: 0.9–1.6s for a fold/check, 1.4–2.8s for a call/bet/raise,
2.4–3.5s for an all-in or a call for half the stack, 0.7–1.0s before each
street, with uniform jitter. The cat's move is decided *before* its timer
starts (so the pause can depend on it), the seat shows a "thinking" ring and
dots while it runs, and the showdown never advances by itself — it waits for
a tap. The only speed-up is the "Skip ahead" button the human can press after
folding. Do not shorten these to make a test faster; pass a different
constant.

Online there are no cats, so no artificial thinking time: only the street
pause (before a client sends `next`) and the held showdown.

## Disconnects (online)

One closed phone must not freeze the table. If the player on turn has no
presence node, the other clients wait `AWAY.graceMs` (30s) and one of them
sends an `away` move, which checks (if free) or folds for that player and sets
`sitOut`. While `sitOut` is set, later turns are skipped after ~2.5s instead of
30s; the player's own next action clears it. The rules allow `away` only while
the presence node is absent; the 30 seconds are client-side good manners and
cannot be enforced (the rules language has no "absent since"). Blinds keep
being posted for an absent player, so they bleed out and the game still ends.
Dealing the next street / next hand / a rematch can be done by any seated
player, so none of those can stall either. Details: `src/hooks/use-online-dealer.ts`
and RULES.md.

## Verify before finishing

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` clean; for
rules changes also `npm test --prefix ../../server`. For UI changes, play it:
`npm run preview` from the repo root serves every built game plus a throwaway
realtime server (note that script listens on all interfaces).
