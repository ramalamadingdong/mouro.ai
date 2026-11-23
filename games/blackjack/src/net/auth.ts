/**
 * Anonymous auth. The uid this produces IS the player's identity everywhere in
 * the data model: `meta.host`, the seat keys under `rooms/<code>/seats`,
 * presence keys, `players[].uid`, and the `turnUid` the database rules
 * authorize writes against. Nothing else identifies a player.
 *
 * Two design points worth knowing before editing:
 *
 * 1. THE UID CACHE IS SYNCHRONOUS. `getCurrentUid()` reads a module-level
 *    variable kept fresh by a subscription registered at import time. That is
 *    what lets `rooms.ts` open every function with a cheap `const uid =
 *    getCurrentUid(); if (!uid) return ...` guard instead of every room
 *    operation having to be async-auth-aware and await a promise it almost
 *    never needs.
 *
 * 2. SIGN-IN IS SINGLE-FLIGHT. See ensureAnonymousAuth.
 *
 * Sign-in can fail (Anonymous provider disabled in the console is by far the
 * most common) or hang (captive-portal wifi). Both surface as actionable prose,
 * never as a raw error code, because the person reading it is usually
 * the developer who forgot to flip the switch in the console.
 */
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from '@mouro/realtime';
import { auth } from '@/net/realtime';
import { isOnlineConfigured } from '@/net/config';

// ── Synchronous uid cache ────────────────────────────────────────────────────

/**
 * Seeded from `auth.currentUser` because the SDK may already have restored a
 * persisted session by the time this module first executes; starting at null
 * and waiting for the callback would make the very first `getCurrentUid()`
 * spuriously report "signed out".
 */
let currentUid: string | null = auth.currentUser?.uid ?? null;

// Registered at import time, never torn down: this subscription is the thing
// that keeps the synchronous accessor honest for the life of the page.
onAuthStateChanged(auth, (user) => {
  currentUid = user?.uid ?? null;
});

/** The current anonymous uid, or null if auth has not resolved yet. */
export function getCurrentUid(): string | null {
  return currentUid;
}

// ── Error observable ─────────────────────────────────────────────────────────
//
// Hand-rolled rather than React state so that non-React callers (rooms.ts, the
// zustand stores) can read the current auth error synchronously without a hook.

let authError: string | null = null;
const errorListeners = new Set<(e: string | null) => void>();

function setAuthError(e: string | null): void {
  authError = e;
  errorListeners.forEach((listen) => listen(e));
}

/** Latest auth error message, or null when signed in or still trying. */
export function getAuthError(): string | null {
  return authError;
}

/**
 * Turn a sign-in failure into something a player can act on. The realtime
 * server has one way to sign in (an anonymous token), so in practice the only
 * failures are "cannot reach it" and "took too long".
 */
function describeAuthError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  const raw = (err as Error | null)?.message ?? String(err);
  if (code === 'auth/timeout') {
    return 'Connecting to the game server timed out. Check that you are online, then try again. Playing the cats works without a connection.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Could not reach the game server. Check your internet connection and try again.';
  }
  // Unmapped failures still get prose plus the raw text: something the
  // developer can search for beats a dead end.
  return `Could not connect to the game server${code ? ` (${code})` : ''}. ${raw}`;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

/** How long to wait before giving up, so the UI never hangs on "connecting...". */
const SIGN_IN_TIMEOUT_MS = 15_000;

/**
 * The in-flight sign-in, or null. Module-scoped so every caller shares one.
 */
let pending: Promise<string> | null = null;

/**
 * Resolve (or create) the anonymous session and return its uid.
 *
 * SINGLE-FLIGHT, and this matters: before any user exists, the client does NOT
 * dedup concurrent `signInAnonymously` calls. Every `useAuth()` mount firing
 * its own call on a cold load would mint N separate throwaway anonymous
 * accounts, N-1 of which are immediately orphaned — and worse, whichever one
 * wins the race is the uid the app ends up using, so two components could
 * briefly disagree about who the player is. One shared promise removes both
 * problems.
 */
export function ensureAnonymousAuth(): Promise<string> {
  if (pending) return pending;

  // Kept from the shared auth module: a build can declare itself offline-only.
  if (!isOnlineConfigured) {
    const msg = 'Online play is not available in this build. Playing the cats works without it.';
    setAuthError(msg);
    return Promise.reject(new Error(msg));
  }

  setAuthError(null);

  const p = new Promise<string>((resolve, reject) => {
    // One latch guarding both cleanups. The timer and the auth subscription can
    // each fire after the other has already decided the outcome, and running
    // cleanup twice would either clear a timer id that has been reused or
    // invoke a stale unsubscribe.
    let settled = false;
    const finish = (report: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      report();
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
          // Update the cache here as well as in the module-level subscription:
          // callback ordering between the two is not guaranteed, and a caller
          // that awaits this promise must see a non-null getCurrentUid().
          currentUid = user.uid;
          finish(() => {
            setAuthError(null);
            resolve(user.uid);
          });
          return;
        }
        // No user yet — create one. A success here comes back through this same
        // callback with `user` set, so only the failure path is handled.
        signInAnonymously(auth).catch((err: unknown) => {
          const msg = describeAuthError(err);
          console.warn('[auth] anonymous sign-in failed:', err);
          finish(() => {
            setAuthError(msg);
            reject(new Error(msg));
          });
        });
      },
      // The observer's own error channel: fires when the SDK itself gives up.
      (err) => {
        const msg = describeAuthError(err);
        finish(() => {
          setAuthError(msg);
          reject(new Error(msg));
        });
      },
    );
  });

  pending = p;
  // Release the single-flight slot on BOTH settle paths. Clearing only on
  // success would make the first failure permanent — retryAuth() would hand
  // back the same rejected promise forever and the user could never recover
  // from a transient network blip without a reload.
  p.then(
    () => {
      pending = null;
    },
    () => {
      pending = null;
    },
  );
  return p;
}

/**
 * Re-attempt sign-in after a failure.
 *
 * Returns void by design: this is wired straight to a "Try again" button, and
 * an ignored rejected promise from an onClick handler is an unhandled rejection
 * in the console. The outcome is reported through the error observable instead,
 * which is what the UI is already rendering.
 */
export function retryAuth(): void {
  setAuthError(null);
  ensureAnonymousAuth().catch(() => {
    // Intentionally swallowed: describeAuthError has already pushed actionable
    // prose to every error listener, and getAuthError() holds it.
  });
}

/**
 * React binding: the current uid and any actionable auth error.
 *
 * Kicks off `ensureAnonymousAuth` once on mount; because that is single-flight,
 * mounting this hook in ten components still performs one sign-in.
 */
export function useAuth(): { uid: string | null; error: string | null } {
  // Seeded from the module caches rather than null so that a remount — a route
  // change, a Strict Mode double-mount — does not flash "signed out" and make
  // the UI bounce through its connecting state for a frame.
  const [uid, setUid] = useState<string | null>(currentUid);
  const [error, setError] = useState<string | null>(authError);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
    });

    const onError = (e: string | null): void => setError(e);
    errorListeners.add(onError);

    // Re-read after subscribing: an error could have been set between the
    // useState initializer and this effect running.
    setError(authError);

    ensureAnonymousAuth().catch(() => {
      // Already surfaced via the error observable above.
    });

    return () => {
      unsub();
      errorListeners.delete(onError);
    };
  }, []);

  return { uid, error };
}
