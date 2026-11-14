/**
 * "Is the other player still here?" — the online dot next to each name.
 *
 * Presence lives at `rooms/<code>/presence/<uid>` as a BARE NUMBER: the ms
 * timestamp at which this player announced themselves. Online-ness is simply
 * WHETHER THE NODE EXISTS; the value is only ever shown as "last seen".
 *
 * It is deliberately outside `state` (it flaps every time a phone sleeps, and
 * inside `state` every backgrounding would become a game-state write the move
 * transaction had to carry), and it is deliberately a SCALAR rather than the
 * `{online, lastSeen}` object it used to be. Two separate bugs forced that:
 *
 *  1. An object node cannot be closed by security rules. RTDB has no "only
 *     these children" operator and `.validate` is never evaluated on an
 *     ANCESTOR of the written path, so `presence/<uid>/anything/deep` landed in
 *     a subtree with no rules at all — an unbounded write for any room member.
 *     A scalar has no such path: `newData.isNumber()` becomes unsatisfiable the
 *     instant the node turns into an object.
 *  2. `onDisconnect().update({lastSeen: serverTimestamp()})` is validated when
 *     it is ARMED, and at arm time the sentinel is still the unresolved object
 *     `{".sv":"timestamp"}` — so a rule asserting `lastSeen.isNumber()` denied
 *     the arm, and with it the announce chained behind it. Disconnect is now a
 *     REMOVE, which carries no sentinel and needs no shape at all.
 *
 * This is advisory only. Nothing in the game rules reads it — a player who
 * looks offline still holds their seat and still owes their turn. It exists so
 * the person staring at a table that has not moved for two minutes knows
 * whether to wait or to nudge.
 */
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import { db } from '@/fb/firebase';
import { ensureAnonymousAuth, getCurrentUid } from '@/fb/auth';

/** The handle `attachPresence` hands back. See each method for its contract. */
export interface PresenceHandle {
  /** Tear down: cancel the armed onDisconnect and announce the departure. */
  detach: () => void;
  /**
   * True once an `online: true` write has actually been ACCEPTED this session.
   * False means the announce was denied (we were not yet a member) and someone
   * should call `announce()` again when that changes.
   */
  published: () => boolean;
  /** Re-run the arm-then-announce sequence. Idempotent and safe to over-call. */
  announce: () => void;
}

/**
 * Mark this player online in `code` until `detach()` is called.
 *
 * Returns the handle synchronously (it is wired straight to a React effect
 * cleanup), even though the work it cancels may not have started yet on a cold
 * load where auth has not resolved.
 */
export function attachPresence(code: string): PresenceHandle {
  let detached = false;
  let stopConnectionWatch: (() => void) | null = null;
  // Captured so detach can cancel the armed handler even if it runs before the
  // uid ever arrived (in which case there is nothing armed and this stays null).
  let attachedUid: string | null = null;
  // Whether the server has ACCEPTED an `online: true` write for this session.
  let published = false;
  // One announce in flight at a time, so a burst of snapshot-driven retries
  // does not turn into a burst of writes.
  let announcing = false;

  /**
   * ARM FIRST, THEN ANNOUNCE. The order is load-bearing. If we set
   * `online: true` first and the connection died in the gap before the
   * onDisconnect handler reached the server, nothing would ever clear it and
   * this player would show as permanently online — the exact bug the green dot
   * exists to avoid. Arming first means the worst case is being shown offline
   * for a moment while actually online.
   *
   * Re-armed on EVERY announce because a server-side onDisconnect handler is
   * CONSUMED when it fires; after one drop the socket carries none.
   */
  const announce = (): void => {
    if (detached || announcing || !attachedUid) return;
    announcing = true;
    const myPresence = ref(db, `rooms/${code}/presence/${attachedUid}`);
    // Disconnect REMOVES the node rather than writing an offline marker. Besides
    // dodging the arm-time sentinel problem in the module header, it means
    // "offline" needs no representation at all — and a departed player leaves
    // nothing behind for the room reaper to have to clean up.
    onDisconnect(myPresence)
      .remove()
      .then(() => {
        if (detached) return;
        return set(myPresence, serverTimestamp()).then(() => {
          published = true;
        });
      })
      .catch((err: unknown) => {
        // Denied when this uid is neither seated nor host, which is the NORMAL
        // race on join: the room is bound (and presence attached) before the
        // seat write lands. `published` stays false so gameStore can call us
        // back the moment the snapshot proves we are a member — without that
        // retry the player showed offline to everyone for the whole session,
        // not "briefly" as this comment used to claim.
        console.warn(`[presence] could not publish presence in room ${code}:`, err);
      })
      .finally(() => {
        announcing = false;
      });
  };

  const start = (uid: string): void => {
    // The effect was already cleaned up while we waited for sign-in — a route
    // change during the first second of a cold load. Do not announce presence
    // in a room the user has left.
    if (detached) return;
    attachedUid = uid;

    /*
     * `.info/connected` is a local, synthetic node the SDK flips as its socket
     * comes and goes. Watching it (rather than writing presence once at mount)
     * is the whole trick: it fires again on every RECONNECT, which is exactly
     * when the presence node needs rewriting.
     *
     * The false edge is deliberately not handled. When the socket is down we
     * cannot write anything anyway, and the onDisconnect handler already queued
     * on the server is what publishes the offline state — that is its entire
     * purpose.
     */
    stopConnectionWatch = onValue(ref(db, '.info/connected'), (snap) => {
      if (snap.val() !== true) return;
      announce();
    });
  };

  const uid = getCurrentUid();
  if (uid) {
    start(uid);
  } else {
    // Cold load: sign-in has not resolved. Rejections are already surfaced as
    // actionable prose by the auth module, and a missing green dot is not worth
    // a second error message.
    ensureAnonymousAuth().then(start, () => undefined);
  }

  const detach = (): void => {
    detached = true;
    if (stopConnectionWatch) {
      stopConnectionWatch();
      stopConnectionWatch = null;
    }
    if (!attachedUid) return;

    const myPresence = ref(db, `rooms/${code}/presence/${attachedUid}`);
    // EXPLICITLY CANCEL THE ARMED HANDLER. An onDisconnect lives on the server
    // attached to the socket, not to this listener, so it survives detaching.
    // Left armed, it leaks across room switches: leave room A, join room B, and
    // whenever the socket eventually drops the stale handler writes a presence
    // node back into room A — resurrecting an entry under a room the user left,
    // and one that can be re-created after the room was deleted.
    onDisconnect(myPresence)
      .cancel()
      .catch(() => {
        // Offline, or the room is already gone. Both are fine: a handler that
        // cannot be cancelled has nothing left to write to.
      });
    // Remove ourselves directly rather than waiting for a disconnect that may be
    // minutes away — the user is still connected, they just left this room.
    // Swallowed because the room may have been deleted on the way out.
    remove(myPresence).catch(() => undefined);
  };

  return { detach, published: () => published, announce };
}
