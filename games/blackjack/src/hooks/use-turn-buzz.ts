/**
 * A short buzz when it becomes this player's turn — to bet, or to play a hand
 * — so a phone left on the table (or in a pocket, online) calls you back.
 *
 * Only on the EDGE into "my turn", never again while it stays mine (hitting,
 * moving to the next split hand), and not when my own tap caused it (dealing
 * the next round puts me straight on turn to bet: I am already looking).
 *
 * Uses the Vibration API, which Android browsers have and iPhone Safari does
 * not: there `navigator.vibrate` is missing and this quietly does nothing.
 * Browsers also ignore it until the page has had a tap, which any player has.
 */
import { useEffect, useRef } from 'react';
import type { GameState } from '@/engine';
import { useSettingsStore } from '@/store/settingsStore';

/** Two short pulses: noticeable, not alarming. */
const PATTERN = [70, 60, 70];

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function useTurnBuzz(state: GameState, mySeat: number | null): void {
  const enabled = useSettingsStore((s) => s.vibrate);
  const myTurn = mySeat !== null && state.toAct === mySeat;
  const wasMyTurn = useRef(myTurn);
  const myUid = mySeat === null ? null : state.players[mySeat]?.uid;
  // Only a deal or rematch I tapped myself. Not `next`: offline the dealer's
  // steps are sent under my uid too, and online my client sends them
  // automatically — neither is me looking at the screen.
  const causedByMe =
    state.lastMove?.by === myUid && (state.lastMove?.kind === 'deal' || state.lastMove?.kind === 'rematch');

  useEffect(() => {
    const rising = myTurn && !wasMyTurn.current;
    wasMyTurn.current = myTurn;
    if (!rising || causedByMe || !enabled || !canVibrate()) return;
    try {
      navigator.vibrate(PATTERN);
    } catch {
      // Blocked (no user gesture yet, or a policy): nothing to do.
    }
  }, [myTurn, causedByMe, enabled]);
}
