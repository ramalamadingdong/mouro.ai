/**
 * Online rooms have no server-side dealer and no computer players, so two
 * jobs fall to the players' own clients:
 *
 *  1. BEING THE DEALER. When nobody is on turn during a round (the bets are
 *     in, the last hand is finished, the dealer is drawing), `turnUid` is
 *     ANY_PLAYER and somebody must send `next`. Every seated client schedules
 *     it after the same short presentational pause, staggered by seat so the
 *     lowest connected seat normally wins; the reducer refuses the rest,
 *     which is why `next` carries the phase and dealer card count it was sent
 *     from.
 *
 *  2. NOT LETTING ONE CLOSED PHONE FREEZE THE TABLE. If the player on turn
 *     has no presence node, the others wait out a grace period and then send
 *     `away`, which sits them out of the round (while betting) or stands
 *     their hand (while playing) and marks them as sitting out; once marked,
 *     later turns are skipped after a couple of seconds instead of the full
 *     grace. The player's own next action clears the mark. (The rules enforce
 *     "presence node absent at write time"; the LENGTH of the grace is this
 *     client's good manners — see RULES.md.)
 *
 * The round's result is NOT advanced automatically: it stays up until a
 * player taps "Deal next round".
 */
import { useEffect } from 'react';
import { AWAY, dealerDelay } from '@/pace';
import { useGameStore } from '@/store/gameStore';

const DEALER_PHASES = new Set(['betting', 'playing', 'dealer']);

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
    if (!state || mySeat === null || !DEALER_PHASES.has(state.phase)) return;

    if (state.toAct === null) {
      const timer = setTimeout(
        () => void send({ kind: 'next', from: state.phase, dealerCards: state.dealer.length }, { quiet: true }),
        dealerDelay() + rank * AWAY.staggerMs,
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
