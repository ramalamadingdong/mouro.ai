/**
 * Runs the cats for the offline game.
 *
 * One effect, keyed on the state's version: if a cat is on turn, its step
 * (play a card, draw, or pass) is decided straight away and sent after a
 * visible pause from `CPU_PACE`. A draw is its own step, so the cat then
 * thinks again about the card it drew. The timer is cancelled if the state
 * changes or the screen unmounts, so nothing fires into a stale game, and a
 * reload simply schedules it afresh.
 */
import { useEffect } from 'react';
import { decide, toMove } from '@/ai';
import { thinkDelay } from '@/pace';
import { useSoloStore } from '@/store/soloStore';
import { randomSeed } from '@/util/seed';

export function useSoloDriver(): void {
  const version = useSoloStore((s) => s.game?.version);

  useEffect(() => {
    const { game: state, difficulty, send, setThinking } = useSoloStore.getState();
    if (!state || state.toAct === null || state.phase !== 'playing') return;
    const seat = state.toAct;
    const player = state.players[seat];
    if (player.isHuman) return;

    // Math.random is fine HERE, in the app shell; the AI takes it as an argument.
    const decision = decide(state, difficulty, Math.random);
    const last = state.lastMove.kind;
    const delay = thinkDelay({
      opening: last === 'start' || last === 'rematch' || last === 'deal',
      drawing: decision.kind === 'draw',
      drew: state.drew,
    });
    setThinking(seat);
    const timer = setTimeout(() => send(toMove(decision, randomSeed()), player.uid), delay);
    return () => {
      clearTimeout(timer);
      setThinking(null);
    };
  }, [version]);
}
