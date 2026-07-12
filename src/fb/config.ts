/**
 * Firebase project configuration.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️  The values below come from EXPO_PUBLIC_* environment variables so this
 *     public repo ships WITHOUT a live backend. To enable online play:
 *
 *       1. Copy `.env.example` to `.env`.
 *       2. Paste the config from YOUR Firebase project (see README → "Firebase
 *          setup"). The `.env` file is git-ignored and stays on your machine.
 *       3. Restart Expo with a cleared cache:  npx expo start -c
 *
 *     Without a `.env`, the placeholders leave the app "unconfigured": online
 *     play is disabled, but solo-vs-CPU still works.
 *
 * These values are NOT secrets — a Firebase web config is a set of public
 * identifiers that ship inside every client anyway. Security is enforced by the
 * Realtime Database rules (firebase/database.rules.json), not by hiding this
 * config. For EAS builds the same variables are supplied as EAS environment
 * variables (see README → "Build for TestFlight / APK").
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
