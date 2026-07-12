import { cardId, rankOf, sortByRank, sortBySuit, suitOf } from '@/engine';

import { orderHand } from '../use-hand-sort';

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

  test('never mutates the input hand', () => {
    const snapshot = HAND.slice();
    orderHand(HAND, 'rank');
    orderHand(HAND, 'suit');
    orderHand(HAND, 'off');
    expect(HAND).toEqual(snapshot);
  });

  test('preserves the exact multiset of cards', () => {
    for (const mode of ['off', 'rank', 'suit'] as const) {
      const result = orderHand(HAND, mode);
      expect([...result].sort((a, b) => a - b)).toEqual(
        [...HAND].sort((a, b) => a - b),
      );
    }
  });
});
