/**
 * Runs the dealer and the cats for the offline game.
 *
 * One effect, keyed on the state's version: every state has exactly one
 * "what happens next without the human" — nothing (it is the human's turn, or
 * the showdown is waiting for a tap), a street to deal, or a cat to act — and
 * that one thing is scheduled on a timer from `CPU_PACE`. The timer is
 * cancelled if the state changes or the table unmounts, so nothing can fire
 * into a stale hand, and a page reload simply schedules it afresh from the
 * persisted state.
 *
 * The cat's move is decided BEFORE its timer starts (it takes a few
 * milliseconds), because the length of the pause depends on what it decided:
 * a fold is quick, an all-in takes a long think.
 */
import { useEffect } from 'react';
import { SKILL, catById, decide } from '@/ai';
import { isBettingPhase, legalActions } from '@/engine';
import { CPU_PACE, streetDelay, thinkDelay } from '@/pace';
import { SOLO_UID, useSoloStore } from '@/store/soloStore';

export function useSoloDriver(): void {
  const game = useSoloStore((s) => s.game);
  const skipAhead = useSoloStore((s) => s.skipAhead);
  const version = game?.version;

  useEffect(() => {
    const { game: state, difficulty, send, setThinking } = useSoloStore.getState();
    if (!state || !isBettingPhase(state.phase)) return;
    const speed = skipAhead ? CPU_PACE.skipAhead : 1;

    // Round closed: the dealer turns the next street (or the showdown).
    if (state.toAct === null) {
      const timer = setTimeout(() => send({ kind: 'next', from: state.phase }, SOLO_UID), streetDelay() * speed);
      return () => clearTimeout(timer);
    }

    const seat = state.toAct;
    const player = state.players[seat];
    if (player.isHuman) return;

    const cat = catById(player.uid.slice('cat-'.length));
    const legal = legalActions(state);
    if (!cat || !legal) return;
    // Math.random is fine HERE: this is the app shell. The engine itself
    // takes all of its randomness from seeds inside moves.
    const move = decide(state, seat, cat.personality, SKILL[difficulty], Math.random);
    setThinking(seat);
    const timer = setTimeout(() => send(move, player.uid), thinkDelay(move, legal, player.stack) * speed);
    return () => {
      clearTimeout(timer);
      setThinking(null);
    };
    // `version` identifies the state; `skipAhead` re-times the pending step.
  }, [version, skipAhead]);
}
