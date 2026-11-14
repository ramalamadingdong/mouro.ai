/**
 * Pure category scoring. Given five dice, what is each box worth?
 *
 * Split out from the reducer because it is the part a UI wants to call
 * speculatively ("what would this roll score in each open box?") without
 * touching game state.
 */

import {
  CATEGORIES,
  LOWER_CATEGORIES,
  RULES,
  UPPER_CATEGORIES,
  type Category,
  type ScoreBreakdown,
  type ScoreCard,
} from './types';

const LOWER_SET: ReadonlySet<string> = new Set(LOWER_CATEGORIES);

/** True for the seven lower-section boxes. */
export function isLower(cat: Category): boolean {
  return LOWER_SET.has(cat);
}

/**
 * Face counts, indexed by face: `counts(dice)[3]` is how many 3s were rolled.
 * Index 0 is always 0 and exists only so the array is face-indexable.
 */
export function counts(dice: number[]): number[] {
  const c = new Array<number>(RULES.FACES + 1).fill(0);
  for (const d of dice) {
    if (d >= 1 && d <= RULES.FACES) c[d]++;
  }
  return c;
}

/** Sum of all dice. */
export function sum(dice: number[]): number {
  let t = 0;
  for (const d of dice) t += d;
  return t;
}

/** True when all dice show the same face (and there is a full complement). */
export function isYahtzee(dice: number[]): boolean {
  if (dice.length !== RULES.DICE) return false;
  return dice.every((d) => d === dice[0]);
}

/** Length of the longest run of consecutive faces present. */
function longestRun(dice: number[]): number {
  const c = counts(dice);
  let best = 0;
  let run = 0;
  for (let face = 1; face <= RULES.FACES; face++) {
    if (c[face] > 0) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** An empty scorecard — every box open. */
export function emptyCard(): ScoreCard {
  const card = {} as ScoreCard;
  for (const cat of CATEGORIES) card[cat] = null;
  return card;
}

/**
 * What `category` is worth for `dice`.
 *
 * `joker` must be true when the joker rule applies — i.e. the dice are a
 * Yahtzee AND the Yahtzee box is already resolved. Under the joker rule the
 * three pattern categories pay their face value even though five-of-a-kind does
 * not literally satisfy them (a Yahtzee has no pair, so a natural full house
 * would score 0). Everything else scores exactly as normal, because
 * five-of-a-kind already satisfies three/four-of-a-kind and the upper boxes.
 */
export function scoreFor(category: Category, dice: number[], joker: boolean): number {
  const c = counts(dice);

  switch (category) {
    case 'ones':
    case 'twos':
    case 'threes':
    case 'fours':
    case 'fives':
    case 'sixes': {
      const face = UPPER_CATEGORIES.indexOf(category) + 1;
      return face * c[face];
    }
    case 'threeKind':
      return c.some((n) => n >= 3) ? sum(dice) : 0;
    case 'fourKind':
      return c.some((n) => n >= 4) ? sum(dice) : 0;
    case 'fullHouse':
      if (joker) return RULES.FULL_HOUSE;
      // A natural full house needs a distinct triple and pair. Five-of-a-kind
      // has neither a 2-count nor two distinct faces, so it scores 0 here —
      // only the joker rule above pays it out.
      return c.some((n) => n === 3) && c.some((n) => n === 2) ? RULES.FULL_HOUSE : 0;
    case 'smallStraight':
      if (joker) return RULES.SMALL_STRAIGHT;
      return longestRun(dice) >= 4 ? RULES.SMALL_STRAIGHT : 0;
    case 'largeStraight':
      if (joker) return RULES.LARGE_STRAIGHT;
      return longestRun(dice) >= 5 ? RULES.LARGE_STRAIGHT : 0;
    case 'yahtzee':
      return isYahtzee(dice) ? RULES.YAHTZEE : 0;
    case 'chance':
      return sum(dice);
  }
}

/**
 * Totals for a card. Works on a partially-filled card (open boxes count as 0),
 * so the UI can show a running total mid-game.
 */
export function breakdown(card: ScoreCard, yahtzeeBonusCount: number): ScoreBreakdown {
  let upper = 0;
  for (const cat of UPPER_CATEGORIES) upper += card[cat] ?? 0;
  let lower = 0;
  for (const cat of LOWER_CATEGORIES) lower += card[cat] ?? 0;

  const bonus = upper >= RULES.UPPER_BONUS_AT ? RULES.UPPER_BONUS : 0;
  const yahtzeeBonus = yahtzeeBonusCount * RULES.YAHTZEE_BONUS;
  return { upper, bonus, lower, yahtzeeBonus, total: upper + bonus + lower + yahtzeeBonus };
}
