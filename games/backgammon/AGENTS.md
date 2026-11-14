# Backgammon — agent notes

Read the exact versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/
before writing any code.

This app is a sibling of the gin rummy app at `../gin-rummey` and deliberately
follows the same architecture. When something here looks unusual, check whether
the same shape exists there — it almost certainly does, with a comment
explaining the bug that caused it.

## Non-negotiable project constraints

- **Expo SDK 54.** Do NOT upgrade the SDK. The iPhone is tested via the App
  Store **Expo Go**, which currently supports SDK 54; there is no Mac to fall
  back on for a custom native build.
- **Expo Go compatible only.** No custom native code, no config plugins that add
  native modules. For Firebase use ONLY the JS Web SDK (`firebase@^12`,
  modular API). NEVER `@react-native-firebase/*`. In particular **do not add
  `react-native-svg`** — every board element is drawable with plain Views.
- **Backend = Firebase Realtime Database + Anonymous Auth**, free Spark plan, no
  Cloud Functions. Client-authoritative game logic (casual play between friends).
- **Path alias:** `@/*` → `./src/*`. Source lives under `src/`; routes under
  `src/app/` (expo-router v6).
- **The engine (`src/engine/`) is pure TypeScript** — no React/Firebase/Expo
  imports — and is unit-tested with Jest (`npm test`).
- **Animation is RN `Animated`** (native driver, transform + opacity only), not
  Reanimated worklets. `react-native-reanimated` is imported once in
  `_layout.tsx` for expo-router's sake and never used directly.
- **`metro.config.js` disables package exports on purpose.** Removing that line
  breaks the web build (zustand's ESM uses `import.meta`, a parse error in the
  classic-script web entry). See the comment in the file.

## Shared Firebase project

Online play uses the **same Firebase project as the gin rummy app**, under new
top-level nodes `bgRooms/` and `bgMatches/`. The deployed rules file is
`../gin-rummey/firebase/database.rules.json`; `firebase/database.rules.json`
here is a **read-only mirror**. Deploy rules from the gin repo:

```
cd ../gin-rummey && firebase deploy --only database
```

Do NOT add `firebase.json` / `.firebaserc` to this repo — a `firebase deploy`
here would overwrite the live rules with this copy and lock out gin players.
`npm run check:rules` fails if the mirror drifts.

## Two things that are true here and not in gin rummy

1. **A turn is committed atomically** as one `{kind:'play', steps}` move, not
   one write per checker. The must-use-both-dice rule makes per-step commits
   unvalidatable. See the comment on `Move` in `src/engine/types.ts`.
2. **Dice are client-authoritative.** The roller supplies their own seed, and a
   modified client could grind seeds undetectably. This is accepted and
   documented in the README; it is the only model compatible with no Cloud
   Functions. Do not silently "fix" it with a scheme that isn't commit-reveal.

## Verify before finishing
`npm run typecheck` (tsc --noEmit) clean, and `npm test` green.
