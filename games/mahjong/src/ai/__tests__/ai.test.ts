import { describe, expect, it } from 'vitest';
import { applyMove, createGame, normalize, seededRandom, tileOf, type GameState } from '@/engine';
import { decide, pendingSeats, shanten, type Difficulty } from '@/ai';

const man = (...r: number[]) => r.map((x) => tileOf(x - 1)).join('');

/** Play whole games with four cats; every state must survive normalize(). */
function playGame(levels: Difficulty[], seed: number, rounds = 1): GameState {
  const random = seededRandom(seed);
  let state = createGame({
    players: levels.map((_, i) => ({ uid: `cat-${i}`, name: `Cat ${i}`, isHuman: false })),
    minFaan: 1,
    rounds,
    seed,
    by: 'cat-0',
  });
  for (let step = 0; step < 20000; step++) {
    if (state.phase === 'gameover') return state;
    if (state.phase === 'scored') {
      const r = applyMove(state, { kind: 'next', seed: Math.floor(random() * 2 ** 32) }, 'cat-0');
      if (!r.ok) throw new Error(r.error);
      state = r.state;
      continue;
    }
    const seat = pendingSeats(state)[0];
    const move = decide(state, seat, levels[seat], random);
    if (!move) throw new Error(`no move for seat ${seat} in ${state.phase}`);
    const r = applyMove(state, move, `cat-${seat}`);
    if (!r.ok) throw new Error(`${r.error} ${JSON.stringify(move)}`);
    const back = normalize(JSON.parse(JSON.stringify(r.state)));
    if (!back) throw new Error(`state failed normalize after ${JSON.stringify(move)}`);
    state = back;
  }
  throw new Error('game did not finish');
}

describe('shanten', () => {
  it('measures distance to ready', () => {
    expect(shanten(man(1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 5, 5), 0)).toBe(-1);
    expect(shanten(man(1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 5), 0)).toBe(0);
  });
});

describe('the cats', () => {
  it('play complete games without an illegal move', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const end = playGame(['easy', 'medium', 'hard', 'medium'], seed);
      expect(end.phase).toBe('gameover');
      expect(end.players.reduce((n, p) => n + p.score, 0)).toBe(0);
    }
  });

  it('hard and medium outscore easy over many games', () => {
    let easy = 0;
    let better = 0;
    for (let seed = 100; seed < 112; seed++) {
      const end = playGame(['easy', 'medium', 'easy', 'hard'], seed);
      easy += end.players[0].score + end.players[2].score;
      better += end.players[1].score + end.players[3].score;
    }
    expect(better).toBeGreaterThan(easy);
  });
});
