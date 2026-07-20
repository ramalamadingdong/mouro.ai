/**
 * The online room store: one bound room's worth of Realtime Database state,
 * flattened into something a React component can render without knowing that
 * Firebase exists.
 *
 * The sync machinery lives OUTSIDE the store, in module scope. Subscription
 * handles are not state — nothing renders differently because an unsubscribe
 * function changed identity — and keeping them out of the store means binding a
 * room cannot itself schedule a render.
 *
 * `localStore.ts` mirrors the overlapping half of this shape exactly, so a
 * single table component can be driven by either and the two cannot drift.
 */
import { create } from 'zustand';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { auth, db } from '@/fb/firebase';
import { isFirebaseConfigured } from '@/fb/config';
import { ensureAnonymousAuth, getAuthError, getCurrentUid } from '@/fb/auth';
import { attachPresence, type PresenceHandle } from '@/fb/presence';
import {
  deleteRoomIfStale,
  isRoomStale,
  setMyHolds,
  startGame as startGameInRoom,
  submitMove,
  subscribeRoom,
  voteRematch as voteRematchInRoom,
  type PresenceEntry,
  type RoomMeta,
  type RoomSeat,
  type RoomSnapshot,
} from '@/fb/rooms';
import { seatOf, type GameState, type Move, type Seat } from '@/engine';

/** The data half of the store — everything a snapshot can replace wholesale. */
interface RoomData {
  /** The bound room code, or null when nothing is bound. */
  code: string | null;
  meta: RoomMeta | null;
  seats: Record<string, RoomSeat>;
  state: GameState | null;
  presence: Record<string, PresenceEntry>;
  /** Held-dice indices per uid, published so opponents can watch. */
  holds: Record<string, number[]>;
  rematchVotes: Record<string, boolean>;
  /** Our own seat, recomputed once per snapshot — never in a selector. */
  mySeat: Seat | null;
  /** RTDB socket health, from `.info/connected`. */
  connected: boolean;
  /** A move is in flight. Drives the disabled state of every action button. */
  pendingMove: boolean;
  /** Actionable prose for a human, never a raw error code. */
  error: string | null;
}

interface GameStore extends RoomData {
  bindRoom: (code: string) => void;
  unbindRoom: () => void;
  send: (move: Move) => Promise<void>;
  setHolds: (holds: number[]) => void;
  startGame: () => Promise<void>;
  voteRematch: () => Promise<void>;
  clearError: () => void;
}

/**
 * The single canonical "no room" shape. Reused for the initial value, for the
 * clear that `bindRoom` does before its first snapshot lands, and for a room
 * that has been deleted — so "not bound yet" and "room is gone" are literally
 * the same object shape and no component has to handle a third in-between case.
 */
const EMPTY: RoomData = {
  code: null,
  meta: null,
  seats: {},
  state: null,
  presence: {},
  holds: {},
  rematchVotes: {},
  mySeat: null,
  connected: false,
  pendingMove: false,
  error: null,
};

// ── Module-scoped subscription handles ───────────────────────────────────────
//
// Deliberately NOT store fields. They are plumbing; putting them in the store
// would make every bind/unbind publish a state change that no view cares about.

let roomUnsub: (() => void) | null = null;
let presence: PresenceHandle | null = null;
let connUnsub: (() => void) | null = null;
let authUnsub: (() => void) | null = null;
/** The code we are currently bound to. The idempotence check reads this. */
let boundCode: string | null = null;
/** One reap attempt per bind, so a stale room is not deleted once per snapshot. */
let reapAttempted = false;

function teardown(): void {
  roomUnsub?.();
  presence?.detach();
  connUnsub?.();
  authUnsub?.();
  roomUnsub = null;
  presence = null;
  connUnsub = null;
  authUnsub = null;
  boundCode = null;
  reapAttempted = false;
}

/**
 * Everything derived from a snapshot, computed ONCE here rather than inside
 * component selectors. A selector that called `seatOf(...)` would run on every
 * store change and, for anything object-valued, hand back a fresh reference each
 * time and re-render the component forever.
 */
function derive(room: RoomSnapshot, uid: string | null): Pick<RoomData, 'mySeat'> {
  return { mySeat: room.state && uid ? seatOf(room.state, uid) : null };
}

/**
 * Keep only the holds belonging to the player whose turn it is.
 *
 * `rooms/<code>/holds/<uid>` is written by setMyHolds and deleted by leaveRoom —
 * and by nothing else. No score, no turn advance and no rematch clears it, so
 * last turn's held indices sit in the node and come straight back as `keep` on
 * this turn's second roll, silently holding dice the player never touched.
 * (localStore has always cleared its whole holds map on a turn change; this is
 * the online half of that parity, expressed as a filter so a lagging
 * sibling-node update cannot resurrect them either.)
 *
 * Only the player on turn can meaningfully hold anything, so this drops exactly
 * the entries that are stale by definition.
 */
function holdsForTurn(
  holds: Record<string, number[]>,
  state: GameState | null,
): Record<string, number[]> {
  if (!state) return {};
  const own = holds[state.turnUid];
  return own ? { [state.turnUid]: own } : {};
}

/**
 * Drop our own rematch vote once the game is no longer over.
 *
 * A vote is written while `phase === 'over'`. If it survives into the next game
 * it reads as "this player already wants a rematch", and the moment the NEXT
 * game ends the vote tally is instantly complete — the room would restart out
 * from under a player who never pressed anything. rooms.ts clears the node on
 * its own schedule; this keeps our local view honest in the meantime.
 */
function withoutStaleOwnVote(
  votes: Record<string, boolean>,
  state: GameState | null,
  uid: string | null,
): Record<string, boolean> {
  if (!uid || !state || state.phase === 'over') return votes;
  if (!votes[uid]) return votes;
  const next = { ...votes };
  delete next[uid];
  return next;
}

export const useGameStore = create<GameStore>()((set, get) => ({
  ...EMPTY,

  /**
   * Attach to a room. IDEMPOTENT: this is called from a `useEffect`, which runs
   * twice under StrictMode's double-mount and again on every Fast Refresh.
   * Without the early return each of those would open a second set of RTDB
   * listeners on the same path and leak the first.
   */
  bindRoom: (code: string) => {
    if (boundCode === code) return;
    // A DIFFERENT code: tear the old room down first, or its snapshots keep
    // arriving and overwrite the new room's data.
    if (boundCode !== null) teardown();

    boundCode = code;
    set({ ...EMPTY, code });

    if (!isFirebaseConfigured) {
      set({
        error:
          'Online play is not configured on this build. Copy .env.example to .env, paste in your Firebase project config, and restart the dev server. Pass-and-play works without it.',
      });
      return;
    }

    // A uid is required to write a move, and the room view is usually the first
    // thing a deep-linked guest sees, so start sign-in here rather than waiting
    // for some component to mount `useAuth`.
    ensureAnonymousAuth().catch(() => {
      // describeAuthError has already produced prose; surface exactly that.
      set({ error: getAuthError() });
    });

    roomUnsub = subscribeRoom(code, (room) => {
      // A snapshot from a room we have since unbound (or rebound elsewhere)
      // must not land: unsubscribe is not always synchronous.
      if (boundCode !== code) return;

      if (room === null) {
        set({
          ...EMPTY,
          code,
          connected: get().connected,
          error:
            'That room is gone. The host may have closed it, or it was cleaned up after sitting idle. Ask for a new code, or start your own room.',
        });
        return;
      }

      const uid = getCurrentUid();

      /*
       * RETRY THE PRESENCE ANNOUNCE ONCE MEMBERSHIP ACTUALLY EXISTS.
       *
       * `attachPresence` announces on the `.info/connected` edge, which on a
       * join fires before `seats/<uid>` has landed. The presence write rule
       * requires the caller to be seated or host, so that first announce is
       * DENIED — and the socket does not reconnect just because a seat
       * appeared, so nothing ever retried it. The player showed permanently
       * offline to the whole room. The room snapshot is the signal we were
       * missing: the moment it shows us as a member, ask again.
       *
       * Gated on `published()` rather than on a local flag so a genuinely
       * accepted announce (including one re-published across a reconnect) is
       * never redone, and `announce()` is itself idempotent.
       */
      const member = uid !== null && (uid in room.seats || room.meta?.host === uid);
      if (member && presence && !presence.published()) presence.announce();

      // Opportunistic reap of a room we merely opened. This and leaveRoom are
      // what make the 24h collector actually run — the create-collision path it
      // used to rely on happens roughly never against 28.6M codes. Denied for a
      // live room, which is expected and swallowed inside deleteRoomIfStale.
      if (!reapAttempted && isRoomStale(room.meta)) {
        reapAttempted = true;
        void deleteRoomIfStale(code);
      }

      set({
        code,
        meta: room.meta,
        seats: room.seats,
        state: room.state,
        presence: room.presence,
        holds: holdsForTurn(room.holds, room.state),
        rematchVotes: withoutStaleOwnVote(room.rematch, room.state, uid),
        ...derive(room, uid),
      });
    });

    presence = attachPresence(code);

    // `.info/connected` is a local pseudo-path; it never hits the network and is
    // the only honest signal of whether writes are currently reaching the
    // server. `navigator.onLine` says nothing about Firebase specifically.
    connUnsub = onValue(ref(db, '.info/connected'), (snap) => {
      if (boundCode !== code) return;
      set({ connected: snap.val() === true });
    });

    /*
     * RECOMPUTE mySeat WHEN THE UID RESOLVES.
     *
     * RTDB data and Firebase Auth resolve on INDEPENDENT timelines. On a cold
     * start the first room snapshot frequently lands before the persisted
     * anonymous uid has been restored, so `seatOf(state, uid)` is called with
     * uid === null and yields null. Without this listener mySeat then stays
     * null until the NEXT snapshot arrives — and on an idle turn (nobody has
     * moved, nobody has toggled a hold) no next snapshot ever arrives. The
     * player sits there as a permanent spectator of a game they are seated in,
     * with every control disabled, and the only fix is a reload. So: when auth
     * finally reports a uid, re-derive the seat from the state we already have.
     */
    authUnsub = onAuthStateChanged(auth, (user) => {
      if (boundCode !== code) return;
      const uid = user?.uid ?? null;
      const state = get().state;
      set({
        mySeat: state && uid ? seatOf(state, uid) : null,
        rematchVotes: withoutStaleOwnVote(get().rematchVotes, state, uid),
      });
    });
  },

  unbindRoom: () => {
    teardown();
    set({ ...EMPTY });
  },

  /**
   * Submit a move. Rejections come back as prose from the engine (via rooms.ts)
   * and are shown, not swallowed — a move the client thought was legal being
   * refused by the transaction means our snapshot was stale, and the player
   * needs to know why the button did nothing.
   */
  send: async (move: Move) => {
    // IN-FLIGHT GUARD. Moves run with `applyLocally: false`, so every one costs
    // a full round-trip during which the UI still shows the pre-move state — a
    // double-tap would otherwise send the same score twice (the second gets
    // rejected as "that box is already used", which looks like a bug to the
    // player). This flag also drives the disabled state of every button.
    if (get().pendingMove) return;
    const { code } = get();
    if (!code) {
      set({ error: 'Not connected to a room yet. Go back and rejoin with the room code.' });
      return;
    }

    set({ pendingMove: true, error: null });
    try {
      const res = await submitMove(code, move);
      if (!res.ok) {
        set({ error: res.error ?? 'That move was not accepted. Try again.' });
      } else if (move.kind === 'score' || move.kind === 'rematch') {
        // BOTH of these end our turn, and neither clears `holds/<uid>` on its
        // own — the node is written by setMyHolds and deleted by leaveRoom, and
        // that is all. Left alone, this turn's held indices come back as `keep`
        // on our NEXT turn's second roll. Retiring them here is the write half
        // of the parity localStore gets for free by clearing its map on a turn
        // change; `holdsForTurn` above is the read half.
        set({ holds: {} });
        // Not awaited and not surfaced: a failed hold clear costs a cosmetic
        // highlight, and `holdsForTurn` already refuses to serve it as `keep`.
        void setMyHolds(code, []);
      }
    } catch (err) {
      set({ error: describe(err, 'Could not send that move.') });
    } finally {
      // In a finally so a thrown network error cannot wedge the UI in a
      // permanently disabled state.
      set({ pendingMove: false });
    }
  },

  /**
   * Holds are pure UI. Update locally FIRST and publish after, never the other
   * way round: a die must highlight on touch, and waiting on a round-trip to
   * paint it would make the table feel broken on a slow connection.
   */
  setHolds: (holds: number[]) => {
    const uid = getCurrentUid();
    const { code } = get();
    if (uid) set({ holds: { ...get().holds, [uid]: holds } });
    if (!code) return;
    setMyHolds(code, holds).catch((err: unknown) => {
      // Deliberately not surfaced. A failed hold publish costs the opponent a
      // cosmetic highlight; interrupting the player with an error banner over
      // it would be worse than the loss. The next hold or move republishes.
      console.warn('[gameStore] could not publish holds:', err);
    });
  },

  startGame: async () => {
    const { code, meta, seats, state, presence, holds, rematchVotes } = get();
    if (!code) {
      set({ error: 'Not connected to a room yet. Go back and rejoin with the room code.' });
      return;
    }
    // Rebuilt rather than kept as a field: the store holds the snapshot's parts
    // flattened for rendering, and one shape of truth beats two.
    const room: RoomSnapshot = { meta, seats, state, presence, holds, rematch: rematchVotes };
    try {
      await startGameInRoom(code, room);
    } catch (err) {
      set({ error: describe(err, 'Could not start the game.') });
    }
  },

  voteRematch: async () => {
    const { code } = get();
    if (!code) return;
    try {
      await voteRematchInRoom(code);
    } catch (err) {
      set({ error: describe(err, 'Could not register your rematch vote.') });
    }
  },

  clearError: () => set({ error: null }),
}));

/**
 * Turn a thrown value into something a player can act on. Firebase throws
 * `Error`s whose messages are usually already readable ("PERMISSION_DENIED..."),
 * so we keep them, prefixed by what we were trying to do.
 */
function describe(err: unknown, prefix: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `${prefix} ${msg || 'The connection may have dropped — check your network and try again.'}`;
}
