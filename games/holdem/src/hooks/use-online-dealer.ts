/**
 * Online rooms have no server-side dealer and no computer players, so two
 * jobs fall to the players' own clients:
 *
 *  1. DEALING THE STREETS. When a betting round closes, `turnUid` becomes
 *     ANY_PLAYER and somebody must send `next`. Every seated client schedules
 *     it after the same short presentational pause, staggered by seat so the
 *     lowest connected seat normally wins; the reducer refuses the rest
 *     ("that street has already been dealt"), which is why `next` carries the
 *     phase it was sent from.
 *
 *  2. NOT LETTING ONE CLOSED PHONE FREEZE THE TABLE. If the player on turn
 *     has no presence node, the others wait out a grace period and then send
 *     `away`, which checks or folds for them and marks them as sitting out;
 *     once marked, later turns are skipped after a couple of seconds instead
 *     of the full grace. The player's own next action clears the mark.
 *     (The rules enforce "presence node absent at write time"; the LENGTH of
 *     the grace is this client's good manners — see RULES.md.)
 *
 * The showdown is NOT advanced automatically: it stays up until a player
 * taps "Deal next hand".
 */
import { useEffect } from 'react';
import { isBettingPhase } from '@/engine';
import { AWAY, streetDelay } from '@/pace';
import { useGameStore } from '@/store/gameStore';

export function useOnlineDealer(): void {
  const state = useGameStore((s) => s.state);
  const mySeat = useGameStore((s) => s.mySeat);
  const presence = useGameStore((s) => s.presence);
  const send = useGameStore((s) => s.send);

  const version = state?.version;
  const turnUid = state?.turnUid;
  // Only the absence of the player ON TURN matters, and only as a boolean:
  // depending on the whole presence map would restart the grace timer every
  // time anyone else's connection blinked.
  const turnPlayerGone = state?.toAct != null && turnUid !== undefined && !(turnUid in presence);
  // My rank among the connected players, by seat: 0 sends first.
  const rank =
    state && mySeat !== null ? state.players.filter((p, seat) => seat < mySeat && p.uid in presence).length : 0;

  useEffect(() => {
    if (!state || mySeat === null || !isBettingPhase(state.phase)) return;

    if (state.toAct === null) {
      const timer = setTimeout(
        () => void send({ kind: 'next', from: state.phase }, { quiet: true }),
        streetDelay() + rank * AWAY.staggerMs,
      );
      return () => clearTimeout(timer);
    }

    if (state.toAct !== mySeat && turnPlayerGone) {
      const grace = state.players[state.toAct].sitOut ? AWAY.sittingOutMs : AWAY.graceMs;
      const timer = setTimeout(() => void send({ kind: 'away' }, { quiet: true }), grace + rank * AWAY.staggerMs);
      return () => clearTimeout(timer);
    }
    // `version` identifies the state; the other deps re-time the pending step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, mySeat, turnPlayerGone, rank, send]);
}
