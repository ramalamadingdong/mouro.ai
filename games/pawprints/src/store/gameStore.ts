/**
 * The online room, as one zustand store. Adapted from the yahtzee app.
 *
 * `bindRoom` opens four long-lived things in module scope — the room
 * subscription, the connection watch, an auth listener and the presence
 * writer — and `unbindRoom` closes them. The router's RoomLayout is the one
 * owner of that pair (see app.tsx), so lobby → table never re-opens the
 * socket and leaving by ANY route tears everything down.
 */
import { create } from 'zustand';
import { onAuthStateChanged, onValue, ref } from '@mouro/realtime';
import { auth, db } from '@/net/realtime';
import { ensureAnonymousAuth, getAuthError, getCurrentUid } from '@/net/auth';
import { attachPresence, type PresenceHandle } from '@/net/presence';
import {
  deleteRoomIfStale,
  isRoomStale,
  startGame as startGameInRoom,
  submitMove,
  subscribeRoom,
  type RoomMeta,
  type RoomOptions,
  type RoomSeat,
  type RoomSnapshot,
} from '@/net/rooms';
import type { GameState, Move } from '@/engine';

interface RoomData {
  code: string | null;
  meta: RoomMeta | null;
  seats: Record<string, RoomSeat>;
  state: GameState | null;
  presence: Record<string, number>;
  /** This device's seat in `state.players`, or null (spectator / not dealt in). */
  mySeat: number | null;
  connected: boolean;
  pendingMove: boolean;
  error: string | null;
}

interface GameStore extends RoomData {
  bindRoom: (code: string) => void;
  unbindRoom: () => void;
  /**
   * Submit a move. `quiet` is for the moves clients send on the TABLE'S
   * behalf (`away`): several clients race to send them, all but one
   * are refused, and that refusal is the system working, not an error to show.
   */
  send: (move: Move, options?: { quiet?: boolean }) => Promise<void>;
  startGame: (options: RoomOptions) => Promise<void>;
  clearError: () => void;
}

const EMPTY: RoomData = {
  code: null,
  meta: null,
  seats: {},
  state: null,
  presence: {},
  mySeat: null,
  connected: false,
  pendingMove: false,
  error: null,
};

let roomUnsub: (() => void) | null = null;
let presence: PresenceHandle | null = null;
let connUnsub: (() => void) | null = null;
let authUnsub: (() => void) | null = null;
let boundCode: string | null = null;
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

function seatOf(state: GameState | null, uid: string | null): number | null {
  if (!state || !uid) return null;
  const seat = state.players.findIndex((p) => p.uid === uid);
  return seat >= 0 ? seat : null;
}

export const useGameStore = create<GameStore>()((set, get) => ({
  ...EMPTY,

  bindRoom: (code) => {
    if (boundCode === code) return;
    if (boundCode !== null) teardown();
    boundCode = code;
    set({ ...EMPTY, code });

    ensureAnonymousAuth().catch(() => set({ error: getAuthError() }));

    roomUnsub = subscribeRoom(code, (room: RoomSnapshot | null) => {
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
      // Presence is announced on the connection edge, which on a join fires
      // BEFORE the seat write lands — so that first announce is refused by
      // the rules. Announce again the first time a snapshot shows us seated.
      const member = uid !== null && (uid in room.seats || room.meta?.host === uid);
      if (member && presence && !presence.published()) presence.announce();
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
        mySeat: seatOf(room.state, uid),
      });
    });

    presence = attachPresence(code);

    connUnsub = onValue(ref(db, '.info/connected'), (snap) => {
      if (boundCode !== code) return;
      set({ connected: snap.val() === true });
    });

    authUnsub = onAuthStateChanged(auth, (user) => {
      if (boundCode !== code) return;
      set({ mySeat: seatOf(get().state, user?.uid ?? null) });
    });
  },

  unbindRoom: () => {
    teardown();
    set({ ...EMPTY });
  },

  send: async (move, options) => {
    const quiet = options?.quiet === true;
    const { code } = get();
    if (!code) {
      if (!quiet) set({ error: 'Not connected to a room yet. Go back and rejoin with the room code.' });
      return;
    }
    if (quiet) {
      // Background moves never touch `pendingMove` or `error`: they must not
      // lock the buttons or surface the refusals that losing a race produces.
      await submitMove(code, move).catch(() => undefined);
      return;
    }
    if (get().pendingMove) return;
    set({ pendingMove: true, error: null });
    try {
      const result = await submitMove(code, move);
      if (!result.ok) set({ error: result.error ?? 'That move was not accepted. Try again.' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not send that move.' });
    } finally {
      set({ pendingMove: false });
    }
  },

  startGame: async (options) => {
    const { code, meta, seats, state, presence: seen } = get();
    if (!code) {
      set({ error: 'Not connected to a room yet. Go back and rejoin with the room code.' });
      return;
    }
    try {
      await startGameInRoom(code, { meta, seats, state, presence: seen }, options);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not start the game.' });
    }
  },

  clearError: () => set({ error: null }),
}));
