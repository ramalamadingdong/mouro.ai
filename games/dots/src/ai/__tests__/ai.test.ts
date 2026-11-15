import { describe, expect, test } from 'vitest';
import { decide, type Difficulty } from '@/ai';
import { applyMove, createGame, isLegalEdge, scores, type GameState } from '@/engine';

function rngFrom(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function game(cols: number, rows: number): GameState {
  return createGame({
    players: [
      { uid: 'x', name: 'X', isHuman: false },
      { uid: 'y', name: 'Y', isHuman: false },
    ],
    cols,
    rows,
    by: 'x',
  });
}

function playOut(levels: [Difficulty, Difficulty], seed: number, size = 4): number[] {
  const rng = rngFrom(seed);
  let s = game(size, size);
  while (s.phase === 'playing') {
    const seat = s.toAct as number;
    const edge = decide(s, levels[seat], rng);
    expect(isLegalEdge(s, edge)).toBe(true);
    const r = applyMove(s, { kind: 'line', edge }, s.turnUid);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return scores(s);
}

describe('cats', () => {
  test('always draw a legal line, at every level, to the end of the game', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 1; seed < 15; seed++) playOut([level, level], seed);
    }
  });

  test('takes a free box when one is offered', () => {
    let s = game(2, 2);
    // Three sides of box 0, drawn alternately so it is x's turn after.
    for (const [edge, uid] of [[0, 'x'], [2, 'y'], [6, 'x']] as const) {
      const r = applyMove(s, { kind: 'line', edge }, uid);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(s.turnUid).toBe('y');
    expect(decide(s, 'medium', rngFrom(1))).toBe(7);
  });

  test('stronger cats beat weaker ones over many games', () => {
    let mediumWins = 0;
    let hardWins = 0;
    const games = 40;
    for (let seed = 1; seed <= games; seed++) {
      // Alternate who moves first so neither side has the opening.
      const [a, b] = seed % 2 ? playOut(['medium', 'easy'], seed) : playOut(['easy', 'medium'], seed).reverse();
      if (a > b) mediumWins++;
      const [c, d] = seed % 2 ? playOut(['hard', 'medium'], seed, 5) : playOut(['medium', 'hard'], seed, 5).reverse();
      if (c > d) hardWins++;
    }
    expect(mediumWins).toBeGreaterThan(games * 0.7);
    expect(hardWins).toBeGreaterThan(games * 0.5);
  });
});
