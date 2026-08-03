/**
 * Firebase project configuration.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️  The values below come from EXPO_PUBLIC_* environment variables so this
 *     repo ships WITHOUT a live backend. To enable online play:
 *
 *       1. Copy `.env.example` to `.env`.
 *       2. Paste the config from YOUR Firebase project. `.env` is git-ignored.
 *       3. Restart Expo with a cleared cache:  npx expo start -c
 *
 *     Without a `.env`, the placeholders leave the app "unconfigured": online
 *     play is disabled, but solo-vs-computer still works.
 *
 *     This app shares the `gin-rummey` Firebase project with the gin rummy app —
 *     same values, different top-level nodes (`bgRooms/`, `bgMatches/`).
 *
 * These values are NOT secrets — a Firebase web config is a set of public
 * identifiers that ship inside every client anyway. Security is enforced by the
 * Realtime Database rules, not by hiding this config.
 *
 * NOTE: Expo only inlines `process.env.EXPO_PUBLIC_*` when accessed by static
 * dot notation — do not refactor these into a loop or bracket access.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PLACEHOLDER = 'PASTE_ME';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? PLACEHOLDER,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? PLACEHOLDER,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ?? PLACEHOLDER,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? PLACEHOLDER,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? PLACEHOLDER,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? PLACEHOLDER,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? PLACEHOLDER,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? PLACEHOLDER,
};

/** True once real values have been supplied via `.env` / EAS env vars. */
export const isFirebaseConfigured =
  !firebaseConfig.apiKey.includes(PLACEHOLDER) &&
  !firebaseConfig.databaseURL.includes(PLACEHOLDER);
