import { bestLayoff } from '../layoffs';
import { pipValue } from '../cards';
import type { CardId, Meld } from '../types';

const C = (suit: number, rank: number): CardId => suit * 13 + rank;

describe('bestLayoff', () => {
  test('chains 7♠ then 8♠ onto a 4-5-6♠ run', () => {
    const knockerMelds: Meld[] = [[C(3, 3), C(3, 4), C(3, 5)]]; // 4-5-6 spades
    const defenderHand = [
      C(3, 6), C(3, 7), // 7♠ 8♠ (lay off, chained)
      C(2, 1), C(2, 2), C(2, 3), // 2-3-4 hearts (own run)
      C(0, 8), C(1, 8), C(2, 8), // three 9s (own set)
      C(1, 12), C(0, 11), // K♦ Q♣ leftover
    ];
    const res = bestLayoff(defenderHand, knockerMelds);
    const laidCards = res.layoffs.map((l) => l.card).sort((a, b) => a - b);
    expect(laidCards).toEqual([C(3, 6), C(3, 7)]);
    expect(res.layoffs.every((l) => l.meldIndex === 0)).toBe(true);
    // remaining deadwood = K + Q = 20
    expect(res.deadwoodValue).toBe(20);
    expect(res.deadwood.reduce((a, c) => a + pipValue(c), 0)).toBe(20);
  });

  test('lays a 4th card onto a set', () => {
    const knockerMelds: Meld[] = [[C(0, 5), C(1, 5), C(2, 5)]]; // three 6s
    const defenderHand = [
      C(3, 5), // 6♠ -> 4th of the set
      C(2, 1), C(2, 2), C(2, 3), // 2-3-4 hearts own run
      C(0, 8), C(1, 8), C(2, 8), // three 9s own set
      C(3, 12), C(3, 11), C(3, 10), // K-Q-J spades own run
    ];
    const res = bestLayoff(defenderHand, knockerMelds);
    expect(res.layoffs).toEqual([{ card: C(3, 5), meldIndex: 0 }]);
    expect(res.deadwoodValue).toBe(0);
  });

  test('extends a run downward (ace low, no wrap below A)', () => {
    const knockerMelds: Meld[] = [[C(1, 1), C(1, 2), C(1, 3)]]; // 2-3-4 diamonds
    const defenderHand = [
      C(1, 0), // A♦ -> lay off below the 2
      C(2, 10), C(2, 11), C(2, 12), // J-Q-K hearts own run
      C(0, 6), C(1, 6), C(2, 6), // three 7s own set
      C(3, 9), // 10♠ leftover
    ];
    const res = bestLayoff(defenderHand, knockerMelds);
    expect(res.layoffs).toEqual([{ card: C(1, 0), meldIndex: 0 }]);
    expect(res.deadwoodValue).toBe(10); // the leftover 10♠
  });

  test('no layoff available leaves deadwood untouched', () => {
    const knockerMelds: Meld[] = [[C(3, 3), C(3, 4), C(3, 5)]]; // 4-5-6 spades
    const defenderHand = [
      C(2, 10), C(2, 11), C(2, 12), // J-Q-K hearts run
      C(0, 6), C(1, 6), C(2, 6), // three 7s
      C(1, 0), C(0, 9), C(3, 12), C(1, 8), // A♦ 10♣ K♠ 9♦ deadwood, none connect
    ];
    const res = bestLayoff(defenderHand, knockerMelds);
    expect(res.layoffs).toEqual([]);
    // deadwood = 1 + 10 + 10 + 9 = 30
    expect(res.deadwoodValue).toBe(30);
  });
});
