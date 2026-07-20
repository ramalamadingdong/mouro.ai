/**
 * Firebase project configuration, read from Vite env vars.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THESE VALUES ARE NOT SECRETS.
 *
 * A Firebase *web* config is a set of public identifiers. They ship inside the
 * JS bundle of every client that has ever connected to the project, and there
 * is no way to hide them from a browser. Security for this app is enforced
 * entirely by the Realtime Database rules in `firebase/database.rules.json`
 * (who may write which room, that `turnUid` matches `auth.uid`, that `version`
 * only increases). Treat `.env` as configuration, not as a credential store —
 * it is git-ignored only so the public repo ships without pointing at a live
 * backend, not because leaking it would be a breach.
 *
 * To enable online play:
 *   1. `cp .env.example .env`
 *   2. Paste the config from YOUR Firebase project console.
 *   3. Restart `npm run dev` — Vite reads .env at server start, not per-request.
 *
 * Without a `.env`, the placeholders leave the app "unconfigured":
 * `isFirebaseConfigured` is false, online play is disabled, and pass-and-play
 * still works because it never touches the network.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * VITE GOTCHA: `import.meta.env.VITE_*` is a literal *text substitution*
 * performed at build time, not a real object lookup. `import.meta.env[key]`
 * with a computed key survives `vite dev` (where a real object is injected) and
 * then yields `undefined` in the production bundle. So every var below is read
 * by STATIC DOT NOTATION. Do not refactor these into a loop or a helper that
 * takes the var name as an argument.
 */

/**
 * What an unset var falls back to. Chosen to be obviously wrong in a stack
 * trace: if this string ever reaches Firebase, the message names the problem.
 */
const PLACEHOLDER = 'PASTE_ME';

/**
 * Shape of the web config Firebase's `initializeApp` wants.
 *
 * Annotated explicitly because `vite/client` types `import.meta.env` with an
 * `any` index signature, so without this every field below would silently be
 * `any` and `firebaseConfig.apiKey.includes(...)` would type-check even if the
 * value were a number.
 */
interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? PLACEHOLDER,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? PLACEHOLDER,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL ?? PLACEHOLDER,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? PLACEHOLDER,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? PLACEHOLDER,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? PLACEHOLDER,
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? PLACEHOLDER,
};

/**
 * True once real values have been supplied.
 *
 * Only `apiKey` and `databaseURL` are checked, because those two are the ones
 * that actually gate connectivity: the key authenticates the sign-in call and
 * the URL says which database to open a socket to. The rest (projectId,
 * storageBucket, messagingSenderId, appId) are used for analytics, Storage, and
 * Cloud Messaging — none of which this app touches — so a missing one should
 * not black out online play.
 *
 * `.includes()` rather than `===` so a half-edited `.env` (someone replaced the
 * middle of the line but left the marker) still reads as unconfigured.
 */
export const isFirebaseConfigured =
  !firebaseConfig.apiKey.includes(PLACEHOLDER) &&
  !firebaseConfig.databaseURL.includes(PLACEHOLDER);
