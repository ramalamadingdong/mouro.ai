/**
 * Runs the cats for the offline game.
 *
 * One effect, keyed on the state's version: if a cat is on turn, its point is
 * decided straight away and sent after a visible pause from `CPU_PACE`. The
 * timer is cancelled if the state changes or the board unmounts, so nothing
 * fires into a stale game, and a reload simply schedules it afresh.
 */
import { useEffect } from 'react';
import { decide } from '@/ai';
import { candidates, need, wins } from '@/engine';
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
    const cell = decide(state, difficulty, Math.random);
    const last = state.lastMove;
    const size = state.config.size;
    // Someone is one paw from a line: the cat moves a little quicker.
    const urgent = candidates(state.cells, size).some((c) =>
      state.players.some((_, s) => wins(state.cells, size, c, String(s), need(state))),
    );
    const delay = thinkDelay({ opening: last.kind === 'start' || last.kind === 'rematch', urgent });
    setThinking(seat);
    const timer = setTimeout(() => send({ kind: 'paw', cell }, player.uid), delay);
    return () => {
      clearTimeout(timer);
      setThinking(null);
    };
  }, [version]);
}
