import { buildGameResult, buildMatchResult, gameMultiplier } from '../score';
import { applyMove } from '../reducer';
import type { Seat } from '../types';
import { HOST, ok, pos } from './helpers';

/** A position where p0 has just borne off all 15. */
function won(p1: Record<number, number>, off: number, bar = 0) {
  return pos({ p0: {}, p1, off: { p0: 15, p1: off }, bar: { p1: bar } });
}

describe('gameMultiplier (Tawleh: 1, or 2 for a mars — never 3)', () => {
  it('is a single when the loser has borne off anything', () => {
    expect(gameMultiplier(won({ 5: 14 }, 1), 'p0')).toBe(1);
  });

  it('is a mars when the loser has borne off nothing', () => {
    expect(gameMultiplier(won({ 5: 15 }, 0), 'p0')).toBe(2);
  });

  it('is still only a mars with a checker on the bar — no triple game', () => {
    expect(gameMultiplier(won({ 5: 14 }, 0, 1), 'p0')).toBe(2);
  });

  it("is still only a mars with a checker in the winner's home board", () => {
    for (let i = 18; i < 24; i++) {
      expect(gameMultiplier(won({ [i]: 1, 5: 14 }, 0), 'p0')).toBe(2);
    }
  });

  it('is symmetric for p1', () => {
    const s = pos({ p1: {}, p0: { 5: 15 }, off: { p1: 15, p0: 0 } });
    expect(gameMultiplier(s, 'p1')).toBe(2);
  });
});

describe('buildGameResult', () => {
  it('scores a mars as 2 points', () => {
    const s = won({ 5: 15 }, 0);
    s.scores = { p0: 1, p1: 3 };
    expect(buildGameResult(s, 'p0')).toEqual({
      winner: 'p0',
      multiplier: 2,
      points: 2,
      how: 'mars',
      scores: { p0: 3, p1: 3 },
    });
  });

  it('scores a plain win as 1 point', () => {
    expect(buildGameResult(won({ 5: 10 }, 5), 'p0')).toMatchObject({ points: 1, how: 'single' });
  });
});

describe('buildMatchResult', () => {
  const sc = (p0: number, p1: number): Record<Seat, number> => ({ p0, p1 });

  it('is null until someone reaches the target', () => {
    expect(buildMatchResult(sc(4, 4), 5, 6)).toBeNull();
  });

  it('names the winner and flags a shutout', () => {
    expect(buildMatchResult(sc(5, 0), 5, 3)).toMatchObject({ winner: 'p0', shutout: true, games: 3 });
    expect(buildMatchResult(sc(5, 2), 5, 4)?.shutout).toBe(false);
  });

  it('handles overshooting the target with a mars', () => {
    expect(buildMatchResult(sc(6, 1), 5, 4)).toMatchObject({ winner: 'p0', target: 5 });
  });
});

describe('the last checker off', () => {
  it('ends the match on a mars that reaches the target', () => {
    const s = pos({ p0: { 0: 1 }, p1: { 10: 15 }, dice: [1, 2], scores: { p0: 3 }, target: 5 });
    const after = ok(applyMove(s, { kind: 'play', steps: [{ from: 0, to: -1 }] }, HOST));
    expect(after.gameResult).toMatchObject({ how: 'mars', points: 2 });
    expect(after.scores.p0).toBe(5);
    expect(after.phase).toBe('matchOver');
  });
});
