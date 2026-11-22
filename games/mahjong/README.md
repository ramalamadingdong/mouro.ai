# Mahjong

Four-player Hong Kong mahjong with no sign-up, shipped as a static PWA at
**https://mouro.ai/mahjong/**.

- **Play the cats.** You against Marmalade, Shadow and Tiger at three levels.
  Runs entirely on the device; a game in progress survives a refresh.
- **Play friends online.** 2–4 players; computer cats take any empty seats.
  The host creates a room and shares a five-character code or an invite link;
  no accounts.
- **Real rules.** 144 tiles with flowers and seasons; chow, pung and kong
  calls; concealed and added kongs (which can be robbed); Hong Kong faan
  scoring with a choice of minimum (none, 1 or 3); the East round or a full
  four-wind game.
- **Installable.** Add it to your home screen and it opens standalone.

Online games are client-authoritative like the other games here: the server
checks who may move, and each client checks all 144 tiles are accounted for.
Every seated player's client can read every hand. Fine for friends; not a
tournament platform.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173/mahjong/  (cats work with no server)
npm test             # engine + computer players
npm run typecheck && npm run lint && npm run build
```

For online play locally, run the realtime server (`npm start --prefix ../../server`)
and set `VITE_REALTIME_URL=ws://localhost:8787/rt` (see `.env.example`), or use
`npm run build && npm run preview` from the repo root.

See `AGENTS.md` for how it is built and `RULES.md` for the database rules.
