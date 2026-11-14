# Texas Hold'em

No-limit Texas Hold'em with no sign-up, shipped as a static PWA at
**https://mouro.ai/holdem/**.

- **Play the cats.** One human against 1–5 computer players — Shadow (tight),
  Marmalade (loose-aggressive), Tiger (solid), Professor (tricky) and Patches
  (calling station) — at three difficulty levels. Runs entirely on the device;
  the game in progress survives a refresh.
- **Play friends online.** 2–6 players. The host creates a room and shares a
  five-character code or an invite link; no account, identity is an anonymous
  uid held in the browser.
- **Installable.** Add it to your home screen and it opens standalone. There is
  deliberately no service worker, so it needs a network to launch.

**Trust model, plainly:** online games are client-authoritative, like the other
games here. Every seated player's browser receives the whole game state,
including the other players' hole cards and the deck, and only *displays* its
own. Someone running a modified client could look. That is accepted for casual
play between friends; it is not a place to play for money.

Stack: Vite + React 19 + TypeScript (strict), React Router v7, zustand v5, the
mouro.ai realtime server via `@mouro/realtime`, plain CSS, Vitest, oxlint.

## Layout

```
src/
  engine/     pure rules: cards, hand evaluation, side pots, the reducer, normalize()
  ai/         the cats: preflop tiers (Chen), Monte-Carlo equity, personalities
  pace.ts     CPU_PACE — every timing number for the computer players
  net/        realtime config, auth, rooms, presence (online only)
  store/      soloStore (offline, persisted), gameStore (online), settingsStore
  hooks/      use-solo-driver (dealer + cats), use-online-dealer (streets + away)
  components/ table, cards, avatars, action bar, help, code input, modal
  routes/     home, solo, join, lobby, game
database.rules.json   enforced by ../../server — explained in RULES.md
```

`AGENTS.md` holds the constraints and the non-obvious decisions.

## Local development

```bash
npm install
npm run dev          # Vite dev server — serves at /holdem/, not /
npm test             # Vitest: engine, cats, room-code utilities
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm run build        # tsc -b && vite build → dist/
```

The cats need nothing else. For online play in dev, run `npm start` in
`../../server` and copy `.env.example` to `.env`; or, from the repo root,
`npm run build && npm run preview` serves every game with a throwaway realtime
server on one port.
