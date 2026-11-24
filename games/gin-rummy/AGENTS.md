# Gin Rummy — agent notes

Read the exact versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/
before writing any code.

## Non-negotiable project constraints

- **Analytics tag stays in the page head** (`index.html`, or `src/app/+html.tsx` for
  Expo): `https://mouro.ai/static/js/analytics.js`. See "Analytics" in the root
  `CLAUDE.md`; CI fails without it.
- **Expo SDK 54.** Do NOT upgrade the SDK. The iPhone is tested via the App
  Store **Expo Go**, which currently supports SDK 54; there is no Mac to fall
  back on for a custom native build.
- **Expo Go compatible only.** No custom native code, no config plugins that add
  native modules.
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

## Verify before finishing
`npm run typecheck` (tsc --noEmit) clean, and `npm test` green.
