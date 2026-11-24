import { describe, expect, it } from 'vitest';
import { CATS, SKILL, basicStrategy, decide, trueCount, willLend, type Difficulty } from '@/ai';
import { applyMove, legalActions, makeRng, parseCards, totalChips, type GameState, type Move } from '@/engine';
import { betAll, checkInvariants, deal, newGame, next, stack, uidOf } from '@/engine/__tests__/helpers';

const up = (face: string): number => {
  const v = parseCards(face)[0];
  const rank = (v % 52) >> 2;
  return rank === 12 ? 11 : Math.min(10, rank + 2);
};

describe('basicStrategy', () => {
  it.each([
    ['Tc 6d', '7h', 'H'],
    ['Tc 6d', '6h', 'S'],
    ['Tc 2d', '3h', 'H'],
    ['Tc 2d', '4h', 'S'],
    ['6c 5d', 'Th', 'D'],
    ['6c 5d', 'Ah', 'D'], // H17: double 11 against an Ace
    ['As 7d', '2h', 'Ds'], // H17: double soft 18 against a 2
    ['As 8d', '6h', 'Ds'],
    ['As 7d', '7h', 'S'],
    ['As 7d', '5h', 'Ds'],
    ['As 7d', '9h', 'H'],
    ['As 6d', '4h', 'D'],
    ['8c 8d', 'Th', 'P'],
    ['As Ad', 'Ah', 'P'],
    ['Tc Kd', '6h', 'S'],
    ['9c 9d', '7h', 'S'],
    ['5c 5d', '6h', 'D'],
    ['Tc 7d', 'Ah', 'S'],
  ])('%s against %s → %s', (hand, dealer, play) => {
    expect(basicStrategy(parseCards(hand), up(dealer), true)).toBe(play);
  });

  it.each([
    ['Tc 6d', 'Th', 'R'],
    ['Tc 6d', '9h', 'R'],
    ['Tc 5d', 'Ah', 'R'],
    ['Tc 7d', 'Ah', 'Rs'],
    ['Tc 6d', '8h', 'H'],
    ['8c 8d', 'Th', 'P'], // split 8s, never surrender them
  ])('with late surrender: %s against %s → %s', (hand, dealer, play) => {
    expect(basicStrategy(parseCards(hand), up(dealer), true, true)).toBe(play);
  });
});

describe('trueCount', () => {
  it('is zero on a fresh shoe and rises as low cards come out', () => {
    let s = betAll(deal(newGame(1)), 10);
    s = stack(s, '2c 3c 4c 5c');
    expect(trueCount(s)).toBe(0);
    s = next(s);
    // 2, 3 and 4 seen; the hole card (5) is still face down.
    expect(trueCount(s)).toBeCloseTo(3 / ((312 - 4) / 52), 5);
  });
});

describe('decide', () => {
  it('only ever returns moves the engine accepts, for every cat at every level', { timeout: 60_000 }, () => {
    const levels: Difficulty[] = ['easy', 'medium', 'hard'];
    for (let game = 0; game < 24; game++) {
      const rng = makeRng([game, 0xca7]);
      const seats = 1 + (game % 8);
      let s: GameState = newGame(seats, 1000, 15);
      const chips = totalChips(s);
      const skill = SKILL[levels[game % 3]];
      for (let step = 0; s.phase !== 'gameover'; step++) {
        expect(step).toBeLessThan(20_000);
        let move: Move;
        let uid = uidOf(0);
        const legal = legalActions(s);
        if (s.phase === 'idle' || s.phase === 'settled') move = { kind: 'deal', seed: [step, game] };
        else if (!legal) move = { kind: 'next', from: s.phase, dealerCards: s.dealer.length };
        else {
          uid = uidOf(legal.seat);
          move = decide(s, legal.seat, CATS[legal.seat % CATS.length].personality, skill, rng);
        }
        const result = applyMove(s, move, uid);
        if (!result.ok) throw new Error(`game ${game} step ${step}: ${move.kind} refused — ${result.error}`);
        s = result.state;
        checkInvariants(s, chips, `game ${game} step ${step}`);
      }
    }
  });

  it('the mimic hits 16 and stands on 17, whatever the dealer shows', () => {
    const smokey = CATS.find((c) => c.id === 'smokey')!;
    let s = next(stack(betAll(deal(newGame(1)), 10), 'Tc 6h 6d'));
    expect(decide(s, 0, smokey.personality, SKILL.hard, Math.random)).toEqual({ kind: 'hit' });
    s = next(stack(betAll(deal(newGame(1)), 10), 'Tc 6h 7d'));
    expect(decide(s, 0, smokey.personality, SKILL.hard, Math.random)).toEqual({ kind: 'stand' });
  });

  it('Patches stands on hard 12 against a 10', () => {
    const patches = CATS.find((c) => c.id === 'patches')!;
    const s = next(stack(betAll(deal(newGame(1)), 10), 'Tc Th 2d 7c'));
    expect(decide(s, 0, patches.personality, SKILL.hard, Math.random)).toEqual({ kind: 'stand' });
  });

  it('a cat in debt pays it back once it is flush, before betting', () => {
    const tiger = CATS.find((c) => c.id === 'tiger')!;
    let s = deal(newGame(2, 1000));
    const lent = applyMove(s, { kind: 'loan', to: 0, amount: 200 }, uidOf(1)); // seat 1 lends seat 0
    if (!lent.ok) throw new Error(lent.error);
    s = lent.state;
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, stack: 1500 } : { ...p, stack: 500 })), house: 200 - 500 + 200 } as GameState;
    expect(decide(s, 0, tiger.personality, SKILL.hard, makeRng([1]))).toEqual({ kind: 'repay', to: 1, amount: 200 });
  });

  it('cats lend in character: Shadow never, Marmalade generously', () => {
    const s = deal(newGame(3, 1000));
    const shadow = CATS.find((c) => c.id === 'shadow')!;
    const marm = CATS.find((c) => c.id === 'marmalade')!;
    expect(willLend(s, 1, 50, shadow.personality)).toBe(false);
    expect(willLend(s, 1, 500, marm.personality)).toBe(true);
    expect(willLend(s, 1, 990, marm.personality)).toBe(false);
  });

  it('bets are legal: on the step, inside the limits', () => {
    const s = deal(newGame(1, 1000));
    for (const cat of CATS) {
      const move = decide(s, 0, cat.personality, SKILL.medium, makeRng([1]));
      expect(move.kind).toBe('bet');
      if (move.kind === 'bet') {
        expect(move.amount % 5).toBe(0);
        expect(move.amount).toBeGreaterThanOrEqual(10);
        expect(move.amount).toBeLessThanOrEqual(500);
      }
    }
  });
});
