/**
 * Preflop hand strength via the Chen formula — a pencil-and-paper score that
 * ranks starting hands well enough for tiered play without a lookup table.
 * Roughly: AA = 20, KK = 16, QQ = 14, AKs = 12, JJ = 12, AKo = 10, TT = 10,
 * 76s = 7, 72o = -1.
 */
import { rankOf, suitOf, type Card } from '@/engine';

// Points for the higher card, by rank index (0 = Two … 12 = Ace).
const HIGH_CARD_POINTS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10];

export function chenScore(hole: readonly Card[]): number {
  const hi = Math.max(rankOf(hole[0]), rankOf(hole[1]));
  const lo = Math.min(rankOf(hole[0]), rankOf(hole[1]));
  let score = HIGH_CARD_POINTS[hi];
  if (hi === lo) return Math.max(5, score * 2);

  if (suitOf(hole[0]) === suitOf(hole[1])) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  // Connected low cards make straights both ways: the "straight bonus".
  if (gap <= 1 && hi < 10) score += 1;
  return Math.ceil(score);
}
