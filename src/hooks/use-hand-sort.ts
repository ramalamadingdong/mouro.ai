/**
 * Hand display ordering. The game-state hand array is the source of truth and is
 * kept in DRAW ORDER by the engine; this hook produces a *view* of it for the UI
 * without ever mutating the underlying array. Sorting is a per-client display
 * preference only — it is never written back to Firebase.
 */
import { useMemo, useState } from 'react';

import { sortByRank, sortBySuit, type CardId } from '@/engine';

/** How the player's hand is ordered on screen. `off` = draw order (unsorted). */
export type SortMode = 'off' | 'rank' | 'suit';

/** Selectable modes, in the order shown by the toggle. */
export const SORT_MODES = ['off', 'rank', 'suit'] as const;

/** Short labels for the sort control, keyed by mode. */
export const SORT_LABELS: Record<SortMode, string> = {
  off: 'Off',
  rank: 'Rank',
  suit: 'Suit',
};

/**
 * Return a NEW array of `hand` ordered for display. Never mutates the input; the
 * `off` case still returns a copy so callers can treat the result as owned.
 */
export function orderHand(hand: CardId[], mode: SortMode): CardId[] {
  switch (mode) {
    case 'rank':
      return sortByRank(hand);
    case 'suit':
      return sortBySuit(hand);
    case 'off':
    default:
      return hand.slice();
  }
}

/** Manage a hand's display sort mode and expose the ordered view. */
export function useHandSort(hand: CardId[], initial: SortMode = 'off') {
  const [mode, setMode] = useState<SortMode>(initial);
  const ordered = useMemo(() => orderHand(hand, mode), [hand, mode]);
  return { mode, setMode, ordered };
}
