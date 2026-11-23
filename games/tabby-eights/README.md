# Tabby Eights

Crazy eights (the old family card game of matching the pile) with a cat deck:
fish, yarn, mice and bells, and every eight a wild tabby. No sign-up; shipped
as a static PWA at **https://mouro.ai/tabby-eights/**. Weekly cat game, added
November 23, 2026.

- **Play the cats.** You against 1–3 computer cats — Marmalade, Shadow and
  Tiger — at three levels, to 50, 100 or 200 points. Runs entirely on the
  device; a game in progress survives a refresh.
- **Play friends online.** 2–4 players. The host creates a room and shares a
  five-character code or an invite link; no accounts.
- **Installable.** Add it to your home screen and it opens standalone.

**How to play:** seven cards each (five with three or four players), one
turned up on the pile. On your turn play a card that matches the pile's suit
or number; an eight goes on anything and you name the next suit. Nothing to
play? Draw one, then play or pass. The first to empty their hand scores what
the others still hold — eights 50, tens and pictures 10, aces 1, the rest
their number — and the first to the target wins.

Online games are client-authoritative like Hold'em: every seated player's
phone holds the whole deal and each one only draws its own hand face up. Fine
for friends; not a tournament platform.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173/tabby-eights/  (cats work with no server)
npm test             # engine + computer players
npm run typecheck && npm run lint && npm run build
```

For online play locally, run the realtime server (`npm start --prefix ../../server`)
and set `VITE_REALTIME_URL=ws://localhost:8787/rt` (see `.env.example`), or use
`npm run build && npm run preview` from the repo root.
