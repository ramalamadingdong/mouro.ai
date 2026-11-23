import { describe, expect, it } from 'vitest';
import { normalize, type GameState } from '@/engine';
import { act, betAll, deal, finish, newGame, next, stack, wireDamage } from './helpers';

const roundTrip = (s: GameState) => normalize(wireDamage(JSON.parse(JSON.stringify(s))));

describe('normalize', () => {
  it('restores a fresh, undealt game (almost everything in it gets pruned)', () => {
    const s = newGame(3);
    const wire = wireDamage(s) as Record<string, unknown>;
    expect('shoe' in wire).toBe(false);
    expect('result' in wire).toBe(false);
    expect('toAct' in wire).toBe(false);
    expect(normalize(wire)).toEqual(s);
  });

  it('restores a round mid-betting, mid-play and settled', () => {
    let s = deal(newGame(4));
    s = act(s, { kind: 'bet', amount: 50 });
    s = act(s, { kind: 'bet', amount: 0 });
    expect(roundTrip(s)).toEqual(s);
    s = betAll(s, 20);
    s = next(stack(s, '8c 9c Tc 6h 8d 9d Td 2c 3c 4c'));
    expect(roundTrip(s)).toEqual(s);
    s = act(s, { kind: 'split' });
    expect(roundTrip(s)).toEqual(s);
    s = finish(s);
    expect(roundTrip(s)).toEqual(s);
  });

  it('keeps toAct 0 as seat 0, not "nobody", and a net of 0 as 0', () => {
    let s = deal(newGame(3));
    expect(s.toAct).toBe(0);
    expect(roundTrip(s)?.toAct).toBe(0);
    s = finish(next(stack(betAll(s, 10), 'Tc Tc#1 Tc#2 7c 7d 7h 7s Kd')));
    expect(s.result!.net).toEqual([0, 0, 0]);
    expect(roundTrip(s)?.result?.net).toEqual([0, 0, 0]);
  });

  it('rejects junk', () => {
    for (const junk of [null, undefined, 7, 'state', [], {}, { players: [] }]) expect(normalize(junk)).toBeNull();
  });

  describe('integrity', () => {
    const base = () => JSON.parse(JSON.stringify(next(stack(betAll(deal(newGame(3)), 100), '2c 3c 4c 5c 6c 7c 8c 9c')))) as GameState;

    it('accepts the real thing', () => {
      expect(normalize(base())).not.toBeNull();
    });
    it('rejects conjured chips', () => {
      const s = base();
      s.players[0].stack += 500;
      expect(normalize(s)).toBeNull();
    });
    it('rejects a bigger bet nobody paid for', () => {
      const s = base();
      s.players[0].hands[0].bet += 100;
      expect(normalize(s)).toBeNull();
    });
    it('rejects a card in two places', () => {
      const s = base();
      s.players[0].hands[0].cards[0] = s.players[1].hands[0].cards[0];
      expect(normalize(s)).toBeNull();
    });
    it('rejects a card from outside the shoe', () => {
      const s = base();
      s.dealer[0] = 312;
      expect(normalize(s)).toBeNull();
    });
    it('rejects a turnUid that disagrees with toAct', () => {
      const s = base();
      s.turnUid = 'someone-else';
      expect(normalize(s)).toBeNull();
    });
    it('rejects a hand count over the limit', () => {
      const s = base();
      const h = s.players[0].hands[0];
      s.players[0].hands = [h, h, h, h, h];
      expect(normalize(s)).toBeNull();
    });
  });
});
