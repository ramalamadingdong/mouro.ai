import {
  SUIT_SYMBOLS,
  RANK_LABELS,
  suitOf,
  rankOf,
  pipValue,
  isRed,
  cardToString,
  cardToAscii,
  makeDeck,
  sortByRank,
  sortBySuit,
} from '../cards';

const C = (suit: number, rank: number): number => suit * 13 + rank;

describe('cards', () => {
  test('SUIT_SYMBOLS / RANK_LABELS order', () => {
    expect(SUIT_SYMBOLS).toEqual(['♣', '♦', '♥', '♠']);
    expect(RANK_LABELS).toEqual([
      'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
    ]);
  });

  test('suitOf / rankOf decode every card', () => {
    for (let c = 0; c < 52; c++) {
      expect(suitOf(c)).toBe(Math.floor(c / 13));
      expect(rankOf(c)).toBe(c % 13);
    }
  });

  test('pip values: A=1, 2..9 face, 10/J/Q/K=10', () => {
    expect(pipValue(C(0, 0))).toBe(1); // A
    expect(pipValue(C(0, 1))).toBe(2); // 2
    expect(pipValue(C(0, 8))).toBe(9); // 9
    expect(pipValue(C(0, 9))).toBe(10); // 10
    expect(pipValue(C(0, 10))).toBe(10); // J
    expect(pipValue(C(0, 11))).toBe(10); // Q
    expect(pipValue(C(0, 12))).toBe(10); // K
  });

  test('isRed: diamonds and hearts only', () => {
    expect(isRed(C(0, 5))).toBe(false); // clubs
    expect(isRed(C(1, 5))).toBe(true); // diamonds
    expect(isRed(C(2, 5))).toBe(true); // hearts
    expect(isRed(C(3, 5))).toBe(false); // spades
  });

  test('cardToString / cardToAscii', () => {
    expect(cardToString(C(3, 0))).toBe('A♠');
    expect(cardToString(C(2, 9))).toBe('10♥');
    expect(cardToString(C(0, 12))).toBe('K♣');
    expect(cardToAscii(C(3, 0))).toBe('AS');
    expect(cardToAscii(C(2, 9))).toBe('TH');
    expect(cardToAscii(C(0, 12))).toBe('KC');
  });

  test('makeDeck is 0..51', () => {
    const d = makeDeck();
    expect(d).toHaveLength(52);
    expect(d).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  test('sortByRank returns a new sorted array', () => {
    const hand = [C(3, 5), C(0, 0), C(2, 5), C(1, 0)];
    const sorted = sortByRank(hand);
    expect(sorted).not.toBe(hand);
    // ranks non-decreasing
    for (let i = 1; i < sorted.length; i++) {
      expect(rankOf(sorted[i])).toBeGreaterThanOrEqual(rankOf(sorted[i - 1]));
    }
    // aces (rank 0) come first
    expect(rankOf(sorted[0])).toBe(0);
  });

  test('sortBySuit returns a new sorted array by suit then rank', () => {
    const hand = [C(3, 5), C(0, 12), C(1, 0), C(0, 0)];
    const sorted = sortBySuit(hand);
    expect(sorted).not.toBe(hand);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      expect(
        suitOf(a) < suitOf(b) || (suitOf(a) === suitOf(b) && rankOf(a) <= rankOf(b)),
      ).toBe(true);
    }
  });
});
