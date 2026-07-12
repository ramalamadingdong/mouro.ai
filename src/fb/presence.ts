/**
 * Presence tracking for a room. Marks the current uid online while connected and
 * registers an onDisconnect that flips it offline when the socket drops.
 */
import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
} from 'firebase/database';
import { getCurrentUid } from '@/fb/auth';
import { db } from '@/fb/firebase';

/**
 * Attach presence for the current uid under rooms/<code>/presence/<uid>.
 * Returns a detach function that stops watching and best-effort marks offline.
 */
export function attachPresence(code: string): () => void {
  const uid = getCurrentUid();
  if (!uid) return () => {};

  const connectedRef = ref(db, '.info/connected');
  const presRef = ref(db, `rooms/${code}/presence/${uid}`);

  const unsub = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    // Arm the disconnect handler first, then announce we're online.
    onDisconnect(presRef)
      .update({ online: false, lastSeen: serverTimestamp() })
      .then(() => set(presRef, { online: true, lastSeen: serverTimestamp() }))
      .catch(() => {});
  });

  return () => {
    unsub();
    // Disarm the server-side disconnect handler for THIS room before leaving,
    // otherwise it stays armed on the socket and leaks across room switches
    // (and could re-create a presence node under a room we have left).
    onDisconnect(presRef).cancel().catch(() => {});
    set(presRef, { online: false, lastSeen: serverTimestamp() }).catch(() => {});
  };
}
