# Backgammon

Two-player online backgammon with no sign-up, plus a computer opponent that
works offline. Live at **https://mouro.ai/backgammon**.

A sibling of the gin rummy app at `../gin-rummy`, built to the same
architecture: a pure TypeScript rules engine, the mouro.ai realtime server for
sync, and an Expo Go-compatible PWA.

Full match play: the doubling cube, gammons and backgammons, matches to a set
number of points, and the Crawford rule.

## Quick start

```bash
npm install
cp .env.example .env     # only needed for native builds (see below)
npx expo start
```

Playing the computer works without any of that — solo mode is entirely offline
and never touches the network.

## Layout

```
src/engine/      the rules. Pure TypeScript, no React/network/Expo. 148 tests.
src/ai/          the computer opponent. Pure TypeScript, no Math.random.
src/net/         realtime singletons, anonymous auth, presence, room lifecycle.
src/store/       zustand: gameStore (online), soloStore (offline), settings.
src/components/  board/ is the table; ui/ is buttons, screens, the code input.
src/hooks/       board geometry, the staged turn, motion, reduced-motion.
src/app/         expo-router routes.
```

The engine is the important part. It knows nothing about the network or the
screen, so it can be — and is — tested to death: 2000 fuzzed matches asserting
checker conservation, exact pip accounting, bar-first ordering, bear-off
legality, and that every committed turn uses exactly as many dice as the
position allowed.

## How a move actually happens

1. You stage a turn locally (`useTurnDraft`). Nothing is sent; undo is free.
2. Confirm submits ONE move, `{kind: 'play', steps}`, for the whole turn.
3. `submitMove` opens a Realtime Database transaction on `bgRooms/<CODE>/state`,
   runs the **pure reducer inside the transaction**, and writes the result — or
   aborts if the move was illegal.
4. Both clients get the new state through `normalize()`, which repairs what RTDB
   does to a document and rejects anything incoherent.

A turn is committed atomically rather than one write per checker because the
must-use-both-dice rule makes per-step commits unvalidatable: a step that is
legal on its own can be illegal because it strands you on a shorter sequence.
Validating a whole turn is one membership test against the enumerated legal
turns, which enforces every dice rule at once without restating any of them.

## What the server enforces, and what it doesn't

The security rules enforce the four things a Realtime Database rule can see:
membership, `turnUid`, a strictly increasing `version`, and that `lastMove.by`
is the writer. They cannot enforce the rules of backgammon — a rule expression
cannot even sum an array to check that fifteen checkers are still on each side.
That check lives in `normalize()` on both clients.

**The dice are client-authoritative.** Each roll carries a seed supplied by the
player rolling it, so a modified client could grind seeds for good rolls and the
other side could not tell. This is accepted, not overlooked: it was the only
model compatible with the original serverless backend, and the app is for casual
games between friends. Now that the realtime server exists, server-side rolls
would be the clean fix. A commit-reveal scheme (both sides
commit `hash(nonce)` before the roll, dice derived from both) would close it at
the cost of two extra writes per turn, and would make a good opt-in "fair dice"
room setting.

## Online play

Online play runs on the mouro.ai realtime server (`../../server`) through
`@mouro/realtime` — a Firebase-shaped API (`ref`, `runTransaction`, `onValue`,
`onDisconnect`, anonymous auth) over a WebSocket, stored in SQLite. There is no
third-party backend and nothing to sign up for.

- **Web:** nothing to configure — the page talks to `/rt` on its own host.
- **Native (Expo Go / EAS):** set `EXPO_PUBLIC_REALTIME_URL` (see `.env.example`).
- **Locally:** `npm start` in `../../server`, then point the URL at
  `ws://<your-LAN-ip>:8787/rt`. Or build everything and run
  `npm run preview` at the repo root to get the whole site on one port.

The security rules are `database.rules.json` in this folder (Firebase rules
syntax). The server evaluates them on every read and write; they ship with the
server, so there is no separate rules deploy.

## Web / PWA

`expo export --platform web` produces a static site served at the `/backgammon`
sub-path (`experiments.baseUrl` in app.json, mirrored by `WEB_BASE_PATH` in
`src/util/invite.ts` — change one, change the other).

There is deliberately **no service worker**, so there is no stale-cache class of
bug. `metro.config.js` disables Metro package exports on purpose; removing that
line breaks the web build. Both are explained in place.

Dynamic routes (`/join/<CODE>`) need a small rewrite, because Expo prerenders
them to files literally named `[code].html`. It lives in `../../infra/Caddyfile`.

## Deploying

Pushing to `main` deploys: the repo's GitHub Actions workflow builds every app
and the server, and rsyncs the result to the VPS. See the root README.

## Rules that are deliberately not implemented

Automatic doubles, beavers and raccoons, the Jacoby rule (meaningless in match
play anyway), resignations, and match-equity-driven cube decisions. The computer
plays a race-and-position heuristic, not a neural net — it is a decent club
opponent, not a bot.

## Verify before finishing

```bash
npm run typecheck
npm test
```
