# Mahjong

Japanese (Riichi) and Hong Kong mahjong, for four players or two heads-up,
with no sign-up, shipped as a static PWA at **https://mouro.ai/mahjong/**.

- **Learn.** Eight guided lessons with practice questions (`/learn`), a coach
  that suggests a move and explains why during play, and reference pages
  (rules, an illustrated tile guide, the yaku list with example hands).
- **Play the cats.** You against Marmalade, Shadow and Tiger (or one of them
  heads-up) at three levels. Runs entirely on the device; a game in progress
  survives a refresh.
- **Play friends online.** Two people heads-up, or 2–4 at a four-player table
  with computer cats in the empty seats. The host creates a room and shares a
  five-character code or an invite link; no accounts.
- **Riichi rules.** 136 tiles, dead wall with dora, kan dora and ura dora;
  chi / pon / kan (closed, called, added — which can be robbed); riichi with
  ippatsu and double riichi; furiten; at least one yaku to win; the standard
  yaku and yakuman; han/fu scoring with the limits from mangan up; honba and
  riichi sticks; tenpai payments on a draw; East-only or East + South; the game
  ends when anyone drops below zero. Not included: red fives, abortive draws,
  nagashi mangan, double yakuman, kuikae.
- **Hong Kong rules.** 144 tiles with flowers and seasons; chow, pung and
  kong; faan scoring with a choice of minimum (none, 1 or 3); the East round or
  a full four-wind game.
- **Heads-up.** Both rulesets play two-handed with the full tile set: your
  opponent is the only one who throws to you, so you can chow/chi every tile,
  and a self-drawn win is paid in full by them.
- **Installable.** Add it to your home screen and it opens standalone.

Online games are client-authoritative like the other games here: the server
checks who may move, and each client checks every tile is accounted for.
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
