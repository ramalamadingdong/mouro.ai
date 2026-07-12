/**
 * Live room store. The Firebase listener lives OUTSIDE React (module-level
 * subscriptions) and pushes normalized snapshots in via setState; components
 * select the slices they need. Derived helpers (mySeat, connected) are computed
 * on each snapshot to keep re-renders cheap.
 */
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref, remove } from 'firebase/database';
import { create } from 'zustand';
import { seatOf } from '@/engine';
import type { GameState, Move, Seat } from '@/engine/types';
import { getCurrentUid } from '@/fb/auth';
import { auth, db } from '@/fb/firebase';
import { attachPresence } from '@/fb/presence';
import {
  startRoundIfNeeded,
  submitMove,
  subscribeRoom,
  type PresenceEntry,
  type RoomMeta,
} from '@/fb/rooms';

interface GameStore {
  code: string | null;
  meta: RoomMeta | null;
  state: GameState | null;
  presence: Record<string, PresenceEntry>;
  rematchVotes: Record<string, boolean>;
  mySeat: Seat | null;
  connected: boolean;
  pendingMove: boolean;
  error: string | null;

  bindRoom: (code: string) => void;
  unbindRoom: () => void;
  send: (move: Move) => Promise<void>;
  reset: () => void;
}

// Module-scoped subscription handles — the sync layer is not React state.
let roomUnsub: (() => void) | null = null;
let presenceDetach: (() => void) | null = null;
let connUnsub: (() => void) | null = null;
let authUnsub: (() => void) | null = null;
let boundCode: string | null = null;

const EMPTY: {
  meta: null;
  state: null;
  presence: Record<string, PresenceEntry>;
  rematchVotes: Record<string, boolean>;
  mySeat: null;
} = {
  meta: null,
  state: null,
  presence: {},
  rematchVotes: {},
  mySeat: null,
};

export const useGameStore = create<GameStore>()((set, get) => ({
  code: null,
  meta: null,
  state: null,
  presence: {},
  rematchVotes: {},
  mySeat: null,
  connected: false,
  pendingMove: false,
  error: null,

  bindRoom: (code) => {
    if (boundCode === code) return; // idempotent
    get().unbindRoom();
    boundCode = code;
    set({ code, error: null, ...EMPTY });

    roomUnsub = subscribeRoom(code, (room) => {
      if (!room) {
        set({ ...EMPTY });
        return;
      }
      const uid = getCurrentUid();
      const mySeat = room.state && uid ? seatOf(room.state, uid) : null;
      set({
        meta: room.meta,
        state: room.state,
        presence: room.presence,
        rematchVotes: room.rematch,
        mySeat,
      });

      // Host deals as soon as a guest is present.
      startRoundIfNeeded(code, room).catch(() => {});

      // Self-heal: once a rematch has started (phase left matchOver), drop our
      // own stale vote so it can't trigger the next match's rematch early.
      if (
        uid &&
        room.state &&
        room.state.phase !== 'matchOver' &&
        room.rematch[uid]
      ) {
        remove(ref(db, `rooms/${code}/rematch/${uid}`)).catch(() => {});
      }
    });

    connUnsub = onValue(ref(db, '.info/connected'), (snap) => {
      set({ connected: snap.val() === true });
    });

    // Recompute mySeat whenever the auth uid resolves/changes. On cold start or
    // resume-via-lastRoom the first room snapshot frequently arrives BEFORE the
    // persisted anonymous uid is restored, so getCurrentUid() is null and
    // seatOf() yields null; without this listener mySeat would stay null until
    // the NEXT snapshot (which never comes on an idle turn), stranding the
    // player as a spectator.
    authUnsub = onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      const st = get().state;
      set({ mySeat: st && uid ? seatOf(st, uid) : null });
    });

    presenceDetach = attachPresence(code);
  },

  unbindRoom: () => {
    roomUnsub?.();
    presenceDetach?.();
    connUnsub?.();
    authUnsub?.();
    roomUnsub = null;
    presenceDetach = null;
    connUnsub = null;
    authUnsub = null;
    boundCode = null;
    set({ connected: false });
  },

  send: async (move) => {
    const code = get().code;
    if (!code) return;
    if (get().pendingMove) return; // in-flight guard: ignore double-taps
    set({ pendingMove: true, error: null });
    try {
      const res = await submitMove(code, move);
      if (!res.ok) set({ error: res.error ?? 'Move rejected' });
    } catch (err) {
      set({ error: (err as Error)?.message ?? 'Move failed' });
    } finally {
      set({ pendingMove: false });
    }
  },

  reset: () => {
    get().unbindRoom();
    set({
      code: null,
      connected: false,
      pendingMove: false,
      error: null,
      ...EMPTY,
    });
  },
}));
