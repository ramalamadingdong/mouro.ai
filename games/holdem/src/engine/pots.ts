/**
 * Side-pot construction and payout. Pure functions of "who put in how much and
 * who folded", kept out of the reducer so they can be tested in isolation —
 * this is the part of poker software that is most often subtly wrong.
 */
import type { Pot } from './types';

export interface Contribution {
  /** Total chips this seat put in over the hand. */
  committed: number;
  folded: boolean;
}

/**
 * Slice the money into a main pot and side pots.
 *
 * Each distinct amount committed by a player STILL IN THE HAND is a cap. The
 * layer between two caps collects that slice from everybody who paid into it
 * (folded players included — their chips stay in), and only the live players
 * who paid the full cap can win it. Folded players never create a cap, which
 * is why two adjacent pots always have different eligible sets.
 *
 * Seats are array indexes; pass `{ committed: 0, folded: true }` for seats not
 * in the hand.
 */
export function buildPots(seats: readonly Contribution[]): Pot[] {
  const caps = [...new Set(seats.filter((s) => !s.folded && s.committed > 0).map((s) => s.committed))].sort(
    (a, b) => a - b,
  );
  const pots: Pot[] = [];
  let floor = 0;
  for (const cap of caps) {
    let amount = 0;
    const eligible: number[] = [];
    seats.forEach((seat, i) => {
      amount += Math.max(0, Math.min(seat.committed, cap) - floor);
      if (!seat.folded && seat.committed >= cap) eligible.push(i);
    });
    if (amount > 0) pots.push({ amount, eligible });
    floor = cap;
  }

  // Chips a folded player put in ABOVE the highest live cap. The reducer's
  // uncalled-bet refund makes this unreachable in real play, but dropping
  // chips silently would be the worst possible failure, so they join the last
  // pot instead.
  const stranded = seats.reduce((sum, seat) => sum + Math.max(0, seat.committed - floor), 0);
  if (stranded > 0 && pots.length > 0) pots[pots.length - 1].amount += stranded;

  return pots;
}

/**
 * Split one pot between its winners. Any chips that do not divide evenly go
 * one each to the winners nearest the button's left (the standard odd-chip
 * rule), so no chip is ever created or destroyed.
 */
export function splitPot(
  amount: number,
  winners: readonly number[],
  button: number,
  seatCount: number,
): { seat: number; amount: number }[] {
  const share = Math.floor(amount / winners.length);
  let odd = amount - share * winners.length;
  // Distance clockwise from the button: 1 for the seat on its left, and
  // `seatCount` (last) for the button itself.
  const distance = (seat: number): number => ((seat - button - 1 + seatCount) % seatCount) + 1;
  const byPosition = [...winners].sort((a, b) => distance(a) - distance(b));
  const extra = new Map<number, number>();
  for (const seat of byPosition) {
    if (odd === 0) break;
    extra.set(seat, 1);
    odd--;
  }
  return winners.map((seat) => ({ seat, amount: share + (extra.get(seat) ?? 0) }));
}
