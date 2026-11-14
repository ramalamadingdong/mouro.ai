/**
 * Hand display ordering. The game-state hand array is the source of truth and is
 * kept in DRAW ORDER by the engine; this hook produces a *view* of it for the UI
 * without ever mutating the underlying array. Sorting is a per-client display
 * preference only — it is never written back to Firebase.
 */
import { useMemo, useState } from 'react';

import {
  arrangeForDisplay,
  sortByRank,
  sortBySuit,
  type CardId,
  type Meld,
} from '@/engine';

/**
 * How the player's hand is ordered on screen.
 * `off` = draw order (unsorted); `meld` clusters the best meld arrangement.
 */
export type SortMode = 'off' | 'rank' | 'suit' | 'meld';

/** Selectable modes, in the order shown by the toggle. */
export const SORT_MODES = ['off', 'rank', 'suit', 'meld'] as const;

/** Short labels for the sort control, keyed by mode. */
export const SORT_LABELS: Record<SortMode, string> = {
  off: 'Off',
  rank: 'Rank',
  suit: 'Suit',
  meld: 'Meld',
};

/**
 * Return a NEW array of `hand` ordered for display. Never mutates the input; the
 * `off` case still returns a copy so callers can treat the result as owned. The
 * `meld` mode groups the given `melds` contiguously (falls back to rank order
 * when no melds are supplied).
 */
export function orderHand(hand: CardId[], mode: SortMode, melds?: Meld[]): CardId[] {
  switch (mode) {
    case 'rank':
      return sortByRank(hand);
    case 'suit':
      return sortBySuit(hand);
    case 'meld':
      return arrangeForDisplay(hand, melds ?? []);
    case 'off':
    default:
      return hand.slice();
  }
}

/** Manage a hand's display sort mode and expose the ordered view. */
export function useHandSort(hand: CardId[], initial: SortMode = 'off', melds?: Meld[]) {
  const [mode, setMode] = useState<SortMode>(initial);
  const ordered = useMemo(() => orderHand(hand, mode, melds), [hand, mode, melds]);
  return { mode, setMode, ordered };
}
