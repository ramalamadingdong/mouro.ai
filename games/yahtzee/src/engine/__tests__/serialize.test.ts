import { beforeEach, describe, expect, test } from 'vitest';
import { applyMove, initialGameState } from '../reducer';
import { emptyCard } from '../scoring';
import { normalize } from '../serialize';
import { RULES, type GameState } from '../types';

const A = 'uid-a';
const B = 'uid-b';
const PLAYERS = [
  { uid: A, name: 'Ann' },
  { uid: B, name: 'Bob' },
];

function fresh(): GameState {
  return initialGameState(PLAYERS);
}

/** A mid-game state: seat 0 has rolled and is deciding. */
function midGame(): GameState {
  const r = applyMove(fresh(), { kind: 'roll', keep: [], seed: [7] }, A);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** The wire representation: a plain JSON round-trip, as Firebase would deliver. */
function wire(s: GameState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
}

describe('round-trip', () => {
  test('passes a valid state through unchanged', () => {
    const s = midGame();
    expect(normalize(wire(s))).toEqual(s);
  });

  test('is idempotent', () => {
    const once = normalize(wire(midGame()))!;
    expect(normalize(wire(once))).toEqual(once);
  });
});

describe('transport repair', () => {
  let raw: Record<string, unknown>;
  beforeEach(() => {
    raw = wire(fresh());
  });

  test('rebuilds the entire cards node when RTDB prunes it', () => {
    // Every cell of a fresh game is null, so Firebase drops `cards` outright.
    delete raw.cards;
    const n = normalize(raw)!;
    expect(n).not.toBeNull();
    expect(n.cards).toHaveLength(2);
    expect(n.cards[0]).toEqual(emptyCard());
  });

  test('restores pruned empty dice and null fields', () => {
    delete raw.dice;
    delete raw.result;
    delete raw.lastMove;
    delete raw.yahtzeeBonus;
    const n = normalize(raw)!;
    expect(n.dice).toEqual([]);
    expect(n.result).toBeNull();
    expect(n.lastMove).toBeNull();
    expect(n.yahtzeeBonus).toEqual([0, 0]);
  });

  test('coerces integer-keyed objects back to arrays', () => {
    const s = midGame();
    const r = wire(s);
    r.dice = { 0: s.dice[0], 1: s.dice[1], 2: s.dice[2], 3: s.dice[3], 4: s.dice[4] };
    r.players = { 0: s.players[0], 1: s.players[1] };
    expect(normalize(r)).toEqual(s);
  });

  test('rebuilds a pruned card without shifting the seats that survived', () => {
    // Round 1, seat 1 to act: seat 0 has scored, seat 1's card is still all-null
    // and so is dropped in transit. The surviving entry must stay on seat 0.
    const s = fresh();
    s.turn = 1;
    s.turnUid = B;
    s.cards[0].chance = 21;
    const r = wire(s);
    r.cards = { 0: { chance: 21 } };
    const n = normalize(r)!;
    expect(n.cards[0].chance).toBe(21);
    expect(n.cards[1]).toEqual(emptyCard());
  });

  test('never compacts a sparse seat-indexed node onto the wrong seat', () => {
    // The same state with the surviving card mis-keyed to seat 1. Reading by
    // sorted key (rather than by explicit index) would slide it onto seat 0 and
    // hand one player another's scorecard; reading by index detects the damage.
    const s = fresh();
    s.turn = 1;
    s.turnUid = B;
    s.cards[0].chance = 21;
    const r = wire(s);
    r.cards = { 1: { chance: 21 } };
    expect(normalize(r)).toBeNull();
  });
});

describe('falsy-but-valid values', () => {
  test('preserves a scratched category of 0', () => {
    // 0 means the box was USED and scored nothing. `Number(x) || null` would
    // silently re-open it, handing the player a free extra category — and the
    // round/turn box-count invariant would then reject the whole snapshot.
    const s = fresh();
    s.round = 2;
    s.cards[0].yahtzee = 0;
    s.cards[1].chance = 12;
    const n = normalize(wire(s))!;
    expect(n).not.toBeNull();
    expect(n.cards[0].yahtzee).toBe(0);
    expect(n.cards[0].chance).toBeNull();
  });

  test('preserves turn 0, rollsUsed 0 and version 0', () => {
    const n = normalize(wire(fresh()))!;
    expect(n.turn).toBe(0);
    expect(n.rollsUsed).toBe(0);
    expect(n.version).toBe(0);
  });

  test('preserves lastMove.points of 0', () => {
    const s = midGame();
    s.lastMove = { by: A, seat: 0, kind: 'score', category: 'yahtzee', points: 0, at: 1 };
    expect(normalize(wire(s))!.lastMove!.points).toBe(0);
  });
});

describe('rejection', () => {
  test('rejects non-objects and empty shapes', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(42)).toBeNull();
    expect(normalize('x')).toBeNull();
    expect(normalize({})).toBeNull();
    expect(normalize({ players: [] })).toBeNull();
  });

  test('rejects more players than the table seats', () => {
    const raw = wire(fresh());
    raw.players = Array.from({ length: RULES.MAX_PLAYERS + 1 }, (_, i) => ({
      uid: `u${i}`,
      name: 'x',
    }));
    expect(normalize(raw)).toBeNull();
  });

  test('rejects a turnUid that disagrees with players[turn]', () => {
    const raw = wire(fresh());
    raw.turnUid = B; // turn is still seat 0
    expect(normalize(raw)).toBeNull();
  });

  test('rejects impossible dice', () => {
    const raw = wire(midGame());
    raw.dice = [1, 2, 3];
    expect(normalize(raw)).toBeNull();
    raw.dice = [1, 2, 3, 4, 7];
    expect(normalize(raw)).toBeNull();
  });

  test('rejects a phase that disagrees with the dice on the table', () => {
    const raw = wire(fresh());
    raw.phase = 'decide'; // no dice, no rolls used
    expect(normalize(raw)).toBeNull();

    const raw2 = wire(midGame());
    raw2.phase = 'roll'; // dice are on the table
    expect(normalize(raw2)).toBeNull();
  });

  test('rejects a terminal phase without a result, and a result without one', () => {
    const raw = wire(midGame());
    raw.phase = 'over';
    expect(normalize(raw)).toBeNull();

    const raw2 = wire(midGame());
    raw2.result = { scores: [], winners: [0] };
    expect(normalize(raw2)).toBeNull();
  });

  test('rejects a result whose totals do not reconcile with the cards', () => {
    // Without this check a client could write a well-formed state that simply
    // claims a higher score than its own scorecard supports.
    const full = () => {
      const c = emptyCard();
      for (const cat of Object.keys(c) as (keyof typeof c)[]) c[cat] = 0;
      return c;
    };
    const s: GameState = {
      ...fresh(),
      phase: 'over',
      round: RULES.ROUNDS + 1,
      cards: [full(), full()],
      result: {
        scores: [
          { upper: 0, bonus: 0, lower: 0, yahtzeeBonus: 0, total: 0 },
          { upper: 0, bonus: 0, lower: 0, yahtzeeBonus: 0, total: 0 },
        ],
        winners: [0, 1],
      },
    };
    expect(normalize(wire(s))).not.toBeNull();

    s.result!.scores[0].total = 999;
    expect(normalize(wire(s))).toBeNull();
  });

  test('rejects a card holding more filled boxes than the round allows', () => {
    // Seat 0 claims thirteen scored categories in round 1 — i.e. twelve turns
    // it never took. The count is exactly determined by round/turn, so this is
    // catchable rather than merely implausible.
    const raw = wire(fresh());
    const bogus: Record<string, number> = {};
    for (const cat of Object.keys(emptyCard())) bogus[cat] = 1;
    raw.cards = [bogus, {}];
    expect(normalize(raw)).toBeNull();
  });

  test('rejects a seat that skipped its turn', () => {
    // Round 2, turn 0 means BOTH seats must have exactly one box filled.
    const s = fresh();
    s.round = 2;
    s.cards[0].chance = 10;
    expect(normalize(wire(s))).toBeNull();
    s.cards[1].chance = 10;
    expect(normalize(wire(s))).not.toBeNull();
  });

  test('drops a lastMove with an unknown kind without failing the state', () => {
    const raw = wire(midGame());
    raw.lastMove = { by: A, seat: 0, kind: 'BOGUS', at: 1 };
    const n = normalize(raw);
    expect(n).not.toBeNull();
    expect(n!.lastMove).toBeNull();
  });
});
