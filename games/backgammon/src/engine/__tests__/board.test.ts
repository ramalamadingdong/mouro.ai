import {
  CHECKERS,
  POINTS,
  allHome,
  blots,
  boardKey,
  fromScratch,
  highestOwn,
  madePoints,
  otherSeat,
  ownAt,
  pipCount,
  primeLength,
  startingPoints,
  toOwn,
  toScratch,
} from '../board';
import type { Seat } from '../types';
import { pos } from './helpers';

describe('frame algebra', () => {
  it('toOwn is an involution for both seats', () => {
    for (const seat of ['p0', 'p1'] as Seat[]) {
      for (let i = 0; i < POINTS; i++) {
        expect(toOwn(seat, toOwn(seat, i))).toBe(i);
      }
    }
  });

  it('is the identity for p0 and a reflection for p1', () => {
    expect(toOwn('p0', 7)).toBe(7);
    expect(toOwn('p1', 0)).toBe(23);
    expect(toOwn('p1', 23)).toBe(0);
  });

  it('otherSeat flips', () => {
    expect(otherSeat('p0')).toBe('p1');
    expect(otherSeat('p1')).toBe('p0');
  });
});

describe('the opening position', () => {
  const points = startingPoints();

  it('has 15 checkers a side', () => {
    let p0 = 0;
    let p1 = 0;
    for (const v of points) {
      if (v > 0) p0 += v;
      else p1 += -v;
    }
    expect(p0).toBe(CHECKERS);
    expect(p1).toBe(CHECKERS);
  });

  it('is a mirror image in own-frame', () => {
    for (let i = 0; i < POINTS; i++) {
      expect(ownAt(points, 'p0', i)).toBe(ownAt(points, 'p1', i));
    }
  });

  it('puts both seats on the classic 24/13/8/6 points', () => {
    for (const seat of ['p0', 'p1'] as Seat[]) {
      expect(ownAt(points, seat, 23)).toBe(2);
      expect(ownAt(points, seat, 12)).toBe(5);
      expect(ownAt(points, seat, 7)).toBe(3);
      expect(ownAt(points, seat, 5)).toBe(5);
    }
  });

  it('is 167 pips for both seats', () => {
    const s = pos();
    s.points = points;
    expect(pipCount(s, 'p0')).toBe(167);
    expect(pipCount(s, 'p1')).toBe(167);
  });
});

describe('pipCount', () => {
  it('counts a checker on the bar as 25', () => {
    const s = pos({ p0: { 0: 1 }, bar: { p0: 1 } });
    // one checker on own index 0 (1 pip) + one on the bar (25)
    expect(pipCount(s, 'p0')).toBe(26);
  });

  it('ignores borne-off checkers', () => {
    const s = pos({ p0: { 3: 2 } });
    expect(s.off.p0).toBe(13);
    expect(pipCount(s, 'p0')).toBe(8);
  });
});

describe('scratch boards', () => {
  it('round-trips through toScratch/fromScratch', () => {
    const s = pos({ p0: { 5: 3, 12: 2 }, p1: { 5: 4, 20: 1 }, bar: { p1: 1 } });
    for (const seat of ['p0', 'p1'] as Seat[]) {
      const b = toScratch(s, seat);
      const back = fromScratch(b, seat);
      expect(back.points).toEqual(s.points);
      expect(back.bar).toEqual(s.bar);
    }
  });

  it('always presents my checkers as positive', () => {
    const s = pos({ p1: { 5: 3 } });
    const b = toScratch(s, 'p1');
    expect(b.pts[5]).toBe(3);
    expect(toScratch(s, 'p0').pts[toOwn('p0', toOwn('p1', 5))]).toBe(-3);
  });
});

describe('board predicates', () => {
  it('allHome is false with anything outside home or on the bar', () => {
    expect(allHome(toScratch(pos({ p0: { 3: 2 } }), 'p0'))).toBe(true);
    expect(allHome(toScratch(pos({ p0: { 6: 1, 3: 2 } }), 'p0'))).toBe(false);
    expect(allHome(toScratch(pos({ p0: { 3: 2 }, bar: { p0: 1 } }), 'p0'))).toBe(false);
  });

  it('highestOwn finds the furthest checker, or -1 when borne off', () => {
    expect(highestOwn(toScratch(pos({ p0: { 1: 1, 4: 2 } }), 'p0'))).toBe(4);
    expect(highestOwn(toScratch(pos({ p0: {}, off: { p0: 15 } }), 'p0'))).toBe(-1);
  });

  it('blots and madePoints partition the occupied points', () => {
    const b = toScratch(pos({ p0: { 2: 1, 5: 2, 9: 3 } }), 'p0');
    expect(blots(b)).toEqual([2]);
    expect(madePoints(b)).toEqual([5, 9]);
  });

  it('primeLength measures consecutive made points', () => {
    expect(primeLength(toScratch(pos({ p0: { 3: 2, 4: 2, 5: 2 } }), 'p0'))).toBe(3);
    expect(primeLength(toScratch(pos({ p0: { 3: 2, 5: 2 } }), 'p0'))).toBe(1);
    expect(primeLength(toScratch(pos({ p0: { 3: 1 } }), 'p0'))).toBe(0);
  });

  it('boardKey distinguishes different positions', () => {
    const a = boardKey(toScratch(pos({ p0: { 5: 2 } }), 'p0'));
    const b = boardKey(toScratch(pos({ p0: { 4: 2 } }), 'p0'));
    expect(a).not.toBe(b);
  });
});
