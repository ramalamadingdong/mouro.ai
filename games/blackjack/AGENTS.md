# Blackjack — agent notes

Blackjack against a dealer cat, shipped as a static PWA at
**https://mouro.ai/blackjack/**. Built on the Texas Hold'em app's shell (same
stack, same room/seat/presence code, same pacing and trust model), with the
table opened up to eight seats. Two modes on one engine and one table
component:

- **The cats** — offline, the human plus 0–7 computer players.
- **Online rooms** — 2–8 humans, room code + invite link, no computer players.

Everyone plays against the house (Duchess, `DEALER` in `src/ai/cats.ts`),
never against each other; she is not a seat and not in `players`.

## Non-negotiable project constraints

- **Same stack as `games/holdem`** (and so `games/yahtzee`), on purpose: Vite +
  React 19 + TypeScript (strict), React Router v7, zustand v5, plain CSS
  custom properties, Vitest, oxlint. No CSS-in-JS, no Tailwind, no native app.
  Its own `package.json` and lockfile; never npm workspaces.
- **Sub-path.** Vite `base` is `'/blackjack/'`; the router `basename` is
  derived from `import.meta.env.BASE_URL` in `src/app.tsx` and never typed
  twice. `infra/Caddyfile` must agree with `base`.
- **Backend = the mouro.ai realtime server**, through `@mouro/realtime`
  (`file:../../packages/realtime`). Never Firebase. The namespace is
  `blackjack` (`server/games.json`); renaming it orphans every room.
- **`database.rules.json` is production behaviour.** It ships with the server.
  Read `RULES.md` before touching it, and add or adjust a case in
  `server/test/realtime.test.js` ("blackjack rules").
- **No service worker**, deliberately (same trade as the other games: never a
  stale cached bundle).
- **Path alias** `@/*` → `./src/*`, declared in `tsconfig.app.json` AND
  `vite.config.ts`.
- **No image assets in the UI.** Cards, suits, chips and the cat faces are CSS
  and inline SVG. The only bitmaps are the app icons in `public/icons/`,
  rendered from `public/icons/icon.svg` by `scripts/render-icons.mjs`.

## The trust model — read this before "fixing" it

**Online play is client-authoritative, exactly like Hold'em and gin rummy.**
The whole `GameState` — including the dealer's hole card and the order of the
shoe — lives in `rooms/<code>/state` and is readable by every seated player.
Players' own cards are face up in blackjack anyway; the only secrets are the
hole card and the shoe, and each client simply does not *draw* the hole card
until `holeCardShown(state)` (`src/components/table.tsx` is the one place that
decides). A modified client could peek. Accepted: casual play between friends,
no money, and hiding it properly needs server-side dealing, which was ruled
out for Hold'em and is ruled out here. No half-measures. Outsiders are kept
out — a `playing` room is unreadable to anyone not seated.

## The engine is the point

`src/engine/` is pure TypeScript with **zero React / network / DOM imports**,
and `src/ai/` depends only on the engine. Both run in plain Node; they are the
only layers with tests (including a fuzz test of 3,000+ random rounds that
checks every invariant and the wire round-trip after every move).

- `applyMove(state, move, uid)` returns `{ ok, state } | { ok: false, error }`
  and never throws or mutates. The sender's uid is an argument, not a field on
  the move.
- **All randomness is a seed inside the move that consumes it** (`deal`,
  `rematch` — the shoe is shuffled there). Nothing in the engine calls
  `Math.random()`. The one other "shuffle" — a monster round that empties the
  shoe reshuffles the discards — is seeded from the state itself, so every
  client agrees.
- **The dealer is explicit.** Nothing happens by itself between players:
  after the last bet, `toAct = null` / `turnUid = '*'` and a `next` deals the
  cards; after the last hand, a `next` turns the hole card; then one `next`
  per dealer card, and a final one settles. A settled round waits for `deal`.
  `next` carries the phase AND the dealer's card count it was sent from, so
  two clients racing cannot advance two steps.
- `legalActions(state)` is the *only* statement of what the seat on turn may
  do (a `bet` range, or which of hit/double/split). The action bar, the cats
  and the fuzz test all read it.
- Every success path ends at the one commit point in `applyMove`, which bumps
  `version`, re-derives the denormalized `turnUid`, and stamps `lastMove`.

### Rules decisions worth knowing

- **Six decks**, reshuffled between rounds when fewer than 78 cards (the cut
  card) remain. Each physical card is its own number 0..311, so "every card
  once" stays checkable.
- **Las Vegas Strip rules** (the owner asked for "real casino rules, Vegas
  rules"). **Dealer hits soft 17** (`RULES.DEALER_HITS_SOFT_17`), and
  **peeks** for blackjack under an Ace or a ten: a dealer blackjack settles at
  once, before anyone can double or split.
- **Tipping the dealer**: a `tip` move, only on your own betting turn, any
  number of times, never leaving less than the minimum bet (`maxTip`). Tips
  go to `house` (so chips still add up) and to `player.tipped`, shown on
  the final standings; Duchess reacts by size.
- **No insurance** (and so no even money): the owner tried it and took it
  out. The dealer peeks under an Ace or a ten straight after the deal.
- **Late surrender** on the first two cards of an unsplit hand, after the
  peek: half the bet back (rounded down).
- **Blackjack pays 3:2, rounded down to a whole chip.** Bets move in steps of
  5 (`RULES.BET_STEP`) so the 10/25/50/100 betting chips all work, which
  means a 25 bet's blackjack pays 37 (not 37½). Table limits 10–500, capped
  at the stack.
- **Double** on any first two cards, including after a split. **Split** any
  two cards of the same value (K-Q splits), up to four hands; split Aces get
  one card each; a two-card 21 after a split is a plain 21, paid 1:1. A hand
  that reaches 21 stands by itself.
- **Betting goes round in seat order**, one seat at a time (the rules need a
  single `turnUid`). A bet of 0 sits the round out.
- **The house has a bottomless bank**, tracked as `house` (net chips it has
  won, negative when the table is ahead). That is what keeps chips checkable:
  stacks + chips on the table + house = seats × startingStack.
- **Game over** after the configured number of rounds (10/20/40), or when no
  *human* can afford the minimum bet. Most chips wins.

## Things that have specific reasons

- **Always `normalize()` a state before use** — off the wire AND out of
  localStorage. The realtime DB prunes nulls and empty collections and returns
  holed arrays as integer-keyed objects: `toAct: null`, `result: null`,
  `hands: []`, `dealer: []`, a fresh bet's `cards: []` and a hand's null
  `outcome` all vanish in transit.
- **Seat-indexed collections are read by explicit index, never by key order.**
- **`0` is a real value** (`toAct: 0` is seat 0, `net: 0` is a push, `house:
  0`). Test with `=== null` / `Number.isInteger`, never truthiness.
- **`normalize()` is also the only cheat detection.** It rejects a state whose
  chips (with the house) do not add up or that has any card in two places.
  The server checks who may write, never what.
- **Presence is a sibling node, never inside `state`**, and is a bare number.
- **Every online move is a transaction with `applyLocally: false`**
  (`net/rooms.ts → submitMove`).
- **`RoomLayout` in `app.tsx` is the one owner of the room subscription.**
- **Room codes always contain a digit** (`src/util/seed.ts`, from yahtzee via
  Hold'em). Keep the alphabet and length identical to the rules regex.

## The table layout (8 seats on a phone)

Duchess sits top-centre with her cards. The other seats go up the left rail
and down the right one, up to four per side, placed by percentage
(`seatPlaces` in `table.tsx`); each seat's hands fan inward beside it. The
human sits on the near rail with their hands at full size (smaller once
split). In a hand, a card shows its rank in the top-left corner and the suit
pip in the opposite one, so a fanned hand still shows every rank — in
blackjack the suit never matters.

## Pacing (the owner asked for this explicitly)

Every cat action and every dealer step is its own timed step, and **every
number is in the `CPU_PACE` block in `src/pace.ts`**: 1.1–2.0s for a cat's
bet, 0.9–1.6s for a hit or stand, 1.8–2.8s for a double or split, 0.8–1.2s
before each dealer step (deal, hole card, each card drawn). The cat's move is
decided *before* its timer starts, the seat shows a "thinking" ring and dots,
and the settled round never advances by itself — it waits for a tap. The only
speed-up is the "Skip ahead" button, offered once the human's own hands are
finished.

Online there are no cats: only the dealer pause before each `next` and the
held result.

## Never scroll the table

The table screen must fit the viewport at every size with no page scroll,
whatever Duchess is saying (the owner asked). The felt flexes (`min-height`
15rem) and gives up room to everything else; Duchess's box grows to at most
four short lines for a long line; short phones (`max-height: 740px`) get a
compact pass in `table.css` and `action-bar.css`. Check 320×568, 375×667,
390×780 and a short laptop window after any layout change.

## Duchess calls the game

`src/dealer-talk.ts` is Duchess's patter: a Vegas diva with a sharp tongue
and attitude (the owner's brief: "a diva with attitude", then "meaner"; "give her a
personality"). Mild language ("damn", "hell") is allowed by the owner; no
slurs, and no accent or dialect played as a racial stereotype — the
attitude is in what she says. Every moment has a big pool of lines (the
owner asked that she not feel repetitive): add to the pools freely. `dealerLine(prev, next)` is
pure and picks its variation from `version`, so every client shows the same
line (picked by a hash of version and moment). She announces every rule
moment — bets closed, the peek, the hole card, hitting soft 17, the
reshuffle — in the line under the header.
The shoe gauge beside her shows the cards left and the cut card.

## Your-turn buzz

`src/hooks/use-turn-buzz.ts` plays a two-note chime (Web Audio) and vibrates
(`navigator.vibrate`) on the edge into "my turn", not again while it stays
mine, and not when my own deal/rematch tap put me on turn. Both on by
default, each with a switch in the table Menu (`settingsStore.chime` /
`.vibrate`; the vibrate switch only where the API exists). iPhone Safari has
no Vibration API at all — the chime is the iPhone's alert. The AudioContext
is unlocked by the first tap on the page (iOS only allows sound after one).

## Disconnects (online)

As in Hold'em: if the player on turn has no presence node, the others wait
`AWAY.graceMs` (30s) and one sends `away`, which sits that player out of the
round (while betting) or stands their hand (while playing) and sets `sitOut`;
later turns are skipped after ~2.5s. The player's own next action clears it.
The dealer steps, the next round and a rematch can be sent by any seated
player, so none of those can stall. Details: `src/hooks/use-online-dealer.ts`
and RULES.md.

## Verify before finishing

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` clean; for
rules changes also `npm test --prefix ../../server`. For UI changes, play it:
`npm run preview` from the repo root serves every built game plus a throwaway
realtime server.
