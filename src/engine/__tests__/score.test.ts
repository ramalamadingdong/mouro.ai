import { buildGameResult, buildMatchResult, buildPassResult, gameMultiplier } from '../score';
import { applyMove } from '../reducer';
import type { Seat } from '../types';
import { HOST, ok, pos } from './helpers';

/** A position where p0 has just borne off all 15. */
function won(p1: Record<number, number>, off: number, bar = 0) {
  return pos({ p0: {}, p1, off: { p0: 15, p1: off }, bar: { p1: bar } });
}

describe('gameMultiplier', () => {
  it('is a single when the loser has borne off anything', () => {
    expect(gameMultiplier(won({ 5: 14 }, 1), 'p0')).toBe(1);
  });

  it('is a gammon when the loser has borne off nothing', () => {
    expect(gameMultiplier(won({ 5: 15 }, 0), 'p0')).toBe(2);
  });

  it('is a backgammon with a checker still on the bar', () => {
    expect(gameMultiplier(won({ 5: 14 }, 0, 1), 'p0')).toBe(3);
  });

  it("is a backgammon with a checker in the winner's home board", () => {
    // The loser's own-frame 18..23 IS the winner's home board (0..5 mirrored).
    for (let i = 18; i < 24; i++) {
      expect(gameMultiplier(won({ [i]: 1, 5: 14 }, 0), 'p0')).toBe(3);
    }
  });

  it('is only a gammon for a checker just outside the winner\'s home', () => {
    expect(gameMultiplier(won({ 17: 1, 5: 14 }, 0), 'p0')).toBe(2);
  });

  it('is symmetric for p1', () => {
    const s = pos({ p1: {}, p0: { 5: 15 }, off: { p1: 15, p0: 0 } });
    expect(gameMultiplier(s, 'p1')).toBe(2);
  });
});

describe('buildGameResult', () => {
  it('multiplies the cube by the gammon factor', () => {
    const s = won({ 5: 15 }, 0);
    s.cube = { value: 4, owner: 'p0' };
    const r = buildGameResult(s, 'p0');
    expect(r).toMatchObject({ winner: 'p0', multiplier: 2, cube: 4, points: 8, how: 'gammon' });
    expect(r.scores).toEqual({ p0: 8, p1: 0 });
  });

  it('records whether it was the Crawford game', () => {
    const s = won({ 5: 14 }, 1);
    s.crawford = true;
    expect(buildGameResult(s, 'p0').crawford).toBe(true);
  });
});

describe('buildPassResult', () => {
  it('never applies a gammon multiplier', () => {
    const s = won({ 5: 15 }, 0);
    s.cube = { value: 2, owner: 'p1' };
    expect(buildPassResult(s, 'p0')).toMatchObject({ points: 2, multiplier: 1, how: 'pass' });
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

  it('handles overshooting the target with a gammon', () => {
    expect(buildMatchResult(sc(9, 1), 5, 4)).toMatchObject({ winner: 'p0', target: 5 });
  });
});

describe('match transcripts', () => {
  /** Play out a scripted sequence of "someone wins n points" against the reducer. */
  function runMatch(target: number, wins: { seat: Seat; cube: number; multiplier: 1 | 2 | 3 }[]) {
    let s = pos({ p0: { 5: 5 }, p1: { 5: 5 }, phase: 'gameOver', target });
    for (const w of wins) {
      const points = w.cube * w.multiplier;
      const scores = { ...s.scores };
      scores[w.seat] += points;
      s.gameResult = {
        winner: w.seat,
        multiplier: w.multiplier,
        cube: w.cube,
        points,
        how: w.multiplier === 3 ? 'backgammon' : w.multiplier === 2 ? 'gammon' : 'single',
        scores,
        crawford: s.crawford,
      };
      s.scores = scores;
      const match = buildMatchResult(scores, target, s.game);
      if (match) {
        s.matchResult = match;
        s.phase = 'matchOver';
        break;
      }
      s = ok(applyMove(s, { kind: 'nextGame' }, HOST));
      s.phase = 'gameOver';
    }
    return s;
  }

  it('runs a 5-point match to a gammon finish', () => {
    const s = runMatch(5, [
      { seat: 'p0', cube: 1, multiplier: 1 },
      { seat: 'p1', cube: 2, multiplier: 1 },
      { seat: 'p0', cube: 2, multiplier: 2 },
    ]);
    expect(s.scores).toEqual({ p0: 5, p1: 2 });
    expect(s.matchResult).toMatchObject({ winner: 'p0', target: 5, shutout: false });
  });

  it('marks the Crawford game exactly once in a 7-pointer', () => {
    let s = runMatch(7, [{ seat: 'p0', cube: 2, multiplier: 3 }]); // 6 of 7
    expect(s.crawford).toBe(true);
    expect(s.crawfordDone).toBe(false);
    // The Crawford game itself ends without deciding the match.
    s.scores = { p0: 6, p1: 1 };
    s.gameResult = {
      winner: 'p1',
      multiplier: 1,
      cube: 1,
      points: 1,
      how: 'single',
      scores: { p0: 6, p1: 1 },
      crawford: true,
    };
    const post = ok(applyMove(s, { kind: 'nextGame' }, HOST));
    expect(post.crawfordDone).toBe(true);
    expect(post.crawford).toBe(false);
  });
});
