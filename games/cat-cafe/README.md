# Cat Café

A calm tile-drafting puzzle with no sign-up, shipped as a static PWA at
**https://mouro.ai/cat-cafe/**.

- **Play the cats.** You against 1–3 computer cats — Miso, Duchess and
  Pudding — at three levels. Runs entirely on the device; a game in progress
  survives a refresh.
- **Play friends online.** 2–4 players. The host creates a room and shares a
  five-character code or an invite link; no accounts.
- **Installable.** Add it to your home screen and it opens standalone.

**How to play:** each round, cats wait at the door. In turn, everyone takes
one and seats it on their own café floor. +2 for each pair of touching cats
with the same coat, −3 for each pair of touching rivals (Ginger and Smoke,
Tuxedo and Snow), +5 for each full row. After twelve rounds the best café wins.

Online games are client-authoritative like the other games here: the server
checks who may move, and each client checks the state is consistent. Fine for
friends; not a tournament platform.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173/cat-cafe/  (cats work with no server)
npm test             # engine + computer players
npm run typecheck && npm run lint && npm run build
```

For online play locally, run the realtime server (`npm start --prefix ../../server`)
and set `VITE_REALTIME_URL=ws://localhost:8787/rt` (see `.env.example`), or use
`npm run build && npm run preview` from the repo root.
