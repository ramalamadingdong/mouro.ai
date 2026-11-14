/**
 * Anonymous auth helpers. The uid is the stable identity used everywhere in the
 * data model (meta.host / meta.guest, presence keys, players map, turnUid).
 *
 * Sign-in can fail (e.g. Anonymous auth not enabled in the Firebase console) or
 * hang (network). We surface a friendly, actionable error rather than leaving
 * the UI stuck at "connecting…" forever.
 */
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from '@mouro/realtime';
import { auth } from '@/net/realtime';

let currentUid: string | null = auth.currentUser?.uid ?? null;

// Keep the cached uid fresh for the synchronous getCurrentUid() accessor.
onAuthStateChanged(auth, (user) => {
  currentUid = user?.uid ?? null;
});

/** The current anonymous uid, or null if auth has not resolved yet. */
export function getCurrentUid(): string | null {
  return currentUid;
}

// ── Auth error surfacing ─────────────────────────────────────────────────────
let authError: string | null = null;
const errorListeners = new Set<(e: string | null) => void>();

function setAuthError(e: string | null) {
  authError = e;
  errorListeners.forEach((l) => l(e));
}

/** Latest auth error message (null when signed in or still trying). */
export function getAuthError(): string | null {
  return authError;
}

/** Turn a Firebase auth error into an actionable, human message. */
function describeAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const raw = (err as Error)?.message ?? String(err);
  switch (code) {
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Anonymous sign-in is turned off for this Firebase project. In the Firebase console: Authentication → Sign-in method → enable Anonymous, then reopen the app.';
    case 'auth/network-request-failed':
      return 'Network error reaching Firebase. Check your internet connection and try again.';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
      return 'Invalid Firebase API key — re-check the values in src/fb/config.ts.';
    case 'auth/configuration-not-found':
    case 'auth/internal-error':
      return 'Firebase Authentication isn’t set up for this project. In the Firebase console open Build → Authentication → Get started, then enable the Anonymous provider.';
    case 'auth/timeout':
      return "Couldn't reach Firebase (timed out). Check that Anonymous auth is enabled and your device is online.";
    default:
      return `Sign-in failed${code ? ` (${code})` : ''}. ${raw}`;
  }
}

const SIGN_IN_TIMEOUT_MS = 15000;

/**
 * Resolve (or create) the anonymous session and return its uid. Waits for the
 * first auth state; signs in anonymously if there is no user. Rejects with an
 * actionable message on failure or after a timeout (so the UI never hangs).
 */
let pending: Promise<string> | null = null;

export function ensureAnonymousAuth(): Promise<string> {
  // Single-flight: concurrent callers (every useAuth mount) must share ONE
  // in-flight sign-in. Before the first user exists firebase does not dedup
  // signInAnonymously, so parallel calls would each mint a throwaway account.
  if (pending) return pending;

  setAuthError(null);

  const p = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      fn();
    };

    const timer = setTimeout(() => {
      const msg = describeAuthError({ code: 'auth/timeout' });
      finish(() => {
        setAuthError(msg);
        reject(new Error(msg));
      });
    }, SIGN_IN_TIMEOUT_MS);

    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          currentUid = user.uid;
          finish(() => {
            setAuthError(null);
            resolve(user.uid);
          });
        } else {
          signInAnonymously(auth).catch((err) => {
            const msg = describeAuthError(err);
            // eslint-disable-next-line no-console
            console.warn('[auth] anonymous sign-in failed:', (err as { code?: string })?.code, err);
            finish(() => {
              setAuthError(msg);
              reject(new Error(msg));
            });
          });
        }
      },
      (err) => {
        const msg = describeAuthError(err);
        finish(() => {
          setAuthError(msg);
          reject(new Error(msg));
        });
      }
    );
  });

  pending = p;
  // Clear the cache once settled so a failed sign-in can be retried.
  p.then(
    () => {
      pending = null;
    },
    () => {
      pending = null;
    }
  );
  return p;
}

/** Re-attempt sign-in after a failure (clears the cached error first). */
export function retryAuth(): Promise<string> {
  setAuthError(null);
  return ensureAnonymousAuth();
}

/**
 * React hook: subscribes to auth state + auth errors, kicks off
 * ensureAnonymousAuth once, and returns the uid (null until it resolves) plus
 * any actionable error message.
 */
export function useAuth(): { uid: string | null; error: string | null } {
  const [uid, setUid] = useState<string | null>(currentUid);
  const [error, setError] = useState<string | null>(authError);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
    });
    const onErr = (e: string | null) => setError(e);
    errorListeners.add(onErr);
    ensureAnonymousAuth().catch(() => {
      // The error is already surfaced via the errorListeners / getAuthError.
    });
    return () => {
      unsub();
      errorListeners.delete(onErr);
    };
  }, []);

  return { uid, error };
}

/** Back-compat: just the uid (null until auth resolves). */
export function useAuthUid(): string | null {
  return useAuth().uid;
}
