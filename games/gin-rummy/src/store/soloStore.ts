/**
 * Offline "play vs computer" store. Unlike the online `gameStore` (which runs the
 * reducer inside a Firebase transaction and waits for the snapshot to round-trip),
 * this store owns the `GameState` locally and applies moves synchronously via the
 * pure engine — so it works with no network and even when Firebase is unconfigured.
 *
 * The human is seat `p0` (uid `p0-local`); the computer is seat `p1` (uid `cpu`).
 * A module-scoped timer drives the CPU: whenever it becomes the computer's turn in
 * a play phase, the store schedules `chooseMove` after a short, natural delay,
 * applying draw and discard as separate visible steps. The human triggers
 * `nextRound` / `rematch` directly (no rematch voting).
 */
import { create } from 'zustand';
import { applyMove, initialMatchState, type GameState, type Move, type Seat } from '@/engine';
import { chooseMove, type Difficulty, type OppModel } from '@/ai/cpu';
import { randomSeed } from '@/util/seed';

/** Fixed local identities. */
export const HUMAN_UID = 'p0-local';
export const CPU_UID = 'cpu';
/** The computer player is a cat: Marmalade, the orange tabby on the app icon. */
export const CPU_NAME = 'Marmalade';
export const CPU_CAT = 'marmalade' as const;

/**
 * CPU pacing, in ms: [shortest, longest] pause before each visible step. Tuned
 * to a quick human player — you can follow which pile it drew from and what it
 * threw away, without waiting on it. A whole turn (draw + discard) lands
 * around 2.5–4.5s. Picking up is quicker than deciding what to let go of, as
 * it is for a person, and the jitter keeps it from feeling metronomic.
 */
const CPU_PACE = {
  /** Take or pass the first upcard. */
  upcard: [1200, 2000],
  /** Reach for the stock or the discard pile. */
  draw: [1100, 1900],
  /** Choose a discard (or knock) with the new card in hand. */
  discard: [1400, 2500],
} as const;

interface SoloStore {
  state: GameState | null;
  /** Always 'p0' once a game exists (the human seat). */
  mySeat: Seat | null;
  difficulty: Difficulty;
  /** Honest, public model of the human, fed to the (Hard) CPU. */
  opp: OppModel;
  /** Kept for prop-parity with the online table; always false (applyMove is sync). */
  pendingMove: boolean;
  error: string | null;
  /** True while the CPU's move is scheduled — drives the "Computer is thinking…" banner. */
  cpuThinking: boolean;

  newGame: (humanName: string, difficulty: Difficulty, target?: number) => void;
  send: (move: Move) => void;
  reset: () => void;
}

const EMPTY_OPP: OppModel = { wanted: [], discarded: [] };

// The CPU driver lives outside React state (mirrors gameStore keeping its Firebase
// subscription handles at module scope).
let cpuTimer: ReturnType<typeof setTimeout> | null = null;

function clearCpuTimer() {
  if (cpuTimer !== null) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
  }
}

function cpuDelay(phase: GameState['phase']): number {
  const [min, max] =
    phase === 'discard' ? CPU_PACE.discard : phase === 'draw' ? CPU_PACE.draw : CPU_PACE.upcard;
  return min + Math.floor(Math.random() * (max - min));
}

function isCpuPlayPhase(s: GameState): boolean {
  return (
    s.turnUid === CPU_UID &&
    (s.phase === 'upcard1' ||
      s.phase === 'upcard2' ||
      s.phase === 'draw' ||
      s.phase === 'discard')
  );
}

/**
 * Update the public opponent model from the human's move, using the PRE-move
 * state so we can read exactly which card they pulled off the pile. Pure.
 */
export function nextOpp(opp: OppModel, prev: GameState, move: Move): OppModel {
  switch (move.kind) {
    case 'takeUpcard':
    case 'drawDiscard': {
      const top = prev.discard.length > 0 ? prev.discard[prev.discard.length - 1] : null;
      if (top === null) return opp;
      return { wanted: [...opp.wanted, top], discarded: opp.discarded };
    }
    case 'discard':
      return { wanted: opp.wanted, discarded: [...opp.discarded, move.card] };
    case 'knock':
      return { wanted: opp.wanted, discarded: [...opp.discarded, move.discard] };
    case 'nextRound':
    case 'rematch':
      return EMPTY_OPP; // new deal — old signal is stale
    default:
      return opp;
  }
}

export const useSoloStore = create<SoloStore>()((set, get) => {
  /**
   * Self-perpetuating, loop-safe CPU driver. Schedules one CPU step; the step
   * re-reads fresh state, applies a legal move, then re-invokes to continue the
   * turn (draw → discard) or stop when the turn flips back or the round ends.
   */
  const driveCpu = () => {
    const s = get().state;
    if (!s || !isCpuPlayPhase(s)) {
      set({ cpuThinking: false });
      return;
    }
    set({ cpuThinking: true });
    clearCpuTimer();
    cpuTimer = setTimeout(() => {
      cpuTimer = null;
      const cur = get().state;
      if (!cur || cur.turnUid !== CPU_UID) {
        set({ cpuThinking: false });
        return; // state changed under us (reset / new game) — bail
      }
      const move = chooseMove(cur, CPU_UID, get().difficulty, get().opp);
      const r = applyMove(cur, move, CPU_UID);
      if (r.ok) {
        set({ state: r.state });
        driveCpu(); // continue or settle
      } else {
        // chooseMove is proven legal by tests; never reschedule on the off chance.
        set({ cpuThinking: false, error: r.error });
      }
    }, cpuDelay(s.phase));
  };

  return {
    state: null,
    mySeat: null,
    difficulty: 'medium',
    opp: EMPTY_OPP,
    pendingMove: false,
    error: null,
    cpuThinking: false,

    newGame: (humanName, difficulty, target) => {
      clearCpuTimer();
      const state = initialMatchState({
        hostUid: HUMAN_UID,
        guestUid: CPU_UID,
        hostName: humanName,
        guestName: CPU_NAME,
        seed: randomSeed(),
        target,
      });
      set({
        state,
        mySeat: 'p0',
        difficulty,
        opp: EMPTY_OPP,
        pendingMove: false,
        error: null,
        cpuThinking: false,
      });
      driveCpu(); // handles rounds where the CPU is non-dealer and opens
    },

    send: (move) => {
      if (get().cpuThinking) return; // ignore taps while the CPU is acting
      const prev = get().state;
      if (!prev) return;
      const r = applyMove(prev, move, HUMAN_UID);
      if (!r.ok) {
        set({ error: r.error });
        return;
      }
      set({ state: r.state, opp: nextOpp(get().opp, prev, move), error: null });
      driveCpu();
    },

    reset: () => {
      clearCpuTimer();
      set({
        state: null,
        mySeat: null,
        opp: EMPTY_OPP,
        pendingMove: false,
        error: null,
        cpuThinking: false,
      });
    },
  };
});
