import { describe, expect, it } from 'vitest';
import { RIICHI_STICK, START_SCORE, applyMove, createGame, normalize, seededRandom, tileOf, type GameState, type Ruleset } from '@/engine';
import { advise, decide, pendingSeats, shanten, type Difficulty } from '@/ai';

const man = (...r: number[]) => r.map((x) => tileOf(x - 1)).join('');

/** Play a whole game with cats in every seat; every state must survive normalize() off the wire. */
function playGame(levels: Difficulty[], seed: number, ruleset: Ruleset = 'hk', rounds = 1): GameState {
  const random = seededRandom(seed);
  let state = createGame({
    players: levels.map((_, i) => ({ uid: `cat-${i}`, name: `Cat ${i}`, isHuman: false })),
    ruleset,
    minFaan: 1,
    rounds,
    seed,
    by: 'cat-0',
  });
  for (let step = 0; step < 40000; step++) {
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

const total = (s: GameState) => s.players.reduce((n, p) => n + p.score, 0) + s.sticks * RIICHI_STICK;

describe('shanten', () => {
  it('measures distance to ready', () => {
    expect(shanten(man(1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 5, 5), 0)).toBe(-1);
    expect(shanten(man(1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 5), 0)).toBe(0);
  });
});

describe('the cats', () => {
  for (const ruleset of ['hk', 'riichi'] as const) {
    for (const seats of [4, 2]) {
      it(`play complete ${ruleset} games, ${seats} players, without an illegal move`, () => {
        const levels: Difficulty[] = seats === 4 ? ['easy', 'medium', 'hard', 'medium'] : ['medium', 'hard'];
        for (let seed = 1; seed <= 4; seed++) {
          const end = playGame(levels, seed, ruleset);
          expect(end.phase).toBe('gameover');
          expect(total(end)).toBe(START_SCORE[ruleset] * seats);
        }
      });
    }
  }

  it('medium and hard outscore easy over many Hong Kong games', () => {
    let easy = 0;
    let better = 0;
    for (let seed = 100; seed < 112; seed++) {
      const end = playGame(['easy', 'medium', 'easy', 'hard'], seed);
      easy += end.players[0].score + end.players[2].score;
      better += end.players[1].score + end.players[3].score;
    }
    expect(better).toBeGreaterThan(easy);
  });

  it('riichi cats win hands (they find yaku) and declare riichi', () => {
    let wins = 0;
    let riichis = 0;
    for (let seed = 200; seed < 206; seed++) {
      const random = seededRandom(seed);
      let s = createGame({
        players: [0, 1, 2, 3].map((i) => ({ uid: `c${i}`, name: `c${i}`, isHuman: false })),
        ruleset: 'riichi',
        minFaan: 0,
        rounds: 1,
        seed,
        by: 'c0',
      });
      while (s.phase !== 'scored' && s.phase !== 'gameover') {
        const seat = pendingSeats(s)[0];
        const m = decide(s, seat, 'medium', random);
        if (m?.kind === 'discard' && m.riichi) riichis++;
        const r = applyMove(s, m!, `c${seat}`);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
      if (s.result && s.result.winner >= 0) wins++;
    }
    expect(wins).toBeGreaterThan(2);
    expect(riichis).toBeGreaterThan(2);
  });

  it('the coach always has advice when a seat is waited on', () => {
    const s = createGame({
      players: [0, 1].map((i) => ({ uid: `c${i}`, name: `c${i}`, isHuman: true })),
      ruleset: 'riichi',
      minFaan: 0,
      rounds: 1,
      seed: 3,
      by: 'c0',
    });
    const tip = advise(s, 0);
    expect(tip?.move.kind).toMatch(/discard|win|kong/);
    expect(tip?.why.length).toBeGreaterThan(10);
  });
});
