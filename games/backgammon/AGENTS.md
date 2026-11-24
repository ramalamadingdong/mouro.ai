# Backgammon — agent notes

Read the exact versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/
before writing any code.

This app is a sibling of the gin rummy app at `../gin-rummy` and deliberately
follows the same architecture. When something here looks unusual, check whether
the same shape exists there — it almost certainly does, with a comment
explaining the bug that caused it.

## Non-negotiable project constraints

- **Analytics tag stays in the page head** (`index.html`, or `src/app/+html.tsx` for
  Expo): `https://mouro.ai/static/js/analytics.js`. See "Analytics" in the root
  `CLAUDE.md`; CI fails without it.
- **Expo SDK 54.** Do NOT upgrade the SDK. The iPhone is tested via the App
  Store **Expo Go**, which currently supports SDK 54; there is no Mac to fall
  back on for a custom native build.
- **Expo Go compatible only.** No custom native code, no config plugins that add
  native modules. In particular **do not add `react-native-svg`** — every board
  element is drawable with plain Views.
- **Backend = the mouro.ai realtime server** (`../../server`), reached through
  `@mouro/realtime` (`../../packages/realtime`): a Firebase-RTDB-shaped API —
  `ref`, `get`, `set`, `update`, `onValue`, `runTransaction`, `onDisconnect`,
  anonymous auth — over a WebSocket, backed by SQLite on the VPS. Firebase is
  gone; do NOT re-add the `firebase` package or `@react-native-firebase/*`.
  Client-authoritative game logic (casual play between friends); the server
  enforces `database.rules.json` (same syntax as Firebase rules).
- **Path alias:** `@/*` → `./src/*`. Source lives under `src/`; routes under
  `src/app/` (expo-router v6).
- **The engine (`src/engine/`) is pure TypeScript** — no React/network/Expo
  imports — and is unit-tested with Jest (`npm test`).
- **Animation is RN `Animated`** (native driver, transform + opacity only), not
  Reanimated worklets. `react-native-reanimated` is imported once in
  `_layout.tsx` for expo-router's sake and never used directly.
- **`metro.config.js` disables package exports on purpose.** Removing that line
  breaks the web build (zustand's ESM uses `import.meta`, a parse error in the
  classic-script web entry). See the comment in the file.

## Database and rules

Backgammon has its own database on the realtime server (`backgammon` in
`../../server/games.json`), with top-level nodes `bgRooms/` and `bgMatches/`.
Its rules live in `database.rules.json` here and are enforced by the server on
every read and write — edit them in place; they deploy with the server.

## Tawleh rules

The game plays Middle-Eastern Tawleh, not American backgammon: **no doubling
cube and no Crawford rule**; a win scores 1, a **mars** (loser bore off nothing)
scores 2, and there is **no triple game**; the winner of the opening roll
**rolls again** for the first turn. Movement rules are otherwise standard.
The board is drawn the Tawleh way round: your home board is the bottom-LEFT
quadrant, checkers travel clockwise, and the bear-off tray is on the left
(`src/hooks/use-board-metrics.ts`). That is the mirror image of most Western
apps and is intentional.
`src/engine/__tests__/reference.test.ts` checks move generation against an
independent implementation — keep it passing.

## Two things that are true here and not in gin rummy

1. **A turn is committed atomically** as one `{kind:'play', steps}` move, not
   one write per checker. The must-use-both-dice rule makes per-step commits
   unvalidatable. See the comment on `Move` in `src/engine/types.ts`.
2. **Dice are client-authoritative.** The roller supplies their own seed, and a
   modified client could grind seeds undetectably. This is accepted and
   documented in the README; now that there is a server, the clean fix is
   server-side rolls, not a silent client-side scheme.

## Verify before finishing
`npm run typecheck` (tsc --noEmit) clean, and `npm test` green.
