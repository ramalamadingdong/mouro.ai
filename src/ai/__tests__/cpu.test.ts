import {
  applyMove,
  initialMatchState,
  legalMoves,
  type CardId,
  type GameState,
  type Move,
} from '@/engine';
import { chooseMove } from '@/ai/cpu';

const C = (suit: number, rank: number): CardId => suit * 13 + rank;

const H = 'HUMAN_UID';
const G = 'CPU_UID';

/** Build a controlled state; caller supplies whatever fields matter. */
function base(over: Partial<GameState> = {}): GameState {
  const s: GameState = {
    version: 5,
    players: { p0: H, p1: G },
    names: { p0: 'You', p1: 'Computer' },
    target: 100,
    scores: { p0: 0, p1: 0 },
    boxes: { p0: 0, p1: 0 },
    round: 3,
    dealer: 'p1',
    phase: 'discard',
    turn: 'p0',
    turnUid: H,
    noDiscard: null,
    stock: [13, 14, 15],
    discard: [16],
    hands: { p0: [], p1: [] },
    roundResult: null,
    matchResult: null,
    lastMove: null,
  };
  const merged = { ...s, ...over };
  merged.turnUid = merged.players[merged.turn];
  return merged;
}

function ok(r: ReturnType<typeof applyMove>): GameState {
  if (!r.ok) throw new Error('expected ok, got: ' + r.error);
  return r.state;
}

/** Every committed state conserves the 52-card deck. */
function assertConserved(s: GameState) {
  const all = [...s.hands.p0, ...s.hands.p1, ...s.stock, ...s.discard];
  expect(new Set(all).size).toBe(52);
}

describe('discard-phase selection', () => {
  test('big gin when all 11 cards meld', () => {
    // A-8 clubs (run) + three 10s.
    const p0 = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4), C(0, 5), C(0, 6), C(0, 7),
      C(0, 9), C(1, 9), C(2, 9),
    ];
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1: [] } });
    expect(legalMoves(s, H)).toContain('bigGin');
    expect(chooseMove(s, H).kind).toBe('bigGin');
  });

  test('knocks with the deadwood-0 discard (gin)', () => {
    // A-7 clubs (run) + three 9s + K spades. Discard K spades -> gin.
    const p0 = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4), C(0, 5), C(0, 6),
      C(0, 8), C(1, 8), C(2, 8), C(3, 12),
    ];
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1: [] } });
    const move = chooseMove(s, H);
    expect(move).toEqual({ kind: 'knock', discard: C(3, 12) });
  });

  test('discards the min-deadwood card and never the just-taken card', () => {
    // No melds, deadwood 65 -> not knockable. Two pip-10 cards tie for the best
    // throw: 10 clubs (id 9) and K spades (id 51); lowest id wins by default.
    const p0 = [
      C(0, 9), C(3, 12), // 10♣, K♠  (both pip 10)
      C(1, 0), C(2, 2), C(3, 4), C(1, 6), C(2, 1), C(3, 3), C(1, 5), C(2, 7), C(3, 8),
    ];
    const noKnock = base({ phase: 'discard', turn: 'p0', hands: { p0, p1: [] } });

    const m1 = chooseMove(noKnock, H, 'medium');
    expect(m1.kind).toBe('discard');
    expect((m1 as { card: CardId }).card).toBe(C(0, 9)); // 10♣, lowest-id pip-10

    // With 10♣ just taken, it may not be re-discarded: falls to the other pip-10.
    const taken = base({
      phase: 'discard', turn: 'p0', noDiscard: C(0, 9), hands: { p0, p1: [] },
    });
    const m2 = chooseMove(taken, H, 'medium');
    expect(m2.kind).toBe('discard');
    expect((m2 as { card: CardId }).card).toBe(C(3, 12)); // K♠
    expect((m2 as { card: CardId }).card).not.toBe(C(0, 9));
  });
});

describe('draw-phase selection', () => {
  // 5♣ 6♣ + eight disconnected cards; no melds. Deadwood 67.
  const drawHand = [
    C(0, 4), C(0, 5), C(1, 0), C(2, 2), C(3, 4), C(1, 7), C(2, 9), C(1, 11), C(3, 12), C(0, 8),
  ];

  test('draws the discard when it completes a meld', () => {
    // Top = 7♣ completes 5-6-7 clubs.
    const s = base({ phase: 'draw', turn: 'p0', hands: { p0: drawHand, p1: [] }, discard: [C(0, 0), C(0, 6)] });
    expect(legalMoves(s, H)).toContain('drawDiscard');
    expect(chooseMove(s, H).kind).toBe('drawDiscard');
  });

  test('draws from stock when the discard top is useless', () => {
    // Top = K♥ helps nothing.
    const s = base({ phase: 'draw', turn: 'p0', hands: { p0: drawHand, p1: [] }, discard: [C(0, 0), C(2, 12)] });
    expect(chooseMove(s, H).kind).toBe('drawStock');
  });

  test('draws from stock on the forced initial draw (both passed)', () => {
    let s = initialMatchState({ hostUid: H, guestUid: G, hostName: 'a', guestName: 'b', seed: [7, 7, 7] });
    s = ok(applyMove(s, { kind: 'passUpcard' }, s.turnUid));
    s = ok(applyMove(s, { kind: 'passUpcard' }, s.turnUid));
    expect(legalMoves(s, s.turnUid)).toEqual(['drawStock']);
    expect(chooseMove(s, s.turnUid).kind).toBe('drawStock');
  });
});

describe('upcard-phase selection', () => {
  const upcardHand = [
    C(0, 4), C(0, 5), C(1, 0), C(2, 2), C(3, 4), C(1, 7), C(2, 9), C(1, 11), C(3, 12), C(0, 8),
  ];

  test('takes a melding upcard', () => {
    const s = base({ phase: 'upcard1', turn: 'p0', hands: { p0: upcardHand, p1: [] }, discard: [C(0, 6)] });
    expect(chooseMove(s, H).kind).toBe('takeUpcard');
  });

  test('passes a junk upcard', () => {
    const s = base({ phase: 'upcard1', turn: 'p0', hands: { p0: upcardHand, p1: [] }, discard: [C(2, 12)] });
    expect(chooseMove(s, H).kind).toBe('passUpcard');
  });
});

describe('difficulty tiers differ', () => {
  // Best discard (K♠) leaves deadwood 3 -> knockable; stock is deep.
  const p0 = [
    C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4), C(0, 5),
    C(0, 7), C(1, 7), C(2, 7),
    C(2, 2), C(3, 12),
  ];
  const deepStock = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1: [] }, stock: deepStock, discard: [C(0, 6)] });

  test('easy and medium knock as soon as able', () => {
    expect(chooseMove(s, H, 'easy').kind).toBe('knock');
    expect(chooseMove(s, H, 'medium').kind).toBe('knock');
  });

  test('hard holds a near-gin hand while the stock is deep', () => {
    expect(chooseMove(s, H, 'hard').kind).toBe('discard');
  });
});

describe('hard is card-aware (public info only)', () => {
  // No melds, deadwood 65 -> not knockable. Two pip-10 throws: 10♣ (id 9) and
  // K♠ (id 51). Default tie-break picks the lower id (10♣).
  const p0 = [
    C(0, 9), C(3, 12),
    C(1, 0), C(2, 2), C(3, 4), C(1, 6), C(2, 1), C(3, 3), C(1, 5), C(2, 7), C(3, 8),
  ];
  const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1: [] }, stock: [48, 49, 50], discard: [24] });

  test('avoids feeding a card the human took off the pile', () => {
    // Human took 10♦: that makes 10♣ (same rank) dangerous -> throw K♠ instead.
    const opp = { wanted: [C(1, 9)], discarded: [] };
    const move = chooseMove(s, H, 'hard', opp);
    expect(move.kind).toBe('discard');
    expect((move as { card: CardId }).card).toBe(C(3, 12)); // K♠, safe
  });

  test('without an opponent model, hard falls back to the min-deadwood throw', () => {
    const move = chooseMove(s, H, 'hard');
    expect(move.kind).toBe('discard');
    expect((move as { card: CardId }).card).toBe(C(0, 9)); // 10♣, lowest id
  });
});

describe('property: CPU plays complete, legal matches at every difficulty', () => {
  const seeds: number[][] = [[1], [2, 3], [4, 5, 6], [7, 8, 9, 10], [11, 13, 17]];
  const difficulties = ['easy', 'medium', 'hard'] as const;

  for (const diff of difficulties) {
    for (const seed of seeds) {
      test(`${diff} / seed ${seed.join('-')} reaches matchOver with only legal moves`, () => {
        let s = initialMatchState({ hostUid: H, guestUid: G, hostName: 'a', guestName: 'b', seed });
        assertConserved(s);
        let steps = 0;
        let deals = 0;
        while (s.phase !== 'matchOver' && steps < 50000) {
          const uid = s.turnUid;
          let move: Move;
          if (s.phase === 'roundOver') {
            move = { kind: 'nextRound', seed: [steps + 1, deals + 7] };
            deals++;
          } else {
            move = chooseMove(s, uid, diff);
            expect(legalMoves(s, uid)).toContain(move.kind);
          }
          const r = applyMove(s, move, uid);
          if (!r.ok) {
            throw new Error(`illegal ${diff} move ${move.kind}: ${r.error}`);
          }
          s = r.state;
          assertConserved(s);
          steps++;
        }
        expect(s.phase).toBe('matchOver');
      });
    }
  }
});
