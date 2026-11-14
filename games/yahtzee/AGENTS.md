# Yahtzee — agent notes

A no-signup online Yahtzee, shipped as a static PWA at
**https://mouro.ai/yahtzee/**.

## Non-negotiable project constraints

- **Web only.** Vite + React 19 + TypeScript (strict). There is no native app,
  no Expo, no React Native, and no react-native-web. Use real DOM and real CSS.
- **React Router v7** with `basename: '/yahtzee'`. Vite's `base` is
  `'/yahtzee/'` — the two conventions differ (trailing slash vs none) and
  getting them out of step yields a blank page whose assets load fine.
- **zustand v5** for state; `persist` on `localStorage` for preferences only.
- **Backend = the mouro.ai realtime server** (`../../server`), reached through
  `@mouro/realtime` (`../../packages/realtime`): a Firebase-RTDB-shaped API —
  `ref`, `get`, `set`, `update`, `onValue`, `runTransaction`, `onDisconnect`,
  anonymous auth — over a WebSocket, backed by SQLite on the VPS. Firebase is
  gone; do NOT re-add the `firebase` package or `@react-native-firebase/*`.
  Client-authoritative game logic (casual play between friends); the server
  enforces `database.rules.json` (same syntax as Firebase rules).
- **Plain CSS with custom properties.** No CSS-in-JS runtime, no Tailwind.
- **No service worker**, deliberately. Home-screen install still works; the app
  just won't launch offline. This trades offline support for never having a
  stale-cache bug on a site that gets redeployed often.
- **Path alias:** `@/*` → `./src/*`. Declared in `tsconfig.app.json` `paths`
  AND `vite.config.ts` `resolve.alias` — TS paths alone don't resolve at build.
- **Vitest**, not Jest.

## The engine is the point

`src/engine/` is pure TypeScript with **zero React / network / DOM imports**.
It runs in plain Node, which is why it's the only layer tested heavily.

- `types.ts` has zero runtime *imports*. It does export the `as const` category
  tables and the `RULES` tunables, and the unions are derived from those tables
  so the runtime and the type system cannot drift.
- `applyMove(state, move, uid)` returns `{ ok: true, state } | { ok: false,
  error }` and **never throws**. The actor's uid is an argument, not a field on
  the move, so a payload can't lie about who sent it.
- Every success path funnels through `commit()`, which bumps `version`,
  re-derives the denormalized `turnUid`, and stamps `lastMove`.
- `legalMoves(state, uid)` and `legalCategories(state, seat)` are the *only*
  statement of what is playable. The UI, any AI, and the fuzz test all read
  legality from them, and the fuzz test treats a rejected legal move as a
  hard failure.
- **All randomness is a seed inside the move that consumes it**
  (`{ kind: 'roll', keep, seed }`). Nothing calls `Math.random()`. This makes
  every game replayable from `initial state + ordered move log`, makes every
  test failure reproducible, and keeps the replay-analytics door open.
  `crypto.getRandomValues` lives in `src/util/seed.ts`, outside the engine.

## Things that have specific reasons

- **A scorecard cell of `0` is a USED box** (a scratched category), not an empty
  one. `Number(x) || null` re-opens it and hands the player a free turn. Use
  `Number.isFinite`. Same trap for `turn: 0`, `rollsUsed: 0`, `version: 0`.
- **Holding dice is not a move.** Holds are local UI state published to a
  sibling RTDB node, because moves cost a full transaction round-trip
  (`applyLocally: false`) and per-die toggles over the network would feel awful.
- **Always `normalize()` a snapshot before use.** RTDB prunes nulls and empty
  collections and delivers arrays as integer-keyed objects. A fresh game's
  `cards` node is entirely null, so it vanishes in transit.
- Seat-indexed collections are read **by explicit index key**, never by sorted
  key — compacting a sparse node slides one seat's scorecard onto another.
- Cosmetic/ephemeral data (holds, presence, emotes) lives in **sibling nodes**,
  never inside `state`, so it never bloats the per-move transaction.

## Verify before finishing

`npm run typecheck` (tsc --noEmit) clean, and `npm test` green.
