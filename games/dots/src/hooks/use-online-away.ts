/**
 * One closed phone must not freeze an online game. If the player on turn has
 * no presence node, the other clients wait out a grace period and then send
 * `away`, which draws a sensible line for them and marks them as sitting out;
 * once marked, later turns are taken after a couple of seconds instead of the
 * full grace. The player's own next line clears the mark.
 *
 * The rules enforce "presence node absent at write time"; the LENGTH of the
 * grace is this client's good manners (see RULES.md). Clients are staggered
 * by seat so the lowest connected one normally sends it; the version check in
 * the rules refuses the rest.
 */
import { useEffect } from 'react';
import { AWAY } from '@/pace';
import { useGameStore } from '@/store/gameStore';

export function useOnlineAway(): void {
  const state = useGameStore((s) => s.state);
  const mySeat = useGameStore((s) => s.mySeat);
  const presence = useGameStore((s) => s.presence);
  const send = useGameStore((s) => s.send);

  const version = state?.version;
  const turnUid = state?.turnUid;
  // Only the absence of the player ON TURN matters, as a boolean, so other
  // players' connections blinking do not restart the timer.
  const turnPlayerGone = state?.toAct != null && turnUid !== undefined && !(turnUid in presence);
  const rank =
    state && mySeat !== null ? state.players.filter((p, seat) => seat < mySeat && p.uid in presence).length : 0;

  useEffect(() => {
    if (!state || mySeat === null || state.toAct === null) return;
    if (state.toAct === mySeat || !turnPlayerGone) return;
    const grace = state.players[state.toAct].sitOut ? AWAY.sittingOutMs : AWAY.graceMs;
    const timer = setTimeout(() => void send({ kind: 'away' }, { quiet: true }), grace + rank * AWAY.staggerMs);
    return () => clearTimeout(timer);
    // `version` identifies the state; the other deps re-time the pending step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, mySeat, turnPlayerGone, rank, send]);
}
