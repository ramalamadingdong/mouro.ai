/**
 * The Firebase singletons. Every other module imports `auth` / `db` from here
 * and never calls `initializeApp` itself.
 *
 * This file is web-only by design: the Firebase JS SDK v12 modular API against
 * real browser globals. Nothing React-Native-ish may be imported here — no
 * `firebase/auth/react-native`, no `initializeAuth` + `getReactNativePersistence`,
 * no AsyncStorage. Those exist to bolt persistence onto a runtime that has no
 * IndexedDB; the browser has one.
 */
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { firebaseConfig } from '@/fb/config';

/**
 * Guarded init. Vite's HMR re-executes this module on edit while the previous
 * instance's app object is still registered, and `initializeApp` throws
 * `app/duplicate-app` on a second call with the default name. Re-using the
 * existing app keeps hot reload from hard-crashing the dev server.
 */
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * On web, the JS SDK persists the signed-in anonymous user *itself* — IndexedDB
 * by default, falling back to localStorage where IndexedDB is unavailable
 * (private-mode Safari, some embedded webviews). That is why plain `getAuth` is
 * enough here and no explicit persistence argument is needed: a reload restores
 * the same uid, which is what keeps a player in their seat.
 *
 * The known failure mode is iOS Safari evicting localStorage after ~7 days of
 * non-use for sites not installed to the home screen — see DESIGN.md. Games are
 * short and single-session, so this is accepted rather than worked around.
 */
export const auth = getAuth(app);

/**
 * Realtime Database handle. The instance is selected by `databaseURL` in the
 * config, so a project whose database lives outside us-central1 works only if
 * that URL carries the right region host.
 */
export const db = getDatabase(app);
