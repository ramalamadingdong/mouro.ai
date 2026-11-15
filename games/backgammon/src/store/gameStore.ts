/**
 * Live room store. The Firebase listener lives OUTSIDE React (module-level
 * subscriptions) and pushes normalized snapshots in via setState; components
 * select the slices they need.
 */
import { onAuthStateChanged } from '@mouro/realtime';
import { onValue, ref, remove } from '@mouro/realtime';
import { create } from 'zustand';
import { seatOf } from '@/engine';
import type { GameState, Move, Seat, Step } from '@/engine/types';
import { getCurrentUid } from '@/net/auth';
import { auth, db } from '@/net/realtime';
import { attachPresence } from '@/net/presence';
import {
  matchIdFor,
  publishDraft as fbPublishDraft,
  sendEmote as fbSendEmote,
  setRoomTarget,
  startMatchIfNeeded,
  submitMove,
  subscribeRoom,
  type DraftEntry,
  type EmoteEntry,
  type PresenceEntry,
  type RoomMeta,
} from '@/net/rooms';

/** Min gap between reactions (ms) — a light client-side anti-spam throttle. */
const EMOTE_THROTTLE_MS = 1200;

interface GameStore {
  code: string | null;
  meta: RoomMeta | null;
  state: GameState | null;
  presence: Record<string, PresenceEntry>;
  rematchVotes: Record<string, boolean>;
  emotes: Record<string, EmoteEntry>;
  /** Each player's in-progress turn, keyed by uid. See `publishDraft`. */
  drafts: Record<string, DraftEntry>;
  mySeat: Seat | null;
  connected: boolean;
  pendingMove: boolean;
  error: string | null;

  bindRoom: (code: string) => void;
  unbindRoom: () => void;
  send: (move: Move) => Promise<void>;
  /** Host-only: set the match length in points (before the match starts). */
  setTarget: (target: number) => void;
  /** Broadcast a reaction to the opponent (throttled). */
  sendEmote: (emoji: string) => void;
  /** Show the opponent the turn being staged against state `version`. */
  publishDraft: (version: number, steps: Step[]) => void;
  reset: () => void;
}

// Module-scoped subscription handles — the sync layer is not React state.
let roomUnsub: (() => void) | null = null;
let presenceDetach: (() => void) | null = null;
let connUnsub: (() => void) | null = null;
let authUnsub: (() => void) | null = null;
let boundCode: string | null = null;
let lastEmoteAt = 0;

const EMPTY: {
  meta: null;
  state: null;
  presence: Record<string, PresenceEntry>;
  rematchVotes: Record<string, boolean>;
  emotes: Record<string, EmoteEntry>;
  drafts: Record<string, DraftEntry>;
  mySeat: null;
} = {
  meta: null,
  state: null,
  presence: {},
  rematchVotes: {},
  emotes: {},
  drafts: {},
  mySeat: null,
};

export const useGameStore = create<GameStore>()((set, get) => ({
  code: null,
  meta: null,
  state: null,
  presence: {},
  rematchVotes: {},
  emotes: {},
  drafts: {},
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
        emotes: room.emotes,
        drafts: room.drafts,
        mySeat,
      });

      // The host opens the board as soon as a guest is present.
      startMatchIfNeeded(code, room).catch(() => {});

      // Self-heal: once a rematch has started (phase left matchOver), drop our
      // own stale vote so it can't trigger the next match's rematch early.
      if (uid && room.state && room.state.phase !== 'matchOver' && room.rematch[uid]) {
        remove(ref(db, `bgRooms/${code}/rematch/${uid}`)).catch(() => {});
      }
    });

    connUnsub = onValue(ref(db, '.info/connected'), (snap) => {
      set({ connected: snap.val() === true });
    });

    // Recompute mySeat whenever the auth uid resolves/changes. On cold start or
    // resume-via-lastRoom the first room snapshot frequently arrives BEFORE the
    // persisted anonymous uid is restored, so getCurrentUid() is null and
    // seatOf() yields null; without this listener mySeat would stay null until
    // the NEXT snapshot (which never comes while it is the opponent's turn),
    // stranding the player as a spectator in their own game.
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
    const { code, meta } = get();
    if (!code) return;
    if (get().pendingMove) return; // in-flight guard: ignore double-taps
    set({ pendingMove: true, error: null });
    try {
      const matchId = meta ? matchIdFor(code, meta.createdAt) : undefined;
      const res = await submitMove(code, move, matchId);
      if (!res.ok) {
        // `nextGame` races: both players tap "Next game" and the slower write
        // finds the phase already advanced. That is the system working, not an
        // error worth showing.
        const benign = move.kind === 'nextGame' || move.kind === 'rematch';
        if (!benign) set({ error: res.error ?? 'Move rejected' });
      }
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

  publishDraft: (version, steps) => {
    const code = get().code;
    if (!code) return;
    void fbPublishDraft(code, version, steps);
  },

  reset: () => {
    get().unbindRoom();
    set({ code: null, connected: false, pendingMove: false, error: null, ...EMPTY });
  },
}));
