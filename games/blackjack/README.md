# Blackjack

Blackjack with no sign-up, shipped as a static PWA at
**https://mouro.ai/blackjack/**. Everybody plays against Duchess, the dealer
cat; the table seats up to eight.

- **Play the cats.** You plus 0–7 computer players — Tiger (by the book),
  Marmalade (reckless), Professor (card counter), Patches (never busts),
  Shadow (grinder), Smokey (mimics the dealer) and Biscuit (splits everything)
  — at three difficulty levels. Runs entirely on the device; the game in
  progress survives a refresh.
- **Play friends online.** 2–8 players. The host creates a room and shares a
  five-character code or an invite link; no account, identity is an anonymous
  uid held in the browser.
- **Installable.** Add it to your home screen and it opens standalone. There is
  deliberately no service worker, so it needs a network to launch.

Las Vegas Strip rules: six decks, dealer hits soft 17, blackjack 3:2, late
surrender (no insurance), double after split. Duchess calls the game as
it happens. The game lasts 10, 20 or 40 rounds; most chips at the end wins.

**Trust model, plainly:** online games are client-authoritative, like the other
games here. Every seated player's browser receives the whole game state,
including the dealer's hole card and the order of the shoe, and only
*displays* what a real table shows. Someone running a modified client could
look. That is accepted for casual play between friends; it is not a place to
play for money.

Stack: Vite + React 19 + TypeScript (strict), React Router v7, zustand v5, the
mouro.ai realtime server via `@mouro/realtime`, plain CSS, Vitest, oxlint.

## Layout

```
src/
  engine/     pure rules: cards and totals, the reducer, normalize()
  ai/         the cats: basic strategy, Hi-Lo count, personalities
  pace.ts     CPU_PACE — every timing number for the cats and the dealer
  net/        realtime config, auth, rooms, presence (online only)
  store/      soloStore (offline, persisted), gameStore (online), settingsStore
  hooks/      use-solo-driver (dealer + cats), use-online-dealer (dealer + away)
  components/ table, cards, avatars, action bar, help, code input, modal
  routes/     home, solo, join, lobby, game
database.rules.json   enforced by ../../server — explained in RULES.md
```

`AGENTS.md` holds the constraints and the non-obvious decisions.

## Local development

```bash
npm install
npm run dev          # Vite dev server — serves at /blackjack/, not /
npm test             # Vitest: engine, cats, room-code utilities
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm run build        # tsc -b && vite build → dist/
```

The cats need nothing else. For online play in dev, run `npm start` in
`../../server` and copy `.env.example` to `.env`; or, from the repo root,
`npm run build && npm run preview` serves every game with a throwaway realtime
server on one port.

The app icon is `public/icons/icon.svg`; after editing it, re-render the PNGs
with `scripts/render-icons.mjs` from the repo root.
