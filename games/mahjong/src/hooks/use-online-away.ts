/**
 * One closed phone must not freeze an online game. If a player the table is
 * waiting on — the one on turn, or one still deciding about a discard — has
 * no presence node, the other clients wait out a grace period and then send
 * `away`, which throws their drawn tile or passes for them and marks them as
 * sitting out; once marked, later waits are a couple of seconds instead of
 * the full grace. The player's own next move clears the mark.
 *
 * The cats online belong to the host's uid, so a host who leaves is covered
 * the same way.
 *
 * The rules enforce "presence node absent" for the player on turn; the
 * LENGTH of the grace is this client's good manners (see RULES.md). Clients
 * are staggered by seat so the lowest connected one normally sends it; the
 * version check in the rules refuses the rest.
 */
import { useEffect } from 'react';
import { pendingSeats } from '@/ai';
import { AWAY } from '@/pace';
import { useGameStore } from '@/store/gameStore';

export function useOnlineAway(): void {
  const state = useGameStore((s) => s.state);
  const mySeat = useGameStore((s) => s.mySeat);
  const presence = useGameStore((s) => s.presence);
  const send = useGameStore((s) => s.send);

  const version = state?.version;
  const myUid = state && mySeat !== null ? state.players[mySeat].uid : null;
  const stuck = state
    ? (pendingSeats(state).find((seat) => {
        const uid = state.players[seat].uid;
        return uid !== myUid && !(uid in presence);
      }) ?? null)
    : null;
  const rank =
    state && mySeat !== null ? state.players.filter((p, seat) => seat < mySeat && p.isHuman && p.uid in presence).length : 0;

  useEffect(() => {
    if (!state || mySeat === null || stuck === null) return;
    const grace = state.players[stuck].sitOut ? AWAY.sittingOutMs : AWAY.graceMs;
    const timer = setTimeout(() => void send({ kind: 'away', seat: stuck }, { quiet: true }), grace + rank * AWAY.staggerMs);
    return () => clearTimeout(timer);
    // `version` identifies the state; the other deps re-time the pending step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, mySeat, stuck, rank, send]);
}
