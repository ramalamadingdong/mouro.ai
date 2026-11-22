/**
 * Plays the cats — offline every cat, online the cats the host's device owns.
 *
 * One effect, keyed on the state's version: if a cat this device controls has
 * something to do (it is on turn, or it is asked about a discard), its move
 * is decided straight away and sent after a visible pause from `CPU_PACE`.
 * Several cats asked about the same discard answer one after another. The
 * timer is cancelled if the state changes or the table unmounts, so nothing
 * fires into a stale game, and a reload simply schedules it afresh.
 */
import { useEffect } from 'react';
import { decide, pendingSeats, type Difficulty } from '@/ai';
import type { GameState, Move } from '@/engine';
import { thinkDelay } from '@/pace';

export interface CatDriver {
  state: GameState | null;
  difficulty: Difficulty;
  /** Whether this device plays for the cat in `seat`. */
  controls: (state: GameState, seat: number) => boolean;
  send: (move: Move, seat: number) => void;
  setThinking: (seat: number | null) => void;
}

export function useCatDriver({ state, difficulty, controls, send, setThinking }: CatDriver): void {
  const version = state?.version;

  useEffect(() => {
    if (!state) return;
    const seat = pendingSeats(state).find((s) => !state.players[s].isHuman && controls(state, s));
    if (seat === undefined) return;
    // Math.random is fine HERE, in the app shell; the AI takes it as an argument.
    const move = decide(state, seat, difficulty, Math.random);
    if (!move) return;
    const opening = state.lastMove.kind === 'start' || state.lastMove.kind === 'next' || state.lastMove.kind === 'rematch';
    const delay = thinkDelay(state.phase === 'claim' ? 'claim' : opening ? 'opening' : 'turn');
    setThinking(seat);
    const timer = setTimeout(() => send(move, seat), delay);
    return () => {
      clearTimeout(timer);
      setThinking(null);
    };
    // `version` identifies the state; the callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, difficulty]);
}
