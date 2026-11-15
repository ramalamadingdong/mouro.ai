import { describe, expect, test } from 'vitest';
import {
  RULES,
  applyMove,
  autoMove,
  createGame,
  floorCats,
  normalize,
  orient,
  parseFloor,
  parseMarket,
  placements,
  gridOf,
  roundOf,
  scores,
  seatOnTurn,
  tally,
  turnsTaken,
  winners,
  SHAPES,
  type GameState,
  type Rnd,
} from '..';

/** A small deterministic generator, so every test game is repeatable. */
function seeded(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ uid: `u${i}`, name: `P${i}`, isHuman: true }));
const newGame = (n: number, seed = 1) => createGame({ players: people(n), by: 'u0', rnd: seeded(seed) });

/** Play the table's own choice for whoever is on turn until the game ends. */
function playOut(state: GameState, rnd: Rnd): GameState {
  let s = state;
  while (s.toAct !== null) {
    const r = applyMove(s, autoMove(s), s.players[s.toAct].uid, rnd);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

describe('tiles', () => {
  test('every shape keeps its size in all eight orientations and starts at the origin', () => {
    SHAPES.forEach((shape, i) => {
      for (let o = 0; o < 8; o++) {
        const cells = orient(i, o);
        expect(cells).toHaveLength(shape.cells.length);
        expect(Math.min(...cells.map((c) => c[0]))).toBe(0);
        expect(Math.min(...cells.map((c) => c[1]))).toBe(0);
        expect(new Set(cells.map((c) => c.join())).size).toBe(cells.length);
      }
    });
  });

  test('a floor string refuses overlaps, walls and junk', () => {
    expect(parseFloor('')).toEqual([]);
    expect(parseFloor('g1000')?.[0].cells).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(parseFloor('g1000s0100')).toBeNull(); // second cat lands on the first
    expect(parseFloor('g1050')).toBeNull(); // three long, starting in column 5 of 7
    expect(parseFloor('x1000')).toBeNull();
    expect(parseFloor('g100')).toBeNull();
  });

  test('placements never repeats a position that looks the same', () => {
    // The loaf is a 2×2 square: one look, 36 spots on an empty 7×7 floor.
    expect(placements(gridOf([]), { coat: 'g', shape: 3 })).toHaveLength(36);
    // The napper is a domino: two looks.
    expect(placements(gridOf([]), { coat: 'g', shape: 0 })).toHaveLength(2 * 6 * 7);
  });
});

describe('scoring', () => {
  test('pairs count once per two cats, rivals cost, full rows pay', () => {
    // Two ginger long cats side by side along row 0 share one border: one pair.
    const cats = parseFloor('g4000g1040') ?? [];
    expect(tally(cats)).toMatchObject({ friends: 1, spats: 0, rows: 1, total: 2 + 5 });
    // A smoke cat under both of them touches two rivals: two spats.
    const more = parseFloor('g4000g1040s4021') ?? [];
    expect(tally(more)).toMatchObject({ friends: 1, spats: 2, total: 2 + 5 - 6 });
    expect(tally(more).mood).toEqual(['grumpy', 'grumpy', 'grumpy']);
  });

  test('two cats sharing a long border are still one pair', () => {
    const cats = parseFloor('w4000w4001') ?? [];
    expect(tally(cats).friends).toBe(1);
  });
});

describe('turn order', () => {
  test('the first pick moves one seat along each round', () => {
    const order = Array.from({ length: 9 }, (_, p) => seatOnTurn(p, 3, 0));
    expect(order).toEqual([0, 1, 2, 1, 2, 0, 2, 0, 1]);
    expect(seatOnTurn(RULES.ROUNDS * 3, 3, 0)).toBeNull();
  });

  test('turnsTaken agrees with seatOnTurn', () => {
    for (const n of [2, 3, 4]) {
      for (const starter of [0, n - 1]) {
        const taken = new Array<number>(n).fill(0);
        for (let p = 0; p <= RULES.ROUNDS * n; p++) {
          for (let seat = 0; seat < n; seat++) expect(turnsTaken(p, n, starter, seat)).toBe(taken[seat]);
          const seat = seatOnTurn(p, n, starter);
          if (seat !== null) taken[seat]++;
        }
      }
    }
  });
});

describe('the reducer', () => {
  test('a new game has players + 2 cats at the door, all different', () => {
    for (const n of [2, 3, 4]) {
      const s = newGame(n);
      const tiles = parseMarket(s.market);
      expect(tiles).toHaveLength(n + 2);
      expect(tiles.every(Boolean)).toBe(true);
      expect(new Set(s.market.match(/../g)).size).toBe(n + 2);
      expect(normalize(s)).toEqual(s);
    }
  });

  test('only the player on turn may pick, and only a cat that is there and fits', () => {
    const s = newGame(2);
    expect(applyMove(s, { kind: 'pass', slot: 0 }, 'u1', seeded(2))).toMatchObject({ ok: false });
    expect(applyMove(s, { kind: 'pass', slot: 9 }, 'u0', seeded(2))).toMatchObject({ ok: false });
    expect(applyMove(s, { kind: 'seat', slot: 0, orient: 0, x: 6, y: 6 }, 'u0', seeded(2)).ok).toBe(
      SHAPES[parseMarket(s.market)[0]!.shape].cells.length === 1,
    );
    expect(applyMove(s, { kind: 'seat', slot: 0, orient: 8, x: 0, y: 0 }, 'u0', seeded(2))).toMatchObject({ ok: false });
    expect(applyMove(s, { kind: 'pass', slot: 0 }, 'stranger', seeded(2))).toMatchObject({ ok: false });

    const r = applyMove(s, { kind: 'seat', slot: 0, orient: 0, x: 0, y: 0 }, 'u0', seeded(2));
    if (!r.ok) throw new Error(r.error);
    expect(r.state.floors[0]).toBe(`${s.market.slice(0, 2)}000`);
    expect(r.state.market.slice(0, 2)).toBe('..');
    expect(r.state).toMatchObject({ version: 2, picks: 1, toAct: 1, turnUid: 'u1' });
    expect(r.state.lastMove).toMatchObject({ by: 'u0', kind: 'seat', seat: 0, tile: s.market.slice(0, 2) });
    // Same slot again: gone.
    expect(applyMove(r.state, { kind: 'pass', slot: 0 }, 'u1', seeded(2))).toMatchObject({ ok: false });
    // A cat cannot land on another.
    const again = applyMove(r.state, { kind: 'pass', slot: 1 }, 'u1', seeded(2));
    if (!again.ok) throw new Error(again.error);
    expect(again.state.market).not.toContain('..'); // round over: the door is full again
    expect(applyMove(again.state, { kind: 'seat', slot: 0, orient: 0, x: 0, y: 0 }, 'u1', seeded(2)).ok).toBe(true);
    expect(roundOf(again.state)).toBe(2);
    expect(again.state.toAct).toBe(1); // round two: the other player picks first
  });

  test('a whole game runs to twelve rounds for 2, 3 and 4 players, and every state on the way is valid', () => {
    for (const n of [2, 3, 4]) {
      const rnd = seeded(40 + n);
      let s = newGame(n, n);
      let steps = 0;
      while (s.toAct !== null) {
        const r = applyMove(s, autoMove(s), s.players[s.toAct].uid, rnd);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
        steps++;
        // Through the wire and back, exactly as a client would see it.
        expect(normalize(JSON.parse(JSON.stringify(s)))).toEqual(s);
      }
      expect(steps).toBe(RULES.ROUNDS * n);
      expect(s).toMatchObject({ phase: 'gameover', toAct: null, turnUid: '*' });
      expect(winners(s).length).toBeGreaterThan(0);
      expect(scores(s)).toHaveLength(n);
      for (let seat = 0; seat < n; seat++) expect(floorCats(s, seat).length).toBeLessThanOrEqual(RULES.ROUNDS);
    }
  });

  test('away moves for the absent player, marks them, and their own move clears it', () => {
    const s = newGame(3);
    expect(applyMove(s, { kind: 'away' }, 'u0', seeded(3))).toMatchObject({ ok: false }); // not for yourself
    const r = applyMove(s, { kind: 'away' }, 'u2', seeded(3));
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0].sitOut).toBe(true);
    expect(r.state.lastMove).toMatchObject({ by: 'u2', kind: 'away', seat: 0 });
    expect(floorCats(r.state, 0)).toHaveLength(1);
    // Round the table and back to seat 0 (round two starts with seat 1).
    let t = r.state;
    for (const uid of ['u1', 'u2', 'u1', 'u2']) {
      const step = applyMove(t, autoMove(t), uid, seeded(4));
      if (!step.ok) throw new Error(step.error);
      t = step.state;
    }
    expect(t.toAct).toBe(0);
    const back = applyMove(t, autoMove(t), 'u0', seeded(5));
    if (!back.ok) throw new Error(back.error);
    expect(back.state.players[0].sitOut).toBe(false);
  });

  test('rematch only after the game, and the next seat picks first', () => {
    const s = newGame(2);
    expect(applyMove(s, { kind: 'rematch' }, 'u0', seeded(6))).toMatchObject({ ok: false });
    const done = playOut(s, seeded(7));
    const r = applyMove(done, { kind: 'rematch' }, 'u1', seeded(8));
    if (!r.ok) throw new Error(r.error);
    expect(r.state).toMatchObject({ picks: 0, starter: 1, toAct: 1, gameNo: 2, floors: ['', ''], phase: 'playing' });
    expect(r.state.version).toBe(done.version + 1);
    expect(normalize(r.state)).toEqual(r.state);
  });
});

describe('normalize', () => {
  const good = (): GameState => {
    const s = newGame(2);
    const r = applyMove(s, { kind: 'seat', slot: 0, orient: 0, x: 0, y: 0 }, 'u0', seeded(9));
    if (!r.ok) throw new Error(r.error);
    return r.state;
  };

  test('refuses what the game could not have produced', () => {
    const s = good();
    expect(normalize(s)).toEqual(s);
    expect(normalize(null)).toBeNull();
    expect(normalize({ ...s, version: 0 })).toBeNull();
    expect(normalize({ ...s, players: [s.players[0]] })).toBeNull();
    expect(normalize({ ...s, phase: 'gameover' })).toBeNull();
    expect(normalize({ ...s, picks: 99 })).toBeNull();
    // A cat nobody had the turns to seat.
    expect(normalize({ ...s, floors: [s.floors[0], 'g0000'] })).toBeNull();
    expect(normalize({ ...s, floors: [`${s.floors[0]}g0066`, ''] })).toBeNull();
    // Overlapping cats.
    expect(normalize({ ...s, floors: [s.floors[0].repeat(2), ''] })).toBeNull();
    // The door must be missing exactly the cats taken this round.
    expect(normalize({ ...s, market: s.market.replace('..', 'g1') })).toBeNull();
    expect(normalize({ ...s, market: `${s.market}g1` })).toBeNull();
    expect(normalize({ ...s, market: s.market.replace(/[gstw]\d$/, 'zz') })).toBeNull();
  });

  test('the turn is derived, not trusted, and a missing empty floor is read as empty', () => {
    const s = good();
    const tampered = normalize({ ...s, toAct: 0, turnUid: 'u0' });
    expect(tampered).toMatchObject({ toAct: 1, turnUid: 'u1' });
    // What the database returns: empty strings may be dropped, arrays may come back as objects.
    const wire = { ...s, floors: { 0: s.floors[0] }, players: { 0: s.players[0], 1: s.players[1] } };
    expect(normalize(wire)).toEqual(s);
  });
});
