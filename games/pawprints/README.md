# Pawprints

Five in a row (the old pencil-and-paper game also known as gomoku), played
with paw prints on a patchwork quilt. No sign-up; shipped as a static PWA at
**https://mouro.ai/pawprints/**. Weekly cat game, added November 15, 2026.

- **Play the cats.** You against 1–3 computer cats — Marmalade, Shadow and
  Tiger — at three levels, on an 11×11, 13×13 or 15×15 quilt. Runs entirely
  on the device; a game in progress survives a refresh.
- **Play friends online.** 2–4 players. The host creates a room and shares a
  five-character code or an invite link; no accounts.
- **Installable.** Add it to your home screen and it opens standalone.

**How to play:** take turns leaving one paw on a point where two seams cross.
Five of your own in an unbroken line — across, down or diagonally — wins
(four in a row with three or four players). A full quilt with no line is a
draw.

Online games are client-authoritative like the other games here: the server
checks who may move, and each client checks the board is consistent. Fine for
friends; not a tournament platform.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173/pawprints/  (cats work with no server)
npm test             # engine + computer players
npm run typecheck && npm run lint && npm run build
```

For online play locally, run the realtime server (`npm start --prefix ../../server`)
and set `VITE_REALTIME_URL=ws://localhost:8787/rt` (see `.env.example`), or use
`npm run build && npm run preview` from the repo root.
