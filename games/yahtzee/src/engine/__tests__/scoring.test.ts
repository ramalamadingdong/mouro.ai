import { describe, expect, test } from 'vitest';
import { breakdown, counts, emptyCard, isYahtzee, scoreFor, sum } from '../scoring';
import { RULES, type Category } from '../types';

/** Score with the joker rule off — the normal case. */
const s = (cat: Category, dice: number[]) => scoreFor(cat, dice, false);

describe('helpers', () => {
  test('counts is face-indexed', () => {
    expect(counts([1, 1, 3, 6, 6])).toEqual([0, 2, 0, 1, 0, 0, 2]);
  });

  test('sum and isYahtzee', () => {
    expect(sum([1, 2, 3, 4, 5])).toBe(15);
    expect(isYahtzee([4, 4, 4, 4, 4])).toBe(true);
    expect(isYahtzee([4, 4, 4, 4, 5])).toBe(false);
    // Not a full complement of dice — mid-turn states must not read as a Yahtzee.
    expect(isYahtzee([4, 4, 4])).toBe(false);
    expect(isYahtzee([])).toBe(false);
  });

  test('emptyCard opens every box', () => {
    const card = emptyCard();
    expect(Object.values(card).every((v) => v === null)).toBe(true);
    expect(Object.keys(card)).toHaveLength(RULES.ROUNDS);
  });
});

describe('upper section', () => {
  test('counts only the matching face', () => {
    expect(s('ones', [1, 1, 1, 4, 5])).toBe(3);
    expect(s('fours', [1, 1, 1, 4, 5])).toBe(4);
    expect(s('sixes', [6, 6, 6, 6, 6])).toBe(30);
  });

  test('scores 0 when the face is absent', () => {
    expect(s('twos', [1, 1, 3, 4, 5])).toBe(0);
  });
});

describe('lower section', () => {
  test('three/four of a kind pay the whole roll, not the set', () => {
    expect(s('threeKind', [3, 3, 3, 4, 5])).toBe(18);
    expect(s('fourKind', [3, 3, 3, 4, 5])).toBe(0);
    expect(s('fourKind', [3, 3, 3, 3, 5])).toBe(17);
    // Five of a kind satisfies both naturally — no joker needed.
    expect(s('threeKind', [2, 2, 2, 2, 2])).toBe(10);
    expect(s('fourKind', [2, 2, 2, 2, 2])).toBe(10);
  });

  test('full house needs a distinct triple and pair', () => {
    expect(s('fullHouse', [2, 2, 5, 5, 5])).toBe(RULES.FULL_HOUSE);
    expect(s('fullHouse', [2, 2, 2, 5, 6])).toBe(0);
    // Five of a kind is NOT a natural full house: there is no pair left over.
    expect(s('fullHouse', [4, 4, 4, 4, 4])).toBe(0);
  });

  test('straights need consecutive faces', () => {
    expect(s('smallStraight', [1, 2, 3, 4, 4])).toBe(RULES.SMALL_STRAIGHT);
    expect(s('smallStraight', [3, 4, 5, 6, 6])).toBe(RULES.SMALL_STRAIGHT);
    expect(s('smallStraight', [1, 2, 3, 5, 6])).toBe(0);
    expect(s('largeStraight', [2, 3, 4, 5, 6])).toBe(RULES.LARGE_STRAIGHT);
    expect(s('largeStraight', [1, 2, 3, 4, 4])).toBe(0);
    // A large straight also contains a small one.
    expect(s('smallStraight', [1, 2, 3, 4, 5])).toBe(RULES.SMALL_STRAIGHT);
  });

  test('yahtzee and chance', () => {
    expect(s('yahtzee', [5, 5, 5, 5, 5])).toBe(RULES.YAHTZEE);
    expect(s('yahtzee', [5, 5, 5, 5, 4])).toBe(0);
    expect(s('chance', [1, 2, 3, 4, 5])).toBe(15);
  });
});

describe('joker scoring', () => {
  const dice = [3, 3, 3, 3, 3];

  test('pays the three pattern boxes at face value', () => {
    expect(scoreFor('fullHouse', dice, true)).toBe(RULES.FULL_HOUSE);
    expect(scoreFor('smallStraight', dice, true)).toBe(RULES.SMALL_STRAIGHT);
    expect(scoreFor('largeStraight', dice, true)).toBe(RULES.LARGE_STRAIGHT);
  });

  test('leaves every other box scoring normally', () => {
    expect(scoreFor('threes', dice, true)).toBe(15);
    expect(scoreFor('ones', dice, true)).toBe(0);
    expect(scoreFor('threeKind', dice, true)).toBe(15);
    expect(scoreFor('chance', dice, true)).toBe(15);
    expect(scoreFor('yahtzee', dice, true)).toBe(RULES.YAHTZEE);
  });
});

describe('breakdown', () => {
  test('awards the upper bonus at the threshold, not above it', () => {
    const card = emptyCard();
    // 3+6+9+12+15+18 = 63 — exactly UPPER_BONUS_AT.
    card.ones = 3;
    card.twos = 6;
    card.threes = 9;
    card.fours = 12;
    card.fives = 15;
    card.sixes = 18;
    const b = breakdown(card, 0);
    expect(b.upper).toBe(RULES.UPPER_BONUS_AT);
    expect(b.bonus).toBe(RULES.UPPER_BONUS);
    expect(b.total).toBe(RULES.UPPER_BONUS_AT + RULES.UPPER_BONUS);

    card.sixes = 12; // 57 — one short.
    expect(breakdown(card, 0).bonus).toBe(0);
  });

  test('open boxes count as zero so a running total works mid-game', () => {
    const card = emptyCard();
    card.chance = 20;
    expect(breakdown(card, 0)).toEqual({
      upper: 0,
      bonus: 0,
      lower: 20,
      yahtzeeBonus: 0,
      total: 20,
    });
  });

  test('yahtzee bonuses are counted separately from the box', () => {
    const card = emptyCard();
    card.yahtzee = RULES.YAHTZEE;
    const b = breakdown(card, 2);
    expect(b.yahtzeeBonus).toBe(2 * RULES.YAHTZEE_BONUS);
    expect(b.total).toBe(RULES.YAHTZEE + 2 * RULES.YAHTZEE_BONUS);
  });
});
