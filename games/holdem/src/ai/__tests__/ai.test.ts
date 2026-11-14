import { describe, expect, it } from 'vitest';
import { CATS, SKILL, chenScore, decide, estimateEquity, type Difficulty } from '@/ai';
import { applyMove, legalActions, makeRng, parseCards, totalChips, type GameState, type Move } from '@/engine';
import { checkInvariants, newGame, uidOf } from '@/engine/__tests__/helpers';

describe('chenScore', () => {
  it.each([
    ['As Ad', 20],
    ['Ks Kd', 16],
    ['As Ks', 12],
    ['Ac Kd', 10],
    ['Ts Td', 10],
    ['7s 6s', 7],
    ['2c 2d', 5],
    ['7c 2d', -1],
  ])('%s → %i', (hand, score) => {
    expect(chenScore(parseCards(hand))).toBe(score);
  });
});

describe('estimateEquity', () => {
  const rng = () => makeRng([7]);
  it('aces are a big favourite heads-up, less so against five', () => {
    const one = estimateEquity(parseCards('As Ad'), [], 1, 2000, rng());
    const five = estimateEquity(parseCards('As Ad'), [], 5, 2000, rng());
    expect(one).toBeGreaterThan(0.8);
    expect(one).toBeLessThan(0.9);
    expect(five).toBeGreaterThan(0.42);
    expect(five).toBeLessThan(0.56);
  });
  it('the nuts on the river is 100%, the board playing is a pure tie', () => {
    expect(estimateEquity(parseCards('As Ks'), parseCards('Qs Js Ts 2d 3c'), 3, 300, rng())).toBe(1);
    const chop = estimateEquity(parseCards('2c 3d'), parseCards('As Ks Qs Js Ts'), 1, 300, rng());
    expect(chop).toBeCloseTo(0.5, 5);
  });
  it('seven-deuce is an underdog', () => {
    expect(estimateEquity(parseCards('7c 2d'), [], 1, 2000, rng())).toBeLessThan(0.4);
  });
  it('is fast enough to run before every decision on a phone', () => {
    const r = rng();
    const flop = parseCards('9h 8s 2c');
    estimateEquity(parseCards('As Ad'), flop, 5, 400, r); // warm up the JIT
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) estimateEquity(parseCards('As Ad'), flop, 5, 400, r);
    const each = (performance.now() - t0) / 20;
    // The hardest setting against a full table. Typically ~1ms here; the
    // budget on a phone is 50ms, so a 20ms ceiling leaves room for slow CI.
    expect(each).toBeLessThan(20);
  });
});

describe('decide', () => {
  /** Play whole games with every seat run by a cat; every move must be accepted. */
  function playGames(level: Difficulty, games: number): { hands: number; kinds: Record<string, number> } {
    const kinds: Record<string, number> = {};
    let hands = 0;
    for (let game = 0; game < games; game++) {
      const rng = makeRng([game, level.length, 0xca7]);
      const seats = 2 + (game % 5);
      let s: GameState = newGame(seats, 1000, 4);
      const chips = totalChips(s);
      for (let step = 0; s.phase !== 'gameover'; step++) {
        expect(step).toBeLessThan(20_000);
        let move: Move;
        let uid = uidOf(0);
        if (s.phase === 'idle' || s.phase === 'showdown') {
          move = { kind: 'deal', seed: [game, step] };
          hands++;
        } else if (s.toAct === null) {
          move = { kind: 'next', from: s.phase };
        } else {
          const seat = s.toAct;
          uid = uidOf(seat);
          move = decide(s, seat, CATS[seat % CATS.length].personality, SKILL[level], rng);
          kinds[move.kind] = (kinds[move.kind] ?? 0) + 1;
          const legal = legalActions(s)!;
          // Folding when a check is free is never right; the cats must not do it.
          if (move.kind === 'fold') expect(legal.canCheck).toBe(false);
        }
        const result = applyMove(s, move, uid);
        if (!result.ok) throw new Error(`${level} game ${game} step ${step}: ${move.kind} rejected — ${result.error}`);
        s = result.state;
        checkInvariants(s, chips, `${level} game ${game} step ${step}`);
      }
    }
    return { hands, kinds };
  }

  it.each(['easy', 'medium', 'hard'] as const)('never makes an illegal move (%s)', { timeout: 60_000 }, (level) => {
    const { hands, kinds } = playGames(level, 25);
    expect(hands).toBeGreaterThan(300);
    // And it actually plays poker: every kind of action shows up.
    for (const kind of ['fold', 'check', 'call', 'raise']) expect(kinds[kind] ?? 0).toBeGreaterThan(20);
  });

  it('returns a harmless fold when asked about a seat that is not on turn', () => {
    const s = newGame(2);
    expect(decide(s, 0, CATS[0].personality, SKILL.hard, makeRng([1]))).toEqual({ kind: 'fold' });
  });

  it('the tight cat folds trash and the loose cat plays more hands', () => {
    const count = (cat: number): number => {
      let played = 0;
      for (let seed = 0; seed < 300; seed++) {
        const dealt = applyMove(newGame(6), { kind: 'deal', seed: [seed] }, uidOf(0));
        if (!dealt.ok) throw new Error(dealt.error);
        const s = dealt.state;
        const move = decide(s, s.toAct!, CATS[cat].personality, SKILL.hard, makeRng([seed]));
        if (move.kind !== 'fold') played++;
      }
      return played;
    };
    const shadow = count(0);
    const marmalade = count(1);
    expect(shadow).toBeLessThan(90); // under 30% of hands from under the gun
    expect(marmalade).toBeGreaterThan(shadow + 20);
  });
});
