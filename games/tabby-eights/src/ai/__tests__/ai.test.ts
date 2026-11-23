import { describe, expect, test } from 'vitest';
import { decide, toMove, type Difficulty } from '@/ai';
import { applyMove, createGame, normalize, playable, roundWinner, type GameState } from '@/engine';

function rngFrom(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function game(players: number, seed: number, target = 100): GameState {
  return createGame({
    players: Array.from({ length: players }, (_, i) => ({ uid: 'wxyz'[i], name: 'WXYZ'[i], isHuman: false })),
    target,
    by: 'w',
    seed: [seed, players],
  });
}

/** Plays one round out with these levels; returns the round's winner. */
function playRound(levels: Difficulty[], seed: number, check = true): number {
  const rng = rngFrom(seed * 7 + 1);
  let s = game(levels.length, seed, 500);
  // Rotate who leads so neither side gets the lead every time.
  s = { ...s, toAct: seed % levels.length, turnUid: s.players[seed % levels.length].uid };
  for (let turns = 0; s.phase === 'playing'; turns++) {
    if (turns > 2000) throw new Error('round did not end');
    const seat = s.toAct as number;
    const d = decide(s, levels[seat], rng);
    if (check && d.kind === 'play') expect(playable(s)).toContain(d.card);
    const r = applyMove(s, toMove(d, [turns, seed]), s.players[seat].uid);
    if (!r.ok) throw new Error(`${levels[seat]}: ${r.error}`);
    s = r.state;
    if (check) expect(normalize(JSON.parse(JSON.stringify(s)))).toEqual(s);
  }
  return roundWinner(s) as number;
}

describe('cats', () => {
  test('always make a legal move, at every level and table size, to the end of a round', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 1; seed < 6; seed++) playRound([level, level], seed);
      playRound([level, level, level], 9);
      playRound([level, level, level, level], 11);
    }
  });

  test('keep an eight back while another card fits, and name the suit they hold most', () => {
    const base = game(2, 1);
    const s: GameState = { ...base };
    // Rig: w holds f8 fK y2 y3 y4; pile f7.
    const cards = ['f8', 'fK', 'y2', 'y3', 'y4', 'f7'];
    const rest = [...base.players.flatMap((p) => p.hand.match(/../g)!), ...base.stock.match(/../g)!, base.pile].filter(
      (c) => !cards.includes(c),
    );
    const rigged: GameState = {
      ...s,
      players: [
        { ...s.players[0], hand: 'f8fKy2y3y4' },
        { ...s.players[1], hand: rest.slice(0, 7).join('') },
      ],
      stock: rest.slice(7).join(''),
      pile: 'f7',
      suit: 'f',
    };
    expect(normalize(rigged)).not.toBeNull();
    expect(decide(rigged, 'medium', rngFrom(1))).toEqual({ kind: 'play', card: 'fK' });
    const only8: GameState = { ...rigged, pile: 'f7', suit: 'b' };
    expect(decide(only8, 'medium', rngFrom(1))).toEqual({ kind: 'play', card: 'f8', suit: 'y' });
  });

  // Crazy eights is mostly the luck of the deal, so skill shows only over many
  // rounds: 2000 heads-up rounds per pairing, seats alternating.
  test('stronger cats beat weaker ones over many rounds', () => {
    const N = 2000;
    const rate = (weak: Difficulty, strong: Difficulty) => {
      let wins = 0;
      for (let seed = 0; seed < N; seed++) {
        const strongSeat = seed % 2;
        const levels: Difficulty[] = strongSeat === 0 ? [strong, weak] : [weak, strong];
        if (playRound(levels, seed, false) === strongSeat) wins++;
      }
      return wins / N;
    };
    expect(rate('easy', 'medium')).toBeGreaterThan(0.6);
    expect(rate('medium', 'hard')).toBeGreaterThan(0.52);
    expect(rate('easy', 'hard')).toBeGreaterThan(0.6);
  });
});
