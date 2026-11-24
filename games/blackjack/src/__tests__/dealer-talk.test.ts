import { describe, expect, it } from 'vitest';
import { dealerLine, openingLine } from '@/dealer-talk';
import { RULES, type GameState } from '@/engine';
import { act, betAll, deal, newGame, next, stack } from '@/engine/__tests__/helpers';

const say = (prev: GameState, s: GameState): string | null => dealerLine(prev, s, (seat) => `P${seat}`);

describe('Duchess', () => {
  it('opens with the house rules', () => {
    const s0 = newGame(2);
    expect(say(s0, deal(s0))).toBe(openingLine());
    expect(openingLine()).toMatch(/soft seventeen/);
  });

  it('calls bets closed, insurance open, and the peek', () => {
    let s = betAll(deal(newGame(1)), 10);
    s = stack(s, 'Tc As 9d 7h');
    const dealt = next(s);
    expect(say(s, dealt)).toMatch(/Insurance is open/);
    const declined = act(dealt, { kind: 'insure', take: false });
    const peeked = next(declined);
    expect(say(declined, peeked)).toMatch(/I peek… nobody's home/);
  });

  it('says when she hits a soft 17 because of Vegas rules', () => {
    let s = next(stack(betAll(deal(newGame(1)), 10), 'Tc 6c Td Ac 2c'));
    s = act(s, { kind: 'stand' });
    const turned = next(s);
    expect(say(s, turned)).toMatch(/Hole card's an Ace — I've got soft 17/);
    const drew = next(turned);
    expect(say(turned, drew)).toMatch(/Soft seventeen — Vegas rules, the house hits!/);
  });

  it('announces the reshuffle when the cut card comes out', () => {
    let s = deal(newGame(1));
    s = { ...s, phase: 'settled', result: { dealerTotal: 20, dealerBlackjack: false, net: [0] }, shoe: s.shoe.slice(0, RULES.CUT - 1) };
    const fresh = deal(s);
    expect(say(s, fresh)).toMatch(/Shuffle up!/);
  });

  it('has shade for standing on 11 or less', () => {
    const s = next(stack(betAll(deal(newGame(1)), 10), '5c 6c 4d 9d'));
    expect(say(s, act(s, { kind: 'stand' }))).toMatch(/stands on 9\?!/);
  });

  it('names a bust', () => {
    let s = next(stack(betAll(deal(newGame(1)), 10), 'Tc 6c 6d 9d Kh'));
    const busted = act(s, { kind: 'hit' });
    expect(say(s, busted)).toMatch(/P0 busts|26 — bust!|P0 hit/);
  });
});
