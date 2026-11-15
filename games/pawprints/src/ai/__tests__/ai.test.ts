import { describe, expect, test } from 'vitest';
import { decide, type Difficulty } from '@/ai';
import { applyMove, createGame, isLegalCell, winner, type GameState } from '@/engine';

function rngFrom(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function game(size = 13, players = 2): GameState {
  return createGame({
    players: Array.from({ length: players }, (_, i) => ({ uid: 'xyzw'[i], name: 'XYZW'[i], isHuman: false })),
    size,
    by: 'x',
  });
}

function step(s: GameState, cell: number): GameState {
  const r = applyMove(s, { kind: 'paw', cell }, s.turnUid);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Plays a game out; returns the winning seat or null. */
function playOut(levels: Difficulty[], seed: number, size = 13): number | null {
  const rng = rngFrom(seed);
  let s = game(size, levels.length);
  // A couple of random opening paws near the middle, so seeded games differ.
  const mid = Math.floor(size / 2) * size + Math.floor(size / 2);
  s = step(s, mid + Math.floor(rng() * 3) - 1);
  while (s.phase === 'playing') {
    const cell = decide(s, levels[s.toAct as number], rng);
    expect(isLegalCell(s, cell)).toBe(true);
    s = step(s, cell);
  }
  return winner(s);
}

describe('cats', () => {
  test('always play a legal point, at every level and table size, to the end of the game', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 1; seed < 5; seed++) playOut([level, level], seed, 11);
      playOut([level, level, level], 9, 11);
      playOut([level, level, level, level], 11, 11);
    }
  });

  test('finishes its own line before blocking, and blocks when it cannot finish', () => {
    let s = game(11);
    for (const c of [0, 110, 1, 111, 2, 112, 3, 113]) s = step(s, c);
    // x to play: both have four. Win.
    expect(decide(s, 'medium', rngFrom(1))).toBe(4);
    let t = game(11);
    for (const c of [0, 60, 1, 50, 2, 70, 3]) t = step(t, c);
    // y to play, no four of its own: block at 4.
    expect(decide(t, 'medium', rngFrom(1))).toBe(4);
    expect(decide(t, 'hard', rngFrom(1))).toBe(4);
  });

  test('stronger cats beat weaker ones over many games', () => {
    let mediumWins = 0;
    let easyWins = 0;
    let hardWins = 0;
    let hardLosses = 0;
    const games = 30;
    for (let seed = 1; seed <= games; seed++) {
      // Alternate who moves first so neither side keeps the opening.
      const flip = seed % 2 === 0;
      const a = playOut(flip ? ['easy', 'medium'] : ['medium', 'easy'], seed);
      if (a !== null && (a === 0) !== flip) mediumWins++;
      else if (a !== null) easyWins++;
      const b = playOut(flip ? ['medium', 'hard'] : ['hard', 'medium'], seed);
      if (b !== null && (b === 0) !== flip) hardWins++;
      else if (b !== null) hardLosses++;
    }
    expect(mediumWins).toBeGreaterThan(games * 0.7);
    expect(mediumWins).toBeGreaterThan(easyWins * 3);
    expect(hardWins).toBeGreaterThan(hardLosses);
  });
});
