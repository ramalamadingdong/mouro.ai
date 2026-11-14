import { describe, expect, it } from 'vitest';
import { normalize, type GameState } from '@/engine';
import { act, deal, dealWithButton, newGame, rig, runOut, wireDamage } from './helpers';

const roundTrip = (s: GameState) => normalize(wireDamage(JSON.parse(JSON.stringify(s))));

describe('normalize', () => {
  it('restores a fresh, undealt game (almost everything in it gets pruned)', () => {
    const s = newGame(3);
    const wire = wireDamage(s) as Record<string, unknown>;
    expect('deck' in wire).toBe(false);
    expect('result' in wire).toBe(false);
    expect('toAct' in wire).toBe(false);
    expect(normalize(wire)).toEqual(s);
  });

  it('restores a hand in progress', () => {
    let s = dealWithButton(newGame(4), 0);
    s = act(s, { kind: 'raise', to: 60 });
    s = act(s, { kind: 'fold' });
    expect(roundTrip(s)).toEqual(s);
  });

  it('keeps toAct 0 as seat 0, not "nobody"', () => {
    const s = dealWithButton(newGame(3), 0);
    expect(s.toAct).toBe(0);
    expect(roundTrip(s)?.toAct).toBe(0);
  });

  it('restores a showdown whose seat-indexed hands arrive as a sparse object', () => {
    let s = rig(dealWithButton(newGame(3), 0), ['As Ad', '7c 2d', 'Ks Kd'], '3h 8s 9c Jd 4h');
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'fold' }); // seat 1 folds → hands[1] is null → a hole on the wire
    s = act(s, { kind: 'check' });
    s = runOut(s);
    const wire = wireDamage(s) as { result: { hands: unknown } };
    expect(Array.isArray(wire.result.hands)).toBe(false);
    const back = normalize(wire);
    expect(back).toEqual(s);
    expect(back?.result?.hands[1]).toBeNull();
    expect(back?.result?.hands[2]?.name).toBe('Pair of Kings');
  });

  it('rejects junk', () => {
    for (const junk of [null, undefined, 7, 'state', [], {}, { players: [] }]) expect(normalize(junk)).toBeNull();
  });

  describe('integrity', () => {
    const base = () => JSON.parse(JSON.stringify(deal(newGame(3), 3))) as GameState;

    it('rejects conjured chips', () => {
      const s = base();
      s.players[0].stack += 500;
      expect(normalize(s)).toBeNull();
    });
    it('rejects a duplicated card', () => {
      const s = base();
      s.players[0].hole[0] = s.players[1].hole[0];
      expect(normalize(s)).toBeNull();
    });
    it('rejects a missing card', () => {
      const s = base();
      s.deck.pop();
      expect(normalize(s)).toBeNull();
    });
    it('rejects a turnUid that disagrees with toAct', () => {
      const s = base();
      s.turnUid = s.players[(s.toAct! + 1) % 3].uid;
      expect(normalize(s)).toBeNull();
    });
    it('rejects fractional and negative chips', () => {
      const a = base();
      a.players[0].stack -= 0.5;
      a.players[1].stack += 0.5;
      expect(normalize(a)).toBeNull();
      const b = base();
      b.players[0].stack = -10;
      b.players[1].stack += 10 + b.players[0].committed + 1000;
      expect(normalize(b)).toBeNull();
    });
    it('rejects a seventh player and a compacted player list', () => {
      const s = base() as GameState & { players: unknown };
      const sparse = { 0: s.players[0], 2: s.players[2] };
      expect(normalize({ ...s, players: sparse })).toBeNull();
    });
  });
});
