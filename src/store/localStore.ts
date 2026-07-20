/**
 * Pass-and-play: 1..RULES.MAX_PLAYERS seats sharing one device, no network at
 * all. This store imports NOTHING from `@/fb` — not even transitively — so the
 * whole offline mode works on a build with no Firebase config, which is exactly
 * the state a fresh clone of the repo is in.
 *
 * Where it overlaps `gameStore` the shape is IDENTICAL on purpose (state,
 * mySeat, pendingMove, error, holds, send, setHolds, clearError), so one table
 * component drives both and a change to the online flow cannot silently break
 * the offline one.
 */
import { create } from 'zustand';
import { applyMove, initialGameState, RULES, type GameState, type Move, type Player, type Seat } from '@/engine';

/**
 * Seat uids for local play. They only have to be stable and distinct within one
 * game — nothing reads them off the network — but they are prefixed so a stray
 * local state can never be mistaken for a Firebase uid in a log.
 */
function localUid(seat: Seat): string {
  return `local-${seat}`;
}

interface LocalStore {
  state: GameState | null;
  /** Always equals `state.turn`: the device is whoever is on turn. */
  mySeat: Seat | null;
  /**
   * ALWAYS FALSE. Local moves are synchronous, so nothing is ever in flight.
   * It exists purely for prop parity with gameStore, so the shared table
   * component can read `pendingMove` from either store without a branch.
   */
  pendingMove: boolean;
  /** Held-dice indices keyed by the local uid of the seat that set them. */
  holds: Record<string, number[]>;
  error: string | null;
  send: (move: Move) => void;
  setHolds: (holds: number[]) => void;
  clearError: () => void;
  newGame: (names: string[]) => void;
  reset: () => void;
}

const EMPTY = {
  state: null,
  mySeat: null,
  pendingMove: false,
  holds: {},
  error: null,
} as const;

/**
 * Build the seated players from a roster of names.
 *
 * Clamped to RULES.MAX_PLAYERS and padded to at least one seat because
 * `initialGameState` indexes `players[0]` unconditionally — an empty roster
 * would throw inside the pure engine, which is the one place that must never
 * happen.
 */
function playersFrom(names: string[]): Player[] {
  const usable = names.slice(0, RULES.MAX_PLAYERS);
  if (usable.length === 0) usable.push('Player 1');
  return usable.map((name, seat) => ({
    uid: localUid(seat),
    // A blank text field is the common case (the roster UI starts empty), and a
    // nameless player would render as an empty scorecard column header.
    name: name.trim() || `Player ${seat + 1}`,
  }));
}

export const useLocalStore = create<LocalStore>()((set, get) => ({
  ...EMPTY,

  newGame: (names: string[]) => {
    const state = initialGameState(playersFrom(names));
    set({ ...EMPTY, state, mySeat: state.turn });
  },

  reset: () => set({ ...EMPTY }),

  /**
   * Apply a move synchronously. `applyMove` never throws — it returns a
   * rejection reason — so the only failure path is setting `error`.
   *
   * The acting uid is derived from the state rather than passed in, because on
   * this device "the player" is by definition whoever is on turn. (In phase
   * `over` that seat is still a seated player, which is all `rematch` needs.)
   */
  send: (move: Move) => {
    const prev = get().state;
    if (!prev) {
      set({ error: 'No game in progress. Start a new pass-and-play game first.' });
      return;
    }

    const res = applyMove(prev, move, prev.players[prev.turn].uid);
    if (!res.ok) {
      set({ error: res.error });
      return;
    }
    const next = res.state;

    /*
     * THE ONE PLACE LOCAL AND ONLINE GENUINELY DIFFER: clear the holds on every
     * turn change. Online, each player's holds live under their own uid and
     * belong to them. Here the dice are physically handed to the next person,
     * and inheriting the previous player's held-die highlights would show them
     * a table that is already half-decided for them. `round` is compared as well
     * as `turn` because in a solo game the turn index never changes.
     */
    const turnChanged = next.turn !== prev.turn || next.round !== prev.round;

    set({
      state: next,
      // The device follows the turn, so this is the whole of "who am I" here.
      mySeat: next.turn,
      holds: turnChanged ? {} : get().holds,
      error: null,
    });
  },

  /**
   * Holds for the seat currently on turn. No network, so this is already as
   * instant as gameStore's optimistic version.
   */
  setHolds: (holds: number[]) => {
    const state = get().state;
    if (!state) return;
    set({ holds: { ...get().holds, [state.players[state.turn].uid]: holds } });
  },

  clearError: () => set({ error: null }),
}));
