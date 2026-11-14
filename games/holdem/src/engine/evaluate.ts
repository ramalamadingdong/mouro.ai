/**
 * Hand evaluation: best five of up to seven cards.
 *
 * Two entry points on one core so they cannot disagree:
 *   - `rankHand`  — category + tiebreak ranks + a single comparable `score`.
 *                   Allocation-light; this is what the equity rollouts call.
 *   - `evaluate`  — the same, plus the actual five cards and a spoken name,
 *                   for the showdown and the "your hand" readout.
 *
 * It accepts FEWER than five cards on purpose (the readout shows "Pair of
 * Kings" preflop and on the flop). Scores are only comparable between hands
 * of at least five cards.
 */
import { rankOf, suitOf } from './cards';
import type { Card, ShownHand } from './types';

export const CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

export const CAT = {
  HIGH: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export interface RankedHand {
  category: number;
  /** Ranks (0 = Two … 12 = Ace) that break ties inside the category, most significant first. */
  tiebreak: number[];
  /** category and tiebreaks packed base-13: higher is better, equal is a tie. */
  score: number;
  /** Suit of the flush for Flush / Straight Flush, else -1. */
  flushSuit: number;
}

// Scratch buffers, reused across calls. Safe because evaluation is synchronous
// and never re-entrant; it saves two allocations per rollout hand.
const rankCount = new Int8Array(13);
const suitCount = new Int8Array(4);
const suitMask = new Int32Array(4);

const WHEEL = 0b1000000001111; // A-2-3-4-5

/** Top rank of the best straight in a rank bitmask, or -1. The wheel's top is the Five (3). */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const run = 0b11111 << (top - 4);
    if ((mask & run) === run) return top;
  }
  return (mask & WHEEL) === WHEEL ? 3 : -1;
}

function pack(category: number, tiebreak: number[], flushSuit: number): RankedHand {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 13 + (tiebreak[i] ?? 0);
  return { category, tiebreak, score, flushSuit };
}

/** Highest `n` ranks present, skipping up to two excluded ranks. */
function kickers(n: number, skipA: number, skipB: number, into: number[]): number[] {
  for (let r = 12; r >= 0 && n > 0; r--) {
    if (rankCount[r] > 0 && r !== skipA && r !== skipB) {
      into.push(r);
      n--;
    }
  }
  return into;
}

export function rankHand(cards: readonly Card[]): RankedHand {
  rankCount.fill(0);
  suitCount.fill(0);
  suitMask.fill(0);
  let mask = 0;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i] >> 2;
    const s = cards[i] & 3;
    rankCount[r]++;
    suitCount[s]++;
    suitMask[s] |= 1 << r;
    mask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    const top = straightTop(suitMask[flushSuit]);
    if (top >= 0) return pack(CAT.STRAIGHT_FLUSH, [top], flushSuit);
  }

  // Highest rank of each multiplicity. With seven cards there can be two sets
  // of trips or three pairs; only the best two groups ever matter.
  let quad = -1;
  let tripA = -1;
  let tripB = -1;
  let pairA = -1;
  let pairB = -1;
  for (let r = 12; r >= 0; r--) {
    const n = rankCount[r];
    if (n === 4) {
      if (quad < 0) quad = r;
    } else if (n === 3) {
      if (tripA < 0) tripA = r;
      else if (tripB < 0) tripB = r;
    } else if (n === 2) {
      if (pairA < 0) pairA = r;
      else if (pairB < 0) pairB = r;
    }
  }

  if (quad >= 0) return pack(CAT.QUADS, kickers(1, quad, -1, [quad]), -1);

  if (tripA >= 0 && (tripB >= 0 || pairA >= 0)) {
    // Second trips play as the pair when they outrank the best real pair.
    return pack(CAT.FULL_HOUSE, [tripA, Math.max(tripB, pairA)], -1);
  }

  if (flushSuit >= 0) {
    const top: number[] = [];
    for (let r = 12; r >= 0 && top.length < 5; r--) {
      if (suitMask[flushSuit] & (1 << r)) top.push(r);
    }
    return pack(CAT.FLUSH, top, flushSuit);
  }

  const top = straightTop(mask);
  if (top >= 0) return pack(CAT.STRAIGHT, [top], -1);

  if (tripA >= 0) return pack(CAT.TRIPS, kickers(2, tripA, -1, [tripA]), -1);
  if (pairB >= 0) return pack(CAT.TWO_PAIR, kickers(1, pairA, pairB, [pairA, pairB]), -1);
  if (pairA >= 0) return pack(CAT.PAIR, kickers(3, pairA, -1, [pairA]), -1);
  return pack(CAT.HIGH, kickers(5, -1, -1, []), -1);
}

const RANK_NAMES = [
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
] as const;

const plural = (rank: number): string => RANK_NAMES[rank] + (rank === 4 ? 'es' : 's');

/** "Pair of Kings", "Full House, Tens full of Fours", "Ace high". */
export function describeHand(hand: RankedHand): string {
  const t = hand.tiebreak;
  switch (hand.category) {
    case CAT.STRAIGHT_FLUSH:
      return t[0] === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[t[0]]} high`;
    case CAT.QUADS:
      return `Four of a Kind, ${plural(t[0])}`;
    case CAT.FULL_HOUSE:
      return `Full House, ${plural(t[0])} full of ${plural(t[1])}`;
    case CAT.FLUSH:
      return `Flush, ${RANK_NAMES[t[0]]} high`;
    case CAT.STRAIGHT:
      return `Straight, ${RANK_NAMES[t[0]]} high`;
    case CAT.TRIPS:
      return `Three of a Kind, ${plural(t[0])}`;
    case CAT.TWO_PAIR:
      return `Two Pair, ${plural(t[0])} and ${plural(t[1])}`;
    case CAT.PAIR:
      return `Pair of ${plural(t[0])}`;
    default:
      return `${RANK_NAMES[t[0]]} high`;
  }
}

/** How many cards of each tiebreak rank make up the hand, per category. */
const GROUP_SIZES: Record<number, number[]> = {
  [CAT.QUADS]: [4, 1],
  [CAT.FULL_HOUSE]: [3, 2],
  [CAT.TRIPS]: [3, 1, 1],
  [CAT.TWO_PAIR]: [2, 2, 1],
  [CAT.PAIR]: [2, 1, 1, 1],
  [CAT.HIGH]: [1, 1, 1, 1, 1],
};

/** The actual cards behind a ranked hand, strongest first. */
function pickBest5(cards: readonly Card[], hand: RankedHand): Card[] {
  const out: Card[] = [];
  const take = (rank: number, count: number, suit: number): void => {
    for (const card of cards) {
      if (count === 0) return;
      if (rankOf(card) === rank && (suit < 0 || suitOf(card) === suit) && !out.includes(card)) {
        out.push(card);
        count--;
      }
    }
  };

  if (hand.category === CAT.STRAIGHT || hand.category === CAT.STRAIGHT_FLUSH) {
    const top = hand.tiebreak[0];
    // The wheel runs 5-4-3-2-A: rank -1 below the Two wraps to the Ace.
    for (let i = 0; i < 5; i++) take(top - i < 0 ? 12 : top - i, 1, hand.flushSuit);
  } else if (hand.category === CAT.FLUSH) {
    for (const rank of hand.tiebreak) take(rank, 1, hand.flushSuit);
  } else {
    const sizes = GROUP_SIZES[hand.category];
    hand.tiebreak.forEach((rank, i) => take(rank, sizes[i], -1));
  }
  return out;
}

export function evaluate(cards: readonly Card[]): ShownHand {
  const hand = rankHand(cards);
  return {
    category: hand.category,
    name: describeHand(hand),
    score: hand.score,
    best5: pickBest5(cards, hand),
  };
}
