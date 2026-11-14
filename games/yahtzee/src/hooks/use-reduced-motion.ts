/**
 * The OS-level "reduce motion" preference, live.
 *
 * DELIBERATELY does not know about the in-app motion toggle. Combine them at
 * the CALL SITE:
 *
 *     const osReduced = useReducedMotion();
 *     const motion = useSettingsStore((s) => s.motion) && !osReduced;
 *
 * That ordering matters: the OS preference is a HARD VETO. If this hook merged
 * the two it would be possible for a future caller to pass a truthy app setting
 * and re-enable tumbling dice for someone whose system says motion makes them
 * ill. Keeping the veto as an `&& !osReduced` at every call site makes it
 * impossible to express the wrong precedence.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * `useSyncExternalStore` rather than useState+useEffect specifically so the
 * value is correct on the FIRST render. With an effect, the first paint would
 * animate and only then stop, which is exactly the flash of motion the
 * preference exists to prevent.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(QUERY);
  // `addEventListener('change')`, not the deprecated `addListener`. Safari has
  // supported the modern form since 14; we do not support older.
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/** True when the operating system asks for reduced motion. */
export function useReducedMotion(): boolean {
  // The third argument is the server snapshot; there is no SSR here, but
  // passing it keeps the hook safe to import from a Node test.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
