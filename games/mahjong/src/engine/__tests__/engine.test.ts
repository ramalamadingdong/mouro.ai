import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createGame,
  decompositions,
  doraOf,
  riichiPayments,
  scoreRiichi,
  type RiichiContext,
  fullSet,
  isComplete,
  normalize,
  parseMelds,
  scoreHand,
  shuffle,
  tileOf,
  waits,
  type GameState,
  type WinContextLike,
} from './helpers';

const t = (...kinds: number[]) => kinds.map(tileOf).join('');
const man = (...r: number[]) => t(...r.map((x) => x - 1));
const pin = (...r: number[]) => t(...r.map((x) => x + 8));
const sou = (...r: number[]) => t(...r.map((x) => x + 17));
const E = tileOf(27);
const S = tileOf(28);
const RED = tileOf(31);
const GREEN = tileOf(32);
const WHITE = tileOf(33);

const ctx = (concealed: string, extra: Partial<WinContextLike> = {}): WinContextLike => ({
  concealed,
  melds: [],
  flowers: 'I',
  seatWind: 1,
  wind: 0,
  selfDrawn: false,
  lastTile: false,
  afterKong: false,
  robbed: false,
  ...extra,
});

function newGame(seed = 1): GameState {
  return createGame({
    players: [0, 1, 2, 3].map((i) => ({ uid: `u${i}`, name: `P${i}`, isHuman: true })),
    ruleset: 'hk',
    minFaan: 0,
    rounds: 1,
    seed,
    by: 'u0',
  });
}

describe('tiles', () => {
  it('has 144 tiles and shuffles them all', () => {
    expect(fullSet()).toHaveLength(144);
    expect(Array.from(shuffle(fullSet(), 7)).sort().join('')).toBe(Array.from(fullSet()).sort().join(''));
  });
});

describe('hands', () => {
  it('recognises a complete hand and its splits', () => {
    expect(isComplete(man(1, 2, 3) + pin(5, 5, 5) + sou(7, 8, 9) + E + E + E + RED + RED)).toBe(true);
    expect(isComplete(man(1, 2, 3) + pin(5, 5, 5) + sou(7, 8, 9) + E + E + E + RED + GREEN)).toBe(false);
    // 111222333 splits as three pungs or three chows.
    expect(decompositions(man(1, 1, 1, 2, 2, 2, 3, 3, 3) + pin(9, 9)).length).toBeGreaterThan(1);
  });

  it('finds waits', () => {
    expect(waits(man(2, 3, 4, 5, 6, 7) + pin(1, 1, 1) + sou(2, 3) + E + E).sort()).toEqual([sou(1), sou(4)].sort());
  });

  it('recognises thirteen orphans', () => {
    const orphans = man(1, 9) + pin(1, 9) + sou(1, 9) + t(27, 28, 29, 30, 31, 32, 33) + E;
    expect(isComplete(orphans)).toBe(true);
  });
});

describe('scoring', () => {
  it('pure one suit', () => {
    const s = scoreHand(ctx(man(1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 5, 5)));
    expect(s?.lines.map((l) => l[0])).toContain('Pure one suit');
  });
  it('dragon pung and all pungs', () => {
    const s = scoreHand(ctx(man(1, 1, 1) + pin(2, 2, 2) + sou(3, 3, 3) + RED + RED + RED + WHITE + WHITE));
    const names = s?.lines.map((l) => l[0]) ?? [];
    expect(names).toContain('All pungs');
    expect(names).toContain('Red dragon pung');
    expect(names).toContain('Concealed hand');
  });
  it('four concealed pungs self-drawn is a limit', () => {
    const s = scoreHand(ctx(man(1, 1, 1) + pin(2, 2, 2) + sou(3, 3, 3) + RED + RED + RED + WHITE + WHITE, { selfDrawn: true }));
    expect(s?.faan).toBe(10);
  });
  it('great three dragons is a limit', () => {
    const s = scoreHand(ctx(RED + RED + RED + GREEN + GREEN + GREEN + WHITE + WHITE + WHITE + man(1, 2, 3) + S + S));
    expect(s?.faan).toBe(10);
  });
  it('counts melds on the table', () => {
    const melds = parseMelds(`p${E}${E}${E},c${man(1, 2, 3)}`);
    const s = scoreHand(ctx(pin(4, 5, 6, 7, 8, 9) + S + S, { melds, seatWind: 0, flowers: '' }));
    const names = s?.lines.map((l) => l[0]) ?? [];
    expect(names).toContain('Seat wind');
    expect(names).toContain('Round wind');
    expect(names).toContain('No flowers');
    expect(names).not.toContain('Concealed hand');
  });
});

describe('the reducer', () => {
  it('deals 13 to everyone and 14 to the dealer', () => {
    const s = newGame();
    expect(normalize(s)).not.toBeNull();
    expect(s.phase).toBe('turn');
    expect(s.toAct).toBe(0);
    expect(s.players[0].hand.length).toBe(14);
    for (const p of s.players.slice(1)) expect(p.hand.length).toBe(13);
  });

  it('refuses a discard out of turn and a tile not held', () => {
    const s = newGame();
    expect(applyMove(s, { kind: 'discard', seat: 1, tile: s.players[1].hand[0] }, 'u1').ok).toBe(false);
    expect(applyMove(s, { kind: 'discard', seat: 0, tile: s.players[0].hand[0] }, 'u1').ok).toBe(false);
    const missing = Array.from(fullSet()).find((x) => !s.players[0].hand.includes(x)) ?? 'a';
    expect(applyMove(s, { kind: 'discard', seat: 0, tile: missing }, 'u0').ok).toBe(false);
  });

  it('a discard either opens claims or passes the turn on', () => {
    const s = newGame(3);
    const r = applyMove(s, { kind: 'discard', seat: 0, tile: s.players[0].hand[0] }, 'u0');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(normalize(r.state)).not.toBeNull();
    if (r.state.phase === 'claim') expect(r.state.claim?.asks[0]).toBe('.');
    else expect(r.state.toAct).toBe(1);
  });

  it('a hand is drawn when the wall runs out, and the dealer deals again', () => {
    const s0 = newGame(5);
    // Move the whole wall into seat 3's discards: every tile is still present once.
    let s: GameState = { ...s0, wall: '', players: s0.players.map((p, i) => (i === 3 ? { ...p, discards: s0.wall } : p)) };
    expect(normalize(s)).not.toBeNull();
    const r = applyMove(s, { kind: 'discard', seat: 0, tile: s.players[0].hand[0] }, 'u0');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    while (s.phase === 'claim' && s.claim) {
      const seat = s.claim.asks.indexOf('?');
      const a = applyMove(s, { kind: 'claim', seat, call: 'pass' }, `u${seat}`);
      if (!a.ok) throw new Error(a.error);
      s = a.state;
    }
    expect(s.phase).toBe('scored');
    expect(s.result?.winner).toBe(-1);
    const n = applyMove(s, { kind: 'next', seed: 9 }, 'u2');
    expect(n.ok && n.state.dealer).toBe(0);
    expect(n.ok && n.state.handNo).toBe(2);
  });

  it('normalize rejects a missing tile and unbalanced scores', () => {
    const s = newGame();
    expect(normalize({ ...s, wall: s.wall.slice(1) })).toBeNull();
    expect(normalize({ ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, score: 5 } : p)) })).toBeNull();
  });

  it('round-trips through JSON with empty strings dropped', () => {
    const s = newGame();
    const wire = JSON.parse(JSON.stringify(s, (_k, v) => (v === '' || v === null ? undefined : v)));
    expect(normalize(wire)).toEqual(s);
  });
});

describe('riichi scoring', () => {
  const rc = (concealed: string, extra: Partial<RiichiContext> = {}): RiichiContext => ({
    concealed,
    winTile: concealed[concealed.length - 1],
    melds: [],
    tsumo: false,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    seatWind: 1,
    roundWind: 0,
    doraIndicators: E, // points at South: none in these hands
    uraIndicators: '',
    lastTile: false,
    rinshan: false,
    chankan: false,
    firstDraw: false,
    dealer: false,
    ...extra,
  });

  it('pinfu + tanyao ron is 2 han 30 fu, 2000 from a non-dealer', () => {
    const s = scoreRiichi(rc(man(2, 3, 4, 5, 6, 7) + pin(3, 4, 5, 5) + sou(6, 7, 8) + pin(2)));
    expect(s?.lines.map((l) => l[0]).sort()).toEqual(['Pinfu', 'Tanyao']);
    expect(s?.fu).toBe(30);
    expect(riichiPayments(s!.base, 1, 2, 0, 4)[2]).toBe(2000);
  });

  it('a hand with no yaku cannot win', () => {
    expect(scoreRiichi(rc(man(1, 2, 3, 4, 5, 6) + pin(7, 8, 9) + sou(1, 1, 1, 9) + sou(9)))).toBeNull();
  });

  it('riichi gives the same hand a yaku, and dora add han', () => {
    const s = scoreRiichi(
      rc(man(1, 2, 3, 4, 5, 6) + pin(7, 8, 9) + sou(1, 1, 1, 9) + sou(9), { riichi: true, doraIndicators: sou(8) }),
    );
    expect(s?.lines).toContainEqual(['Riichi', 1]);
    expect(s?.lines).toContainEqual(['Dora', 2]);
  });

  it('seven pairs is 25 fu', () => {
    const s = scoreRiichi(rc(man(1, 1, 3, 3) + pin(5, 5, 7, 7) + sou(2, 2, 8, 8) + E + E));
    expect(s?.lines).toContainEqual(['Chiitoitsu', 2]);
    expect(s?.fu).toBe(25);
  });

  it('great three dragons is a yakuman', () => {
    const s = scoreRiichi(rc(RED + RED + RED + GREEN + GREEN + GREEN + WHITE + WHITE + WHITE + man(1, 2, 3) + S + S));
    expect(s?.yakuman).toBe(1);
    expect(s?.base).toBe(8000);
  });

  it('dora indicators wrap: 9 → 1, North → East, red dragon → white', () => {
    expect(doraOf(8)).toBe(0);
    expect(doraOf(30)).toBe(27);
    expect(doraOf(31)).toBe(33);
  });
});

describe('two players', () => {
  it('deals a heads-up Riichi game with a dead wall', () => {
    const s = createGame({
      players: [0, 1].map((i) => ({ uid: `u${i}`, name: `P${i}`, isHuman: true })),
      ruleset: 'riichi',
      minFaan: 0,
      rounds: 1,
      seed: 4,
      by: 'u0',
    });
    expect(s.players).toHaveLength(2);
    expect(s.dora).toHaveLength(5);
    expect(s.rinshan).toHaveLength(4);
    expect(s.wall.length).toBe(136 - 14 - 27);
    expect(normalize(JSON.parse(JSON.stringify(s)))).not.toBeNull();
  });
});
