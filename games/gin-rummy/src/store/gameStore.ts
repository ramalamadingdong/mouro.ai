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
  matchIdFor,
  sendEmote as fbSendEmote,
  setMyCardBack,
  setRoomTarget,
  startRoundIfNeeded,
  submitMove,
  subscribeRoom,
  type EmoteEntry,
  type PresenceEntry,
  type RoomMeta,
} from '@/fb/rooms';
import { useSettingsStore } from '@/store/settingsStore';

/** Min gap between reactions (ms) — a light client-side anti-spam throttle. */
const EMOTE_THROTTLE_MS = 1200;

interface GameStore {
  code: string | null;
  meta: RoomMeta | null;
  state: GameState | null;
  presence: Record<string, PresenceEntry>;
  rematchVotes: Record<string, boolean>;
  /** Per-uid custom card-back photo (`data:` URI), synced from the room. */
  backs: Record<string, string>;
  /** Per-uid latest reaction, synced from the room, driving the emote pops. */
  emotes: Record<string, EmoteEntry>;
  mySeat: Seat | null;
  connected: boolean;
  pendingMove: boolean;
  error: string | null;

  bindRoom: (code: string) => void;
  unbindRoom: () => void;
  send: (move: Move) => Promise<void>;
  /** Host-only: set the match winning score (before the deal). */
  setTarget: (target: number) => void;
  /** Broadcast a reaction to the opponent (throttled). */
  sendEmote: (emoji: string) => void;
  reset: () => void;
}

// Module-scoped subscription handles — the sync layer is not React state.
let roomUnsub: (() => void) | null = null;
let presenceDetach: (() => void) | null = null;
let connUnsub: (() => void) | null = null;
let authUnsub: (() => void) | null = null;
let backUnsub: (() => void) | null = null;
let boundCode: string | null = null;
// Timestamp of our last sent reaction — module-scoped throttle, not React state.
let lastEmoteAt = 0;

const EMPTY: {
  meta: null;
  state: null;
  presence: Record<string, PresenceEntry>;
  rematchVotes: Record<string, boolean>;
  backs: Record<string, string>;
  emotes: Record<string, EmoteEntry>;
  mySeat: null;
} = {
  meta: null,
  state: null,
  presence: {},
  rematchVotes: {},
  backs: {},
  emotes: {},
  mySeat: null,
};

export const useGameStore = create<GameStore>()((set, get) => ({
  code: null,
  meta: null,
  state: null,
  presence: {},
  rematchVotes: {},
  backs: {},
  emotes: {},
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
        backs: room.backs,
        emotes: room.emotes,
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

    // Publish our own card back so the OPPONENT renders it on our face-down
    // cards, and keep it in sync if we change it mid-game. setMyCardBack no-ops
    // until the uid resolves, so we also (re)publish from the auth listener.
    const publishBack = () => {
      void setMyCardBack(code, useSettingsStore.getState().customCardBack);
    };
    let lastBack = useSettingsStore.getState().customCardBack;
    backUnsub = useSettingsStore.subscribe((s) => {
      if (s.customCardBack !== lastBack) {
        lastBack = s.customCardBack;
        publishBack();
      }
    });
    publishBack();

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
      if (uid) publishBack(); // uid now known — (re)publish our card back
    });

    presenceDetach = attachPresence(code);
  },

  unbindRoom: () => {
    roomUnsub?.();
    presenceDetach?.();
    connUnsub?.();
    authUnsub?.();
    backUnsub?.();
    roomUnsub = null;
    presenceDetach = null;
    connUnsub = null;
    authUnsub = null;
    backUnsub = null;
    boundCode = null;
    set({ connected: false });
  },

  send: async (move) => {
    const { code, meta } = get();
    if (!code) return;
    if (get().pendingMove) return; // in-flight guard: ignore double-taps
    set({ pendingMove: true, error: null });
    try {
      // meta.createdAt keys the analytics archive; absent only before the first
      // room snapshot, when no move can have been sent yet.
      const matchId = meta ? matchIdFor(code, meta.createdAt) : undefined;
      const res = await submitMove(code, move, matchId);
      if (!res.ok) set({ error: res.error ?? 'Move rejected' });
    } catch (err) {
      set({ error: (err as Error)?.message ?? 'Move failed' });
    } finally {
      set({ pendingMove: false });
    }
  },

  setTarget: (target) => {
    const code = get().code;
    if (!code) return;
    void setRoomTarget(code, target);
  },

  sendEmote: (emoji) => {
    const code = get().code;
    if (!code) return;
    const now = Date.now();
    if (now - lastEmoteAt < EMOTE_THROTTLE_MS) return; // anti-spam
    lastEmoteAt = now;
    void fbSendEmote(code, emoji);
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
