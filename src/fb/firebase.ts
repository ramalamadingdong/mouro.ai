/**
 * Firebase singletons (app / auth / db). Expo Go compatible: uses ONLY the
 * Firebase JS Web SDK (modular API). No @react-native-firebase, no native code.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { firebaseConfig } from '@/fb/config';

// `getReactNativePersistence` ships in the react-native build of firebase/auth
// (Metro resolves it at runtime) but is absent from the default type surface.
// Augment the module so the named import above type-checks.
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: unknown): Persistence;
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * Auth must persist the anonymous uid across restarts so a player can reconnect
 * to their room. `initializeAuth` throws if called twice (Fast Refresh), so we
 * fall back to `getAuth` on the second run.
 */
let authInstance: Auth;
if (Platform.OS === 'web') {
  // On web the Firebase JS SDK persists the anonymous uid on its own (IndexedDB,
  // falling back to localStorage), so `getAuth` already survives reloads and
  // reconnects the player to their room. `getReactNativePersistence` does not
  // exist in the web build of firebase/auth, and `getAuth` (unlike
  // `initializeAuth`) sets persistence up lazily — which also keeps this module
  // import-safe during web static rendering (prerendered in Node, no window).
  authInstance = getAuth(app);
} else {
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (err) {
    // Only the Fast-Refresh double-init case ('auth/already-initialized') should
    // fall back to getAuth. Any OTHER failure — notably getReactNativePersistence
    // resolving to undefined under a Metro package-exports regression — must
    // surface loudly instead of silently degrading to in-memory (non-persistent)
    // auth, which would mint a new uid on every cold start and lose the seat.
    if ((err as { code?: string })?.code === 'auth/already-initialized') {
      authInstance = getAuth(app);
    } else {
      throw err;
    }
  }
}

export const auth: Auth = authInstance;
export const db: Database = getDatabase(app);
