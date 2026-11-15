# Dots and Boxes

The pencil-and-paper game, with no sign-up, shipped as a static PWA at
**https://mouro.ai/dots/**.

- **Play the cats.** You against 1–3 computer cats — Marmalade, Shadow and
  Tiger — at three levels, on a 3×3 to 6×6 board. Runs entirely on the device;
  a game in progress survives a refresh.
- **Play friends online.** 2–4 players. The host creates a room and shares a
  five-character code or an invite link; no accounts.
- **Installable.** Add it to your home screen and it opens standalone.

**How to play:** take turns drawing a line between two neighbouring dots.
Close the fourth side of a box to claim it and draw again. Most boxes wins.

Online games are client-authoritative like the other games here: the server
checks who may move, and each client checks the board is consistent. Fine for
friends; not a tournament platform.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173/dots/  (cats work with no server)
npm test             # engine + computer players
npm run typecheck && npm run lint && npm run build
```

For online play locally, run the realtime server (`npm start --prefix ../../server`)
and set `VITE_REALTIME_URL=ws://localhost:8787/rt` (see `.env.example`), or use
`npm run build && npm run preview` from the repo root.
