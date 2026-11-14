# Gin Rummy — agent notes

Read the exact versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/
before writing any code.

## Non-negotiable project constraints

- **Expo SDK 54.** Do NOT upgrade the SDK. The iPhone is tested via the App
  Store **Expo Go**, which currently supports SDK 54; there is no Mac to fall
  back on for a custom native build.
- **Expo Go compatible only.** No custom native code, no config plugins that add
  native modules. For Firebase use ONLY the JS Web SDK (`firebase@^12`,
  modular API). NEVER `@react-native-firebase/*`.
- **Backend = Firebase Realtime Database + Anonymous Auth**, free Spark plan, no
  Cloud Functions. Client-authoritative game logic (casual play between friends).
- **Path alias:** `@/*` → `./src/*`. Source lives under `src/`; routes under
  `src/app/` (expo-router v6).
- **The engine (`src/engine/`) is pure TypeScript** — no React/Firebase/Expo
  imports — and is unit-tested with Jest (`npm test`).

## Verify before finishing
`npm run typecheck` (tsc --noEmit) clean, and `npm test` green.
