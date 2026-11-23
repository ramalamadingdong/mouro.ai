# Tabby Eights — agent notes

Crazy eights with a cat deck (fish, yarn, mice, bells; every eight a wild
tabby), shipped as a static PWA at **https://mouro.ai/tabby-eights/**. The
second weekly cat game (added 2026-11-23; see `../WEEKLY.md`). Two modes on
one engine and one screen (`src/components/game-view.tsx`):

- **The cats** — offline, the human against 1–3 computer players.
- **Online rooms** — 2–4 humans, room code + invite link, no computer players.

The app shell (rooms, join, lobby, presence, auth, code input, modal) was
copied from `games/pawprints` (which took it from `games/dots` and
`games/holdem`) and changed as little as possible. When fixing a bug in one of
those files, check the other games too.

## Non-negotiable project constraints

- **Same stack as `games/pawprints`, `games/dots` and `games/holdem`**: Vite +
  React 19 + TypeScript (strict), React Router v7, zustand v5, plain CSS
  custom properties, Vitest, oxlint. Its own `package.json` and lockfile;
  never npm workspaces.
- **Sub-path.** Vite `base` is `'/tabby-eights/'`; the router `basename` is
  derived from `import.meta.env.BASE_URL` in `src/app.tsx`.
  `infra/Caddyfile`, `scripts/preview.mjs` and the deploy/CI workflows must
  agree with it. The URL is fixed: invite links depend on it.
- **Backend = the mouro.ai realtime server**, through `@mouro/realtime`. The
  namespace is `tabby-eights` (`server/games.json`); renaming it orphans every
  room.
- **`database.rules.json` is production behaviour.** Read `RULES.md` before
  touching it, and adjust the "tabby-eights rules" cases in
  `server/test/realtime.test.js`.
- **No service worker**, like the other games.
- **No image assets in the UI.** Cards, suit marks, the tabby on every eight
  and the cat faces are CSS and inline SVG. The only bitmaps are the app
  icons, rendered from `public/icons/icon.svg` by `scripts/render-icons.mjs`.
- **Light and dark.** `src/theme/tokens.css` has a night palette under
  `prefers-color-scheme: dark`; `index.html` repeats `--page` for both in its
  anti-flash style. Card faces stay cream in both themes (so the suit inks
  keep their contrast); a suit mark off a card sits on a cream `.suit-chip`.

## The trust model

Online play is client-authoritative, exactly like Hold'em: every hand and the
stock live in `rooms/<code>/state`, readable by every seated player, and
`game-view.tsx` is the one place that decides to show only this device's own
hand. Do not add half-measures (obfuscating hands, splitting nodes). See
`../holdem/AGENTS.md`.

## The engine

`src/engine/` is pure TypeScript with no React / network / DOM imports, and
`src/ai/` depends only on the engine. They are the only layers with tests.

- **Cards are two-character strings** (`fA`, `y8`, `bT`); a hand, the stock
  and the pile are each one string of them. One scalar on the wire, bounded by
  one regex in the rules. Helpers are in `cards.ts`.
- `applyMove(state, move, uid)` never throws or mutates; the sender's uid is
  an argument. Every success path ends at `commit`, which bumps `version`,
  re-derives `turnUid` and stamps `lastMove`.
- **All randomness is a seed inside the move that uses it**: `deal`,
  `rematch`, and `draw` / `away` (used only when the stock is empty and the
  pile under its top card is shuffled back in). `crypto` lives in
  `src/util/seed.ts`; `rng.ts` is Hold'em's.
- **Rules decisions**: seven cards heads-up, five with three or four; the
  turned-up card is never an eight; draw at most one card a turn, and you may
  draw even holding a card that fits; after drawing, play any card that fits
  or pass; the round's winner scores the others' hands (eights 50, T/J/Q/K 10,
  ace 1, else the number). The lead moves one seat each round and each game.
- **Between rounds** the state sits in `roundover` with nobody on turn, so the
  result stays on screen; any seated player's `deal` starts the next one.
- **Blocked rounds** (a full lap of passes with nothing to draw) are handled
  — lowest hand scores the margins — but cannot actually happen: with all but
  one card in hands, someone always holds a card that fits.
- **`away`** takes the absent player's whole turn deterministically
  (`autoPlay`: a non-eight of their longest suit, else an eight naming it;
  else draw and play that card if it fits; else pass) and sets `sitOut`,
  which the player's own next move clears.
- **`normalize()` is the only cheat detection**: all 52 cards exactly once,
  the suit to follow matches a non-eight top card, phase/turn/score
  consistency. Always run states through it, off the wire and out of
  localStorage. It also reads a missing `hand` / `stock` as empty.

## The cats (`src/ai/decide.ts`)

Difficulty is how well they play; the three cats differ only in looks. They
see only what a player at the table sees (own hand, pile, hand sizes).

- **easy** plays a random card that fits, sometimes draws anyway, sometimes
  names a random suit.
- **medium** keeps eights for when nothing else fits, plays the card that
  leaves it the most cards of the suit it lands on, sheds big cards first, and
  names its longest suit.
- **hard** adds counting (prefers suits mostly gone from the game), changes
  the suit with an eight when the next player is down to one or two cards,
  sheds expensive cards then, and heads-up keeps to a suit the other player
  just drew and passed on.

Crazy eights is mostly luck, so the edges are small: the test in
`src/ai/__tests__` plays 2000 heads-up rounds per pairing and checks medium
beats easy (~67%) and hard beats medium (~53%). Keep it passing when tuning.

## Pacing

Every cat step — a card, a draw, a pass — is its own visible step; the
numbers are in `CPU_PACE` in `src/pace.ts` (1.2–2.0s to play, 0.9–1.4s to
reach for the stock, 0.9–1.3s after drawing). The screen says what the last
move was under the status line. The owner asked for computer players to be
followable — do not speed them up to make a test faster.

## Disconnects (online)

If the player on turn has no presence node, the other clients wait
`AWAY.graceMs` (30s; 2.5s once they are marked `sitOut`) and one sends `away`.
The rules allow it only while the presence node is absent. Between rounds
anyone can deal, so nothing waits on an absent player. See
`src/hooks/use-online-away.ts` and RULES.md.

## Verify before finishing

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` clean; for
rules changes also `npm test --prefix ../../server`. For UI changes, build and
`npm run preview` from the repo root, then play a game against the cats and an
online game in two browser windows.
