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
 * `off` = draw order (unsorted); `meld` clusters the best meld arrangement;
 * `custom` is the order the player dragged the cards into.
 */
export type SortMode = 'off' | 'rank' | 'suit' | 'meld' | 'custom';

/** Selectable modes, in the order shown by the toggle. */
export const SORT_MODES = ['off', 'rank', 'suit', 'meld', 'custom'] as const;

/** Short labels for the sort control, keyed by mode. */
export const SORT_LABELS: Record<SortMode, string> = {
  off: 'Off',
  rank: 'Rank',
  suit: 'Suit',
  meld: 'Meld',
  custom: 'Custom',
};

/**
 * Return a NEW array of `hand` ordered for display. Never mutates the input; the
 * `off` case still returns a copy so callers can treat the result as owned. The
 * `meld` mode groups the given `melds` contiguously (falls back to rank order
 * when no melds are supplied).
 */
export function orderHand(
  hand: CardId[],
  mode: SortMode,
  melds?: Meld[],
  customOrder?: readonly CardId[],
): CardId[] {
  switch (mode) {
    case 'custom':
      return applyCustomOrder(hand, customOrder ?? []);
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

/**
 * Lay `hand` out in the player's dragged order. Cards the saved order doesn't
 * know (a card just picked up) go on the end, in draw order.
 *
 * A saved order that shares fewer than half its cards with the hand belongs
 * to an earlier deal, so it's ignored and the new hand starts in draw order.
 * Within a round only one card changes per turn, so a live order always passes.
 */
export function applyCustomOrder(hand: CardId[], saved: readonly CardId[]): CardId[] {
  const inHand = new Set(hand);
  const kept = saved.filter((c) => inHand.has(c));
  if (kept.length * 2 < hand.length) return hand.slice();
  const placed = new Set(kept);
  return [...kept, ...hand.filter((c) => !placed.has(c))];
}

/** Move the card at `from` to `to`, returning a new array. */
export function moveCard(order: readonly CardId[], from: number, to: number): CardId[] {
  const next = order.slice();
  const [card] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, card);
  return next;
}

/** Manage a hand's display sort mode and expose the ordered view. */
export function useHandSort(hand: CardId[], initial: SortMode = 'off', melds?: Meld[]) {
  const [mode, setMode] = useState<SortMode>(initial);
  const ordered = useMemo(() => orderHand(hand, mode, melds), [hand, mode, melds]);
  return { mode, setMode, ordered };
}
