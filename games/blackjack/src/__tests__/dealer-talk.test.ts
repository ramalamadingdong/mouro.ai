import { describe, expect, it } from 'vitest';
import { NAG_AFTER, dealerLine as line, impatienceLine as nagLine, openingLine as opening } from '@/dealer-talk';
import { DEALERS } from '@/dealers';
import { DUCHESS } from '@/dealers/duchess';
import { LINE_KEYS } from '@/dealers/types';

const dealerLine = (a: GameState, b: GameState, n: (seat: number) => string) => line(a, b, n, DUCHESS);
const impatienceLine = (l: number, who: string | null, seed: number) => nagLine(DUCHESS, l, who, seed);
const openingLine = (seed?: number) => opening(DUCHESS, seed);
import { RULES, type GameState } from '@/engine';
import { act, betAll, deal, newGame, next, stack } from '@/engine/__tests__/helpers';

const say = (prev: GameState, s: GameState): string | null => dealerLine(prev, s, (seat) => `P${seat}`)?.text ?? null;

describe('every dealer', () => {
  it.each(DEALERS.map((d) => [d.name, d] as const))('%s has lines for every moment, five nag levels, and the house rules up front', (_, d) => {
    for (const key of LINE_KEYS) expect(d.voice.lines[key].length, key).toBeGreaterThan(0);
    expect(d.voice.nag).toHaveLength(5);
    expect(d.voice.nagDeal).toHaveLength(5);
    expect(d.voice.nagEmoji).toHaveLength(5);
    for (const l of d.voice.lines.open) expect(l).toMatch(/soft seventeen/);
    for (const level of d.voice.nag) for (const l of level) expect(l).toMatch(/\{who\}/);
    for (const l of d.voice.finally) expect(l).not.toMatch(/\{/);
  });

  it.each(DEALERS.map((d) => [d.name, d] as const))('%s talks through a whole game without a gap', (_, d) => {
    let s = deal(newGame(2));
    let prev = s;
    for (let i = 0; i < 40 && s.phase !== 'gameover'; i++) {
      const legal = s.toAct;
      if (s.phase === 'betting' && legal !== null) s = act(s, { kind: 'bet', amount: 10 });
      else if (s.phase === 'playing' && legal !== null) s = act(s, { kind: 'hit' });
      else if (s.phase === 'settled') s = deal(s, i);
      else s = next(s);
      const said = line(prev, s, (seat) => `P${seat}`, d.voice);
      if (said) {
        expect(said.text).not.toMatch(/\{\w+\}/);
        expect(said.emoji.length).toBeGreaterThan(0);
      }
      prev = s;
    }
  });
});

describe('Duchess', () => {
  it('opens with the house rules', () => {
    const s0 = newGame(2);
    const line = say(s0, deal(s0))!;
    expect(line).toMatch(/soft seventeen/);
    expect([0, 1, 2, 3].map((n) => openingLine(n))).toContain(line);
  });

  it('calls bets closed and the peek under an Ace', () => {
    const s = betAll(deal(newGame(1)), 10);
    const closed = s;
    expect(say(deal(newGame(1)), closed)).not.toBeNull();
    const dealt = next(stack(s, 'Tc As 9d 7h'));
    expect(say(s, dealt)).toMatch(/Ace/);
  });

  it('has lots to say: a long game rarely repeats a line', () => {
    const lines = new Set<string>();
    let s = deal(newGame(1));
    for (let v = 0; v < 200; v++) {
      const prev = { ...s, handNo: s.handNo };
      const nextRound = { ...s, version: v, handNo: s.handNo + 1 + v, shoe: s.shoe.slice(1) };
      const line = say(prev, nextRound);
      if (line) lines.add(line);
    }
    expect(lines.size).toBeGreaterThan(12);
  });

  it('says when she hits a soft 17 because of Vegas rules', () => {
    let s = next(stack(betAll(deal(newGame(1)), 10), 'Tc 6c Td Ac 2c'));
    s = act(s, { kind: 'stand' });
    const turned = next(s);
    expect(say(s, turned)).toMatch(/soft 17/i);
    const drew = next(turned);
    expect(say(turned, drew)).toMatch(/[Ss]oft seventeen/);
  });

  it('announces the reshuffle when the cut card comes out', () => {
    let s = deal(newGame(1));
    s = { ...s, phase: 'settled', result: { dealerTotal: 20, dealerBlackjack: false, net: [0] }, shoe: s.shoe.slice(0, RULES.CUT - 1) };
    const fresh = deal(s);
    expect(say(s, fresh)).toMatch(/[Ss]huffle|cut card/i);
  });

  it('has shade for standing on 11 or less', () => {
    const s = next(stack(betAll(deal(newGame(1)), 10), '5c 6c 4d 9d'));
    expect(say(s, act(s, { kind: 'stand' }))).toMatch(/9/);
  });

  it('reacts to tips by size', () => {
    const s = deal(newGame(1));
    expect(say(s, act(s, { kind: 'tip', amount: 5 }))).toMatch(/5/);
    expect(say(s, act(s, { kind: 'tip', amount: 100 }))).toMatch(/100/);
  });

  it('sends an emoji with every line', () => {
    const s0 = newGame(2);
    expect(dealerLine(s0, deal(s0), (seat) => `P${seat}`)?.emoji).toBeTruthy();
  });

  it('gets ruder the longer someone takes, and nags for the next deal', () => {
    expect(NAG_AFTER).toHaveLength(5);
    const levels = [1, 2, 3, 4, 5].map((l) => impatienceLine(l, 'Rami', 7));
    for (const l of levels) {
      expect(l.text).toMatch(/Rami/);
      expect(l.emoji).toBeTruthy();
    }
    expect(new Set(levels.map((l) => l.emoji)).size).toBe(5);
    expect(impatienceLine(2, null, 7).text).not.toMatch(/Rami/);
  });

  it('names a bust', () => {
    let s = next(stack(betAll(deal(newGame(1)), 10), 'Tc 6c 6d 9d Kh'));
    const busted = act(s, { kind: 'hit' });
    expect(say(s, busted)).toMatch(/P0|26/);
  });
});
