import {
  arrangeForDisplay,
  bestArrangement,
  cardId,
  rankOf,
  sortByRank,
  sortBySuit,
  suitOf,
} from '@/engine';

import { applyCustomOrder, moveCard, orderHand } from '../use-hand-sort';

// An intentionally unsorted 10-card hand (mixed suits and ranks).
const HAND = [
  cardId(3, 12), // K♠
  cardId(2, 2), //  3♥
  cardId(0, 0), //  A♣
  cardId(1, 6), //  7♦
  cardId(0, 2), //  3♣
  cardId(3, 9), //  10♠
  cardId(1, 2), //  3♦
  cardId(2, 4), //  5♥
  cardId(0, 7), //  8♣
  cardId(2, 0), //  A♥
];

describe('orderHand', () => {
  test('off returns a copy in draw order', () => {
    const result = orderHand(HAND, 'off');
    expect(result).toEqual(HAND);
    expect(result).not.toBe(HAND); // fresh array, safe to hold
  });

  test('rank matches sortByRank (rank, then suit)', () => {
    const result = orderHand(HAND, 'rank');
    expect(result).toEqual(sortByRank(HAND));
    for (let i = 1; i < result.length; i++) {
      expect(rankOf(result[i])).toBeGreaterThanOrEqual(rankOf(result[i - 1]));
    }
  });

  test('suit matches sortBySuit (suit, then rank)', () => {
    const result = orderHand(HAND, 'suit');
    expect(result).toEqual(sortBySuit(HAND));
    for (let i = 1; i < result.length; i++) {
      expect(suitOf(result[i])).toBeGreaterThanOrEqual(suitOf(result[i - 1]));
    }
  });

  test('meld delegates to arrangeForDisplay and preserves the multiset', () => {
    const melds = bestArrangement(HAND).melds;
    const result = orderHand(HAND, 'meld', melds);
    expect(result).toEqual(arrangeForDisplay(HAND, melds));
    expect([...result].sort((a, b) => a - b)).toEqual(
      [...HAND].sort((a, b) => a - b),
    );
  });

  test('meld with no melds falls back to rank order', () => {
    expect(orderHand(HAND, 'meld', [])).toEqual(sortByRank(HAND));
    expect(orderHand(HAND, 'meld')).toEqual(sortByRank(HAND));
  });

  test('never mutates the input hand', () => {
    const snapshot = HAND.slice();
    orderHand(HAND, 'rank');
    orderHand(HAND, 'suit');
    orderHand(HAND, 'off');
    orderHand(HAND, 'meld', bestArrangement(HAND).melds);
    expect(HAND).toEqual(snapshot);
  });

  test('preserves the exact multiset of cards', () => {
    for (const mode of ['off', 'rank', 'suit', 'meld', 'custom'] as const) {
      const result = orderHand(HAND, mode);
      expect([...result].sort((a, b) => a - b)).toEqual(
        [...HAND].sort((a, b) => a - b),
      );
    }
  });
});

describe('custom order', () => {
  test('moveCard moves one card and keeps the rest in order', () => {
    expect(moveCard([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveCard([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveCard([1, 2, 3, 4], 1, 99)).toEqual([1, 3, 4, 2]);
  });

  test('follows the saved order and puts new cards on the end', () => {
    const saved = [...HAND].reverse();
    const hand = [...HAND.slice(1), cardId(3, 0)]; // K♠ discarded, A♠ drawn
    expect(orderHand(hand, 'custom', [], saved)).toEqual([
      ...saved.filter((c) => c !== HAND[0]),
      cardId(3, 0),
    ]);
  });

  test('ignores an order left over from an earlier deal', () => {
    const stale = [cardId(3, 12), cardId(1, 1), cardId(1, 3), cardId(1, 4)];
    expect(applyCustomOrder(HAND, stale)).toEqual(HAND);
  });

  test('with no saved order it is draw order', () => {
    expect(orderHand(HAND, 'custom')).toEqual(HAND);
  });
});
