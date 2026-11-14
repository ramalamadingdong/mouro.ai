/**
 * Monte-Carlo equity: the chance these hole cards win at showdown against
 * `opponents` RANDOM hands, with ties counted as a share.
 *
 * "Random hands" is the cheap assumption — a player who has just bet the pot
 * does not hold a random hand — so decide.ts discounts this number by the
 * pressure being applied rather than trying to model ranges here.
 *
 * Cost: one partial shuffle and (opponents + 1) seven-card evaluations per
 * rollout. 400 rollouts against five opponents measures at a few milliseconds
 * on a laptop; the test suite asserts a generous ceiling.
 */
import { rankHand, type Card } from '@/engine';

export function estimateEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  rollouts: number,
  rng: () => number,
): number {
  if (opponents <= 0) return 1;
  const known = new Set<Card>([...hole, ...board]);
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);

  const missing = 5 - board.length;
  const need = missing + 2 * opponents;
  const mine: Card[] = [hole[0], hole[1], ...board, ...new Array<Card>(missing).fill(0)];
  const theirs: Card[] = [...mine];
  const boardStart = 2;

  let total = 0;
  for (let n = 0; n < rollouts; n++) {
    // Partial Fisher–Yates: only the `need` cards actually dealt get shuffled.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    for (let i = 0; i < missing; i++) {
      const card = deck[i];
      mine[boardStart + board.length + i] = card;
      theirs[boardStart + board.length + i] = card;
    }
    const myScore = rankHand(mine).score;
    let tiedWith = 0;
    let beaten = false;
    for (let o = 0; o < opponents; o++) {
      theirs[0] = deck[missing + 2 * o];
      theirs[1] = deck[missing + 2 * o + 1];
      const score = rankHand(theirs).score;
      if (score > myScore) {
        beaten = true;
        break;
      }
      if (score === myScore) tiedWith++;
    }
    if (!beaten) total += 1 / (tiedWith + 1);
  }
  return total / rollouts;
}
