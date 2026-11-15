/**
 * Runs the cats for the offline game.
 *
 * One effect, keyed on the state's version: if a cat is on turn, its line is
 * decided straight away and sent after a visible pause from `CPU_PACE`. The
 * timer is cancelled if the state changes or the board unmounts, so nothing
 * fires into a stale game, and a reload simply schedules it afresh.
 */
import { useEffect } from 'react';
import { decide } from '@/ai';
import { thinkDelay } from '@/pace';
import { useSoloStore } from '@/store/soloStore';

export function useSoloDriver(): void {
  const version = useSoloStore((s) => s.game?.version);

  useEffect(() => {
    const { game: state, difficulty, send, setThinking } = useSoloStore.getState();
    if (!state || state.toAct === null) return;
    const seat = state.toAct;
    const player = state.players[seat];
    if (player.isHuman) return;

    // Math.random is fine HERE, in the app shell; the AI takes it as an argument.
    const edge = decide(state, difficulty, Math.random);
    const last = state.lastMove;
    const delay = thinkDelay({
      opening: last.kind === 'start' || last.kind === 'rematch',
      chain: last.seat === seat && last.closed > 0,
    });
    setThinking(seat);
    const timer = setTimeout(() => send({ kind: 'line', edge }, player.uid), delay);
    return () => {
      clearTimeout(timer);
      setThinking(null);
    };
  }, [version]);
}
