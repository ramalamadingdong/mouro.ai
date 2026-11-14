import { describe, expect, it } from 'vitest';
import { buildPots, splitPot } from '@/engine';

const live = (committed: number) => ({ committed, folded: false });
const dead = (committed: number) => ({ committed, folded: true });

describe('buildPots', () => {
  it('one pot when everyone put in the same', () => {
    expect(buildPots([live(100), live(100), live(100)])).toEqual([{ amount: 300, eligible: [0, 1, 2] }]);
  });

  it('one short all-in makes a main pot and a side pot', () => {
    // Seat 0 is all-in for 50; seats 1 and 2 played on for 200 each.
    expect(buildPots([live(50), live(200), live(200)])).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ]);
  });

  it('three all-ins of different sizes stack three pots', () => {
    expect(buildPots([live(30), live(80), live(200), live(200)])).toEqual([
      { amount: 120, eligible: [0, 1, 2, 3] },
      { amount: 150, eligible: [1, 2, 3] },
      { amount: 240, eligible: [2, 3] },
    ]);
  });

  it('folded chips stay in but folded players win nothing and make no pot', () => {
    // Seat 1 folded after putting in 120 — more than the short all-in.
    expect(buildPots([live(50), dead(120), live(300), live(300)])).toEqual([
      { amount: 200, eligible: [0, 2, 3] },
      { amount: 570, eligible: [2, 3] },
    ]);
  });

  it('seats not in the hand are ignored', () => {
    expect(buildPots([live(40), dead(0), live(40)])).toEqual([{ amount: 80, eligible: [0, 2] }]);
  });

  it('never loses a chip', () => {
    const cases = [
      [live(30), live(80), dead(55), live(200), dead(10), live(200)],
      [dead(500), live(20), live(20)],
      [live(1), live(2), live(3), live(4), live(5), live(6)],
    ];
    for (const seats of cases) {
      const total = seats.reduce((sum, s) => sum + s.committed, 0);
      expect(buildPots(seats).reduce((sum, p) => sum + p.amount, 0)).toBe(total);
    }
  });
});

describe('splitPot', () => {
  it('divides evenly when it can', () => {
    expect(splitPot(300, [1, 4], 0, 6)).toEqual([
      { seat: 1, amount: 150 },
      { seat: 4, amount: 150 },
    ]);
  });

  it('gives the odd chip to the first winner left of the button', () => {
    // Button on seat 2: seat 3 is first to its left, seat 1 is nearly last.
    expect(splitPot(301, [1, 3], 2, 6)).toEqual([
      { seat: 1, amount: 150 },
      { seat: 3, amount: 151 },
    ]);
    // The button itself is the LAST seat in that order.
    expect(splitPot(301, [2, 1], 2, 6)).toEqual([
      { seat: 2, amount: 150 },
      { seat: 1, amount: 151 },
    ]);
  });

  it('spreads two odd chips over a three-way split', () => {
    const shares = splitPot(302, [0, 2, 4], 3, 6);
    expect(shares).toEqual([
      { seat: 0, amount: 101 },
      { seat: 2, amount: 100 },
      { seat: 4, amount: 101 },
    ]);
  });
});
