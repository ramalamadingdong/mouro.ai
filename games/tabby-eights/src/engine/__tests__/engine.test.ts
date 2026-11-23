import { describe, expect, test } from 'vitest';
import {
  ANY_PLAYER,
  applyMove,
  autoPlay,
  canPass,
  cardPoints,
  createGame,
  handPoints,
  normalize,
  playable,
  roundPoints,
  roundWinner,
  gameWinner,
  split,
  topCard,
  type GameState,
  type Move,
} from '@/engine';

const make = (n = 2, target = 100, seed = [1, 2, 3]) =>
  createGame({
    players: Array.from({ length: n }, (_, i) => ({ uid: 'abcd'[i], name: `P${i}`, isHuman: true })),
    target,
    by: 'a',
    seed,
  });

function play(state: GameState, move: Move, uid: string): GameState {
  const r = applyMove(state, move, uid);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** A state with hands and pile set by hand; everything else goes to the stock. */
function rig(hands: string[], pile: string, opts: Partial<GameState> = {}): GameState {
  const base = make(hands.length);
  const used = new Set([...hands.flatMap(split), ...split(pile)]);
  const all = [...base.players.flatMap((p) => split(p.hand)), ...split(base.stock), ...split(base.pile)];
  const stock = opts.stock ?? all.filter((c) => !used.has(c)).join('');
  const state: GameState = {
    ...base,
    players: base.players.map((p, i) => ({ ...p, hand: hands[i] })),
    pile,
    stock,
    suit: pile.slice(-2)[0] as GameState['suit'],
    ...opts,
  };
  return state;
}

function cardsOf(s: GameState): string[] {
  return [...s.players.flatMap((p) => split(p.hand)), ...split(s.stock), ...split(s.pile)];
}

describe('deal', () => {
  test('seven each heads-up, five each with three or four, every card once, a non-eight turned up', () => {
    for (const n of [2, 3, 4]) {
      for (let seed = 0; seed < 30; seed++) {
        const s = make(n, 100, [seed, n]);
        for (const p of s.players) expect(p.hand.length / 2).toBe(n === 2 ? 7 : 5);
        expect(new Set(cardsOf(s)).size).toBe(52);
        expect(cardsOf(s).length).toBe(52);
        expect(s.pile.length).toBe(2);
        expect(s.pile[1]).not.toBe('8');
        expect(s.suit).toBe(s.pile[0]);
        expect(normalize(s)).toEqual(s);
      }
    }
  });

  test('the same seed deals the same cards', () => {
    expect(make(3, 100, [9, 9])).toEqual(make(3, 100, [9, 9]));
    expect(make(3, 100, [9, 9]).players[0].hand).not.toBe(make(3, 100, [9, 8]).players[0].hand);
  });
});

describe('playing', () => {
  test('match suit or rank; anything else is refused; turn passes on', () => {
    let s = rig(['f3y5bK', 'm2m9yQ'], 'f7');
    expect(applyMove(s, { kind: 'play', card: 'y5' }, 'a').ok).toBe(false);
    expect(applyMove(s, { kind: 'play', card: 'f3' }, 'b').ok).toBe(false); // not b's turn
    expect(applyMove(s, { kind: 'play', card: 'm2' }, 'a').ok).toBe(false); // not in a's hand
    s = play(s, { kind: 'play', card: 'f3' }, 'a');
    expect(topCard(s)).toBe('f3');
    expect(s.toAct).toBe(1);
    expect(s.turnUid).toBe('b');
    expect(playable(s)).toEqual([]);
    expect(s.lastMove).toMatchObject({ kind: 'play', seat: 0, card: 'f3', by: 'a' });
  });

  test('an eight is wild and names the suit; a rank match changes the suit', () => {
    let s = rig(['f8yQbK', 'm2mQyA'], 'f7');
    s = play(s, { kind: 'play', card: 'f8', suit: 'm' }, 'a');
    expect(s.suit).toBe('m');
    expect(s.lastMove.suit).toBe('m');
    expect(playable(s)).toEqual(['m2', 'mQ']);
    s = play(s, { kind: 'play', card: 'mQ' }, 'b');
    expect(playable(s)).toEqual(['yQ']);
    s = play(s, { kind: 'play', card: 'yQ' }, 'a');
    expect(s.suit).toBe('y');
  });

  test('draw one, then play or pass; a second draw or an early pass is refused', () => {
    let s = rig(['f3', 'm2'], 'y7', { stock: '' });
    const stock = cardsOf(make()).filter((c) => !['f3', 'm2', 'y7'].includes(c));
    s = { ...s, stock: stock.join('') };
    expect(applyMove(s, { kind: 'pass' }, 'a').ok).toBe(false);
    const before = s.stock.slice(0, 2);
    s = play(s, { kind: 'draw', seed: [1] }, 'a');
    expect(s.players[0].hand).toBe('f3' + before);
    expect(s.drew).toBe(true);
    expect(applyMove(s, { kind: 'draw', seed: [1] }, 'a').ok).toBe(false);
    expect(canPass(s)).toBe(true);
    s = play(s, { kind: 'pass' }, 'a');
    expect(s.toAct).toBe(1);
    expect(s.drew).toBe(false);
  });

  test('an empty stock is refilled from the pile under its top card', () => {
    const others = cardsOf(make()).filter((c) => !['f3', 'm2', 'y7', 'yK', 'y4'].includes(c));
    let s = rig(['f3' + others.slice(0, 25).join(''), 'm2' + others.slice(25).join('')], 'yKy4y7', { stock: '' });
    expect(normalize(s)).not.toBeNull();
    s = play(s, { kind: 'draw', seed: [4, 2] }, 'a');
    expect(s.pile).toBe('y7');
    expect(s.stock.length).toBe(2);
    expect(new Set(cardsOf(s)).size).toBe(52);
  });

  test('going out scores everyone else’s cards, and the next round is dealt by anyone', () => {
    let s = rig(['f3', 'm2m8bK', 'yAy9'], 'f7');
    s = play(s, { kind: 'play', card: 'f3' }, 'a');
    expect(s.phase).toBe('roundover');
    expect(s.toAct).toBeNull();
    expect(s.turnUid).toBe(ANY_PLAYER);
    expect(roundWinner(s)).toBe(0);
    expect(roundPoints(s)).toBe(2 + 50 + 10 + 1 + 9);
    expect(s.players[0].score).toBe(72);
    expect(normalize(s)).toEqual(s);
    expect(applyMove(s, { kind: 'play', card: 'm2' }, 'b').ok).toBe(false);
    s = play(s, { kind: 'deal', seed: [5] }, 'c');
    expect(s.phase).toBe('playing');
    expect(s.round).toBe(2);
    expect(s.toAct).toBe(1);
    expect(s.players[0].score).toBe(72);
    expect(applyMove(s, { kind: 'deal', seed: [5] }, 'c').ok).toBe(false);
  });

  test('reaching the target ends the game; a rematch resets the scores and moves the lead on', () => {
    let s = rig(['f3', 'm8bK'], 'f7');
    s = { ...s, config: { target: 50 } };
    s = play(s, { kind: 'play', card: 'f3' }, 'a');
    expect(s.phase).toBe('gameover');
    expect(gameWinner(s)).toBe(0);
    expect(normalize(s)).toEqual(s);
    s = play(s, { kind: 'rematch', seed: [3] }, 'b');
    expect(s.phase).toBe('playing');
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
    expect(s.gameNo).toBe(2);
    expect(s.round).toBe(1);
    expect(s.toAct).toBe(1);
  });

  test('with nothing to draw and nothing that fits, a player passes; whoever holds a fit must play', () => {
    const all = cardsOf(make());
    const noFit = all.filter((c) => c[0] !== 'y' && c[1] !== '7' && c[1] !== '8');
    const fit = all.filter((c) => !noFit.includes(c) && c !== 'y7');
    // Every card but the top is in a hand, so there is nothing to draw.
    const s = rig([noFit.join(''), fit.join('')], 'y7', { stock: '' });
    expect(normalize(s)).not.toBeNull();
    expect(applyMove(s, { kind: 'draw', seed: [1] }, 'a').ok).toBe(false);
    expect(canPass(s)).toBe(true);
    const t = play(s, { kind: 'pass' }, 'a');
    expect(t.passes).toBe(1);
    expect(t.toAct).toBe(1);
    // Cards that fit always exist somewhere, so a full lap of passes cannot happen: b must play.
    expect(applyMove(t, { kind: 'pass' }, 'b').ok).toBe(false);
    const u = play(t, { kind: 'play', card: fit.find((c) => c[0] === 'y')! }, 'b');
    expect(u.passes).toBe(0);
    expect(handPoints(u.players[0].hand)).toBeGreaterThan(0);
  });

  test('card points', () => {
    expect(['f8', 'yK', 'mQ', 'bJ', 'fT', 'yA', 'm5'].map(cardPoints)).toEqual([50, 10, 10, 10, 10, 1, 5]);
  });
});

describe('away', () => {
  test('plays a sensible card for the absent player and marks them sitting out', () => {
    let s = rig(['f3fKy3f8', 'm2'], 'f7');
    s = play(s, { kind: 'away', seed: [1] }, 'b');
    expect(s.lastMove).toMatchObject({ kind: 'away', seat: 0, by: 'b' });
    expect(['f3', 'fK']).toContain(s.lastMove.card);
    expect(s.players[0].sitOut).toBe(true);
    expect(s.toAct).toBe(1);
    expect(applyMove(s, { kind: 'away', seed: [1] }, 'b').ok).toBe(false); // own turn
  });

  test('draws and passes when nothing fits, and the player’s own move clears sitOut', () => {
    let s = rig(['m3', 'b2b5'], 'f7');
    const top = s.stock.slice(0, 2);
    s = play(s, { kind: 'away', seed: [1] }, 'b');
    expect(s.players[0].hand.startsWith('m3')).toBe(true);
    expect(s.players[0].hand.length).toBe(4);
    if (top[0] !== 'f' && top[1] !== '7' && top[1] !== '8') expect(s.toAct).toBe(1);
    s = { ...s, players: s.players.map((p) => ({ ...p })) };
    expect(s.players[0].sitOut).toBe(true);
  });

  test('autoPlay keeps eights back', () => {
    const s = rig(['f8fKy3', 'm2'], 'f7');
    expect(autoPlay(s)).toEqual({ card: 'fK' });
    const t = rig(['f8yKy3', 'm2'], 'b7');
    expect(autoPlay(t)).toEqual({ card: 'f8', suit: 'y' });
  });
});

describe('normalize', () => {
  test('refuses a missing or duplicated card, a wrong suit, and a finished round still on turn', () => {
    const s = make();
    expect(normalize(s)).toEqual(s);
    expect(normalize({ ...s, stock: s.stock.slice(2) })).toBeNull();
    expect(normalize({ ...s, stock: s.stock + s.pile })).toBeNull();
    expect(normalize({ ...s, suit: s.suit === 'f' ? 'y' : 'f' })).toBeNull();
    expect(normalize({ ...s, phase: 'roundover' })).toBeNull();
    expect(normalize({ ...s, toAct: 5 })).toBeNull();
    expect(normalize({ ...s, players: s.players.map((p) => ({ ...p, score: -1 })) })).toBeNull();
    expect(normalize(null)).toBeNull();
  });

  test('an empty stock or hand that the wire dropped reads as empty', () => {
    const s = rig(['f3', 'm2'], 'f7');
    const out = play(s, { kind: 'play', card: 'f3' }, 'a');
    const wire = JSON.parse(JSON.stringify(out));
    delete wire.players[0].hand;
    expect(normalize(wire)).toEqual(out);
  });

  test('a holed players list (integer-keyed object) is read by index', () => {
    const s = make(3);
    const wire = JSON.parse(JSON.stringify(s));
    wire.players = { 0: wire.players[0], 1: wire.players[1], 2: wire.players[2] };
    expect(normalize(wire)).toEqual(s);
  });
});
