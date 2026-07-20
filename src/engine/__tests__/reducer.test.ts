import { describe, expect, test } from 'vitest';
import { applyMove, initialGameState, legalCategories, legalMoves, seatOf } from '../reducer';
import { emptyCard } from '../scoring';
import { RULES, type ApplyResult, type GameState } from '../types';

const A = 'uid-a';
const B = 'uid-b';
const SEED = [1, 2, 3];

const PLAYERS = [
  { uid: A, name: 'Ann' },
  { uid: B, name: 'Bob' },
];

/** Build a controlled state; the caller supplies whatever fields matter. */
function base(over: Partial<GameState> = {}): GameState {
  const s = initialGameState(PLAYERS);
  const merged = { ...s, ...over };
  // Keep the denormalization honest so tests never assert against a state the
  // reducer could not have produced.
  merged.turnUid = merged.players[merged.turn].uid;
  return merged;
}

function ok(r: ApplyResult): GameState {
  if (!r.ok) throw new Error('expected ok, got: ' + r.error);
  return r.state;
}

function err(r: ApplyResult): string {
  if (r.ok) throw new Error('expected a rejection, got ok');
  return r.error;
}

describe('initialGameState', () => {
  test('opens every box and seats the host first', () => {
    const s = initialGameState(PLAYERS);
    expect(s.turn).toBe(0);
    expect(s.turnUid).toBe(A);
    expect(s.phase).toBe('roll');
    expect(s.round).toBe(1);
    expect(s.version).toBe(0);
    expect(s.dice).toEqual([]);
    expect(s.cards).toHaveLength(2);
    expect(s.cards[0]).toEqual(emptyCard());
    expect(s.yahtzeeBonus).toEqual([0, 0]);
    expect(s.result).toBeNull();
  });

  test('seatOf maps uids to indices', () => {
    const s = initialGameState(PLAYERS);
    expect(seatOf(s, A)).toBe(0);
    expect(seatOf(s, B)).toBe(1);
    expect(seatOf(s, 'stranger')).toBeNull();
  });
});

describe('purity and commit', () => {
  test('does not mutate its input', () => {
    const s = base();
    const snapshot = JSON.stringify(s);
    applyMove(s, { kind: 'roll', keep: [], seed: SEED }, A);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  test('bumps version and stamps lastMove', () => {
    const s = base({ version: 7 });
    const next = ok(applyMove(s, { kind: 'roll', keep: [], seed: SEED }, A));
    expect(next.version).toBe(8);
    expect(next.lastMove?.by).toBe(A);
    expect(next.lastMove?.seat).toBe(0);
    expect(next.lastMove?.kind).toBe('roll');
    // Optional fields must be absent, not undefined — Firebase rejects undefined.
    expect('category' in next.lastMove!).toBe(false);
  });

  test('turnUid follows turn on every commit', () => {
    let s = base();
    s = ok(applyMove(s, { kind: 'roll', keep: [], seed: SEED }, A));
    s = ok(applyMove(s, { kind: 'score', category: 'chance' }, A));
    expect(s.turn).toBe(1);
    expect(s.turnUid).toBe(B);
  });
});

describe('rolling', () => {
  test('the first roll fills all five dice', () => {
    const s = ok(applyMove(base(), { kind: 'roll', keep: [], seed: SEED }, A));
    expect(s.dice).toHaveLength(RULES.DICE);
    expect(s.dice.every((d) => d >= 1 && d <= RULES.FACES)).toBe(true);
    expect(s.rollsUsed).toBe(1);
    expect(s.phase).toBe('decide');
  });

  test('is deterministic in the seed', () => {
    const a = ok(applyMove(base(), { kind: 'roll', keep: [], seed: [9, 9] }, A));
    const b = ok(applyMove(base(), { kind: 'roll', keep: [], seed: [9, 9] }, A));
    expect(a.dice).toEqual(b.dice);
  });

  test('kept dice hold their positions', () => {
    const s = base({ phase: 'decide', rollsUsed: 1, dice: [6, 1, 2, 3, 4] });
    const next = ok(applyMove(s, { kind: 'roll', keep: [0, 1], seed: SEED }, A));
    expect(next.dice[0]).toBe(6);
    expect(next.dice[1]).toBe(1);
    expect(next.rollsUsed).toBe(2);
  });

  test('rejects a fourth roll', () => {
    const s = base({ phase: 'decide', rollsUsed: RULES.ROLLS_PER_TURN, dice: [1, 2, 3, 4, 5] });
    expect(err(applyMove(s, { kind: 'roll', keep: [], seed: SEED }, A))).toMatch(/no rolls left/);
    expect(legalMoves(s, A)).toEqual(['score']);
  });

  test('rejects malformed keep sets', () => {
    const s = base({ phase: 'decide', rollsUsed: 1, dice: [1, 2, 3, 4, 5] });
    expect(err(applyMove(s, { kind: 'roll', keep: [0, 0], seed: SEED }, A))).toMatch(/duplicate/);
    expect(err(applyMove(s, { kind: 'roll', keep: [5], seed: SEED }, A))).toMatch(/bad keep/);
    expect(err(applyMove(s, { kind: 'roll', keep: [-1], seed: SEED }, A))).toMatch(/bad keep/);
    // Keeping every die burns a roll and changes nothing — always a misclick.
    expect(err(applyMove(s, { kind: 'roll', keep: [0, 1, 2, 3, 4], seed: SEED }, A))).toMatch(
      /every die/,
    );
  });

  test('rejects keeping dice that have not been rolled yet', () => {
    expect(err(applyMove(base(), { kind: 'roll', keep: [0], seed: SEED }, A))).toMatch(
      /nothing to keep/,
    );
  });
});

describe('authorization', () => {
  test('rejects a move from the player who is not on turn', () => {
    expect(err(applyMove(base(), { kind: 'roll', keep: [], seed: SEED }, B))).toBe('not your turn');
    expect(legalMoves(base(), B)).toEqual([]);
  });

  test('rejects a move from a non-player', () => {
    expect(err(applyMove(base(), { kind: 'roll', keep: [], seed: SEED }, 'x'))).toBe('not a player');
  });

  test('rejects scoring before rolling', () => {
    expect(err(applyMove(base(), { kind: 'score', category: 'chance' }, A))).toMatch(/roll the dice/);
    expect(legalMoves(base(), A)).toEqual(['roll']);
  });

  test('rejects reusing a filled box', () => {
    const card = emptyCard();
    card.chance = 12;
    const s = base({ phase: 'decide', rollsUsed: 1, dice: [1, 2, 3, 4, 5], cards: [card, emptyCard()] });
    expect(err(applyMove(s, { kind: 'score', category: 'chance' }, A))).toMatch(/already used/);
    expect(legalCategories(s, 0)).not.toContain('chance');
  });
});

describe('scoring a turn', () => {
  test('writes the points and passes the turn', () => {
    const s = base({ phase: 'decide', rollsUsed: 2, dice: [5, 5, 5, 2, 2] });
    const next = ok(applyMove(s, { kind: 'score', category: 'fullHouse' }, A));
    expect(next.cards[0].fullHouse).toBe(RULES.FULL_HOUSE);
    expect(next.turn).toBe(1);
    expect(next.phase).toBe('roll');
    expect(next.dice).toEqual([]);
    expect(next.rollsUsed).toBe(0);
    expect(next.lastMove?.category).toBe('fullHouse');
    expect(next.lastMove?.points).toBe(RULES.FULL_HOUSE);
  });

  test('scratching a category records 0, not an open box', () => {
    const s = base({ phase: 'decide', rollsUsed: 3, dice: [1, 2, 3, 4, 6] });
    const next = ok(applyMove(s, { kind: 'score', category: 'yahtzee' }, A));
    // 0 is a USED box. Anything that treats it as falsy re-opens the category.
    expect(next.cards[0].yahtzee).toBe(0);
    expect(legalCategories(next, 0)).not.toContain('yahtzee');
  });

  test('the round advances only when play wraps to seat 0', () => {
    let s = base({ phase: 'decide', rollsUsed: 1, dice: [1, 1, 1, 1, 2] });
    s = ok(applyMove(s, { kind: 'score', category: 'ones' }, A));
    expect(s.round).toBe(1);
    s = { ...s, phase: 'decide', rollsUsed: 1, dice: [2, 2, 2, 2, 3] };
    s = ok(applyMove(s, { kind: 'score', category: 'twos' }, B));
    expect(s.round).toBe(2);
    expect(s.turn).toBe(0);
  });
});

describe('yahtzee bonuses and joker rules', () => {
  /** A card with the Yahtzee box already resolved to `value`. */
  function withYahtzee(value: number) {
    const card = emptyCard();
    card.yahtzee = value;
    return card;
  }

  test('a second Yahtzee pays the bonus once the box holds 50', () => {
    const s = base({
      phase: 'decide',
      rollsUsed: 1,
      dice: [4, 4, 4, 4, 4],
      cards: [withYahtzee(RULES.YAHTZEE), emptyCard()],
    });
    // The matching upper box is open, so the joker rule forces it.
    expect(legalCategories(s, 0)).toEqual(['fours']);
    const next = ok(applyMove(s, { kind: 'score', category: 'fours' }, A));
    expect(next.cards[0].fours).toBe(20); // five 4s
    expect(next.yahtzeeBonus[0]).toBe(1);
  });

  test('a scratched Yahtzee box still triggers jokers but pays NO bonus', () => {
    const s = base({
      phase: 'decide',
      rollsUsed: 1,
      dice: [4, 4, 4, 4, 4],
      cards: [withYahtzee(0), emptyCard()],
    });
    expect(legalCategories(s, 0)).toEqual(['fours']);
    const next = ok(applyMove(s, { kind: 'score', category: 'fours' }, A));
    expect(next.yahtzeeBonus[0]).toBe(0);
  });

  test('with the matching upper box full, any open lower box is legal', () => {
    const card = withYahtzee(RULES.YAHTZEE);
    card.fours = 8;
    const s = base({
      phase: 'decide',
      rollsUsed: 1,
      dice: [4, 4, 4, 4, 4],
      cards: [card, emptyCard()],
    });
    const legal = legalCategories(s, 0);
    expect(legal).toContain('fullHouse');
    expect(legal).toContain('chance');
    // Upper boxes stay off-limits while any lower box is open.
    expect(legal).not.toContain('ones');

    // Joker payout: a five-of-a-kind is not a natural full house, but scores 25.
    const next = ok(applyMove(s, { kind: 'score', category: 'fullHouse' }, A));
    expect(next.cards[0].fullHouse).toBe(RULES.FULL_HOUSE);
    expect(next.yahtzeeBonus[0]).toBe(1);
  });

  test('with the lower section full, the Yahtzee must scratch an upper box', () => {
    const card = emptyCard();
    for (const cat of ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'] as const) {
      card[cat] = 0;
    }
    card.fours = 8; // matching upper box also taken
    const s = base({
      phase: 'decide',
      rollsUsed: 1,
      dice: [4, 4, 4, 4, 4],
      cards: [card, emptyCard()],
    });
    const legal = legalCategories(s, 0);
    expect(legal).toContain('ones');
    expect(legal).not.toContain('fours');
    // The Yahtzee box holds 0, so no bonus even though a Yahtzee was rolled.
    const next = ok(applyMove(s, { kind: 'score', category: 'ones' }, A));
    expect(next.cards[0].ones).toBe(0);
    expect(next.yahtzeeBonus[0]).toBe(0);
  });

  test('rejects a category the joker rule forbids', () => {
    const s = base({
      phase: 'decide',
      rollsUsed: 1,
      dice: [4, 4, 4, 4, 4],
      cards: [withYahtzee(RULES.YAHTZEE), emptyCard()],
    });
    expect(err(applyMove(s, { kind: 'score', category: 'chance' }, A))).toMatch(/joker/);
  });

  test('the FIRST Yahtzee is unconstrained and pays no bonus', () => {
    const s = base({ phase: 'decide', rollsUsed: 1, dice: [4, 4, 4, 4, 4] });
    // The box is open, so the player may take 50 or bank it anywhere.
    expect(legalCategories(s, 0)).toHaveLength(RULES.ROUNDS);
    const next = ok(applyMove(s, { kind: 'score', category: 'yahtzee' }, A));
    expect(next.cards[0].yahtzee).toBe(RULES.YAHTZEE);
    expect(next.yahtzeeBonus[0]).toBe(0);
  });
});

describe('game end and rematch', () => {
  /** A state one score away from the end, with both cards otherwise full. */
  function nearlyDone(): GameState {
    const full = () => {
      const c = emptyCard();
      for (const cat of Object.keys(c) as (keyof typeof c)[]) c[cat] = 0;
      return c;
    };
    const last = full();
    last.chance = null;
    return base({
      phase: 'decide',
      rollsUsed: 1,
      dice: [6, 6, 6, 6, 6],
      turn: 1,
      round: RULES.ROUNDS,
      cards: [full(), last],
      yahtzeeBonus: [0, 0],
    });
  }

  test('ends once every card is full and picks the winner', () => {
    const s = ok(applyMove(nearlyDone(), { kind: 'score', category: 'chance' }, B));
    expect(s.phase).toBe('over');
    expect(s.round).toBe(RULES.ROUNDS + 1);
    expect(s.result).not.toBeNull();
    expect(s.result!.scores[1].total).toBe(30);
    expect(s.result!.winners).toEqual([1]);
  });

  test('reports every seat on a tie', () => {
    // Both seats owe only `chance` in the final round, and both roll 30. The
    // state must stay reachable: at round N with turn 0, every seat has played
    // N-1 turns, so both cards hold exactly ROUNDS-1 filled boxes.
    const owed = () => {
      const c = emptyCard();
      for (const cat of Object.keys(c) as (keyof typeof c)[]) c[cat] = 0;
      c.chance = null;
      return c;
    };
    const start = base({
      phase: 'decide',
      rollsUsed: 1,
      dice: [6, 6, 6, 6, 6],
      turn: 0,
      round: RULES.ROUNDS,
      cards: [owed(), owed()],
    });

    const mid = ok(applyMove(start, { kind: 'score', category: 'chance' }, A));
    // Seat 1 has not played this round, so the game is not over yet.
    expect(mid.phase).toBe('roll');
    expect(mid.round).toBe(RULES.ROUNDS);

    const done = ok(
      applyMove(
        { ...mid, phase: 'decide', rollsUsed: 1, dice: [6, 6, 6, 6, 6] },
        { kind: 'score', category: 'chance' },
        B,
      ),
    );
    expect(done.phase).toBe('over');
    expect(done.result!.scores[0].total).toBe(30);
    expect(done.result!.scores[1].total).toBe(30);
    expect(done.result!.winners).toEqual([0, 1]);
  });

  test('rematch resets the board and is legal for either player', () => {
    const over = ok(applyMove(nearlyDone(), { kind: 'score', category: 'chance' }, B));
    expect(legalMoves(over, A)).toEqual(['rematch']);
    expect(legalMoves(over, B)).toEqual(['rematch']);
    // Either player may start it — not just whoever was on turn.
    const fresh = ok(applyMove(over, { kind: 'rematch' }, A));
    expect(fresh.phase).toBe('roll');
    expect(fresh.round).toBe(1);
    expect(fresh.turn).toBe(0);
    expect(fresh.cards[0]).toEqual(emptyCard());
    expect(fresh.result).toBeNull();
    // Version keeps climbing across the reset — the rules require monotonicity.
    expect(fresh.version).toBe(over.version + 1);
  });

  test('rejects play after the game is over, and rematch before it', () => {
    const over = ok(applyMove(nearlyDone(), { kind: 'score', category: 'chance' }, B));
    expect(err(applyMove(over, { kind: 'roll', keep: [], seed: SEED }, A))).toBe('the game is over');
    expect(err(applyMove(base(), { kind: 'rematch' }, A))).toMatch(/not over/);
  });
});

describe('solo play', () => {
  test('a single seat plays every round alone', () => {
    let s = initialGameState([{ uid: A, name: 'Ann' }]);
    expect(s.players).toHaveLength(1);
    for (let i = 0; i < RULES.ROUNDS; i++) {
      s = ok(applyMove(s, { kind: 'roll', keep: [], seed: [i + 1] }, A));
      const cat = legalCategories(s, 0)[0];
      s = ok(applyMove(s, { kind: 'score', category: cat }, A));
    }
    expect(s.phase).toBe('over');
    expect(s.result!.winners).toEqual([0]);
  });
});
