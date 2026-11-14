/**
 * Offline match against the computer.
 *
 * Mirrors `gameStore`'s public surface (`state`, `mySeat`, `pendingMove`,
 * `error`, `send`, `reset`) on purpose, so `<BackgammonBoard>` cannot tell the
 * two apart and there is no second implementation of the table to keep in step.
 *
 * The whole thing runs on the pure reducer, so it works with Firebase entirely
 * unconfigured and with no network at all.
 */
import { create } from 'zustand';
import { chooseMove } from '@/ai/cpu';
import type { Difficulty } from '@/ai/difficulty';
import { applyMove, initialMatchState } from '@/engine';
import { makeRng } from '@/engine/rng';
import type { GameState, Move, Seat } from '@/engine/types';
import { randomSeed } from '@/util/seed';

export const HUMAN_UID = 'p0-local';
export const CPU_UID = 'cpu';

/** How long the computer "thinks" before each visible step. */
const THINK_MIN_MS = 550;
const THINK_JITTER_MS = 450;

interface SoloStore {
  state: GameState | null;
  mySeat: Seat | null;
  difficulty: Difficulty;
  pendingMove: boolean;
  cpuThinking: boolean;
  error: string | null;

  newMatch: (opts: { difficulty: Difficulty; target: number; playerName: string }) => void;
  send: (move: Move) => void;
  reset: () => void;
}

// Module-scoped so a re-render can never leave two timers driving the CPU.
let cpuTimer: ReturnType<typeof setTimeout> | null = null;

function clearCpu() {
  if (cpuTimer) clearTimeout(cpuTimer);
  cpuTimer = null;
}

export const useSoloStore = create<SoloStore>()((set, get) => {
  /**
   * Drive the computer one visible step at a time.
   *
   * Rolling and moving are emitted as SEPARATE timed steps so the human sees
   * the dice land before the checkers move — a single combined update reads as
   * the board teleporting.
   */
  const driveCpu = () => {
    clearCpu();
    const s = get().state;
    if (!s) return;

    // Deliberately NOT `gameOver`/`matchOver`: those belong to the human, who
    // needs the end-of-game reveal to stay on screen until they dismiss it.
    const cpuActs =
      s.turn === 'p1' &&
      (s.phase === 'opening' || s.phase === 'roll' || s.phase === 'moving');
    if (!cpuActs) {
      set({ cpuThinking: false });
      return;
    }

    set({ cpuThinking: true });
    // Jitter from the position rather than Math.random, so a replay of the same
    // match feels the same. This is presentation only and never reaches the
    // engine, but keeping one source of randomness is simpler to reason about.
    const delay = THINK_MIN_MS + Math.floor(makeRng([s.version, s.game, 11])() * THINK_JITTER_MS);
    cpuTimer = setTimeout(() => {
      // Re-read: the human may have reset or left while we were "thinking".
      const cur = get().state;
      if (!cur) return;
      const move = chooseMove(cur, CPU_UID, get().difficulty, randomSeed());
      if (!move) {
        set({ cpuThinking: false });
        return;
      }
      const r = applyMove(cur, move, CPU_UID);
      if (!r.ok) {
        // A rejected CPU move is a bug, not a game event — surface it rather
        // than silently freezing the board on the computer's turn.
        set({ error: `Computer move rejected: ${r.error}`, cpuThinking: false });
        return;
      }
      set({ state: r.state });
      driveCpu();
    }, delay);
  };

  return {
    state: null,
    mySeat: 'p0',
    difficulty: 'medium',
    pendingMove: false,
    cpuThinking: false,
    error: null,

    newMatch: ({ difficulty, target, playerName }) => {
      clearCpu();
      const state = initialMatchState({
        hostUid: HUMAN_UID,
        guestUid: CPU_UID,
        hostName: playerName || 'You',
        guestName: 'Computer',
        target,
      });
      set({ state, mySeat: 'p0', difficulty, error: null, cpuThinking: false, pendingMove: false });
      driveCpu();
    },

    send: (move) => {
      const s = get().state;
      if (!s) return;
      if (get().cpuThinking && move.kind !== 'nextGame' && move.kind !== 'rematch') return;
      const r = applyMove(s, move, HUMAN_UID);
      if (!r.ok) {
        set({ error: r.error });
        return;
      }
      set({ state: r.state, error: null });
      driveCpu();
    },

    reset: () => {
      clearCpu();
      set({ state: null, error: null, cpuThinking: false, pendingMove: false });
    },
  };
});
