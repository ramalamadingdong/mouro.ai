import { describe, expect, test } from 'vitest';
import { applyMove, createGame, gridOf, normalize, parseFloor, scores, type GameState, type Rnd } from '@/engine';
import { decide, gapCost, type Difficulty } from '..';

function seeded(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole game between computer players of the given levels. Returns the final scores. */
function play(levels: Difficulty[], seed: number): number[] {
  const rnd = seeded(seed);
  let s: GameState = createGame({
    players: levels.map((_, i) => ({ uid: `cat-${i}`, name: `Cat ${i}`, isHuman: false })),
    by: 'cat-0',
    rnd,
  });
  while (s.toAct !== null) {
    const r = applyMove(s, decide(s, levels[s.toAct], rnd), s.players[s.toAct].uid, rnd);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    if (!normalize(s)) throw new Error('the cats produced an invalid state');
  }
  return scores(s);
}

describe('the computer cats', () => {
  test('every level always returns a legal move, to the end of the game, at 2–4 players', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      for (const n of [2, 3, 4]) expect(play(new Array<Difficulty>(n).fill(level), n * 7)).toHaveLength(n);
    }
  });

  test('a cat seats a tile whenever one fits', () => {
    const rnd = seeded(3);
    const s = createGame({ players: [0, 1].map((i) => ({ uid: `cat-${i}`, name: 'c', isHuman: false })), by: 'cat-0', rnd });
    for (const level of ['easy', 'medium', 'hard'] as const) expect(decide(s, level, rnd).kind).toBe('seat');
  });

  test('hard beats easy clearly over a run of games', () => {
    let hard = 0;
    let easy = 0;
    for (let i = 0; i < 30; i++) {
      const [a, b] = play(i % 2 ? ['hard', 'easy'] : ['easy', 'hard'], 100 + i);
      hard += i % 2 ? a : b;
      easy += i % 2 ? b : a;
    }
    expect(hard).toBeGreaterThan(easy * 1.2);
  });

  test('gapCost counts the squares nothing can fill', () => {
    expect(gapCost(gridOf([]))).toBe(0);
    // Two nappers that wall off the corner square: one gap nothing can ever fill.
    expect(gapCost(gridOf(parseFloor('g0010s0001') ?? []))).toBe(2.5);
  });
});
