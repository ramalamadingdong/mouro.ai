import {
  initialMatchState,
  applyMove,
  legalMoves,
  seatOf,
  otherSeat,
} from '../reducer';
import type { CardId, GameState, Move, Seat } from '../types';

const C = (suit: number, rank: number): CardId => suit * 13 + rank;

const H = 'HOST_UID';
const G = 'GUEST_UID';

/** Build a controlled state; caller supplies whatever fields matter. */
function base(over: Partial<GameState> = {}): GameState {
  const s: GameState = {
    version: 5,
    players: { p0: H, p1: G },
    names: { p0: 'Host', p1: 'Guest' },
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

describe('helpers', () => {
  test('otherSeat', () => {
    expect(otherSeat('p0')).toBe('p1');
    expect(otherSeat('p1')).toBe('p0');
  });
  test('seatOf', () => {
    const s = base();
    expect(seatOf(s, H)).toBe('p0');
    expect(seatOf(s, G)).toBe('p1');
    expect(seatOf(s, 'nobody')).toBeNull();
  });
});

describe('initialMatchState', () => {
  test('round 1 dealt with p1 as dealer, p0 acts first', () => {
    const s = initialMatchState({
      hostUid: H,
      guestUid: G,
      hostName: 'Host',
      guestName: 'Guest',
      seed: [1, 2, 3],
    });
    expect(s.dealer).toBe('p1');
    expect(s.turn).toBe('p0');
    expect(s.phase).toBe('upcard1');
    expect(s.turnUid).toBe(H);
    expect(s.hands.p0).toHaveLength(10);
    expect(s.hands.p1).toHaveLength(10);
    expect(s.stock).toHaveLength(31);
    expect(s.discard).toHaveLength(1);
    expect(s.round).toBe(1);
    expect(s.scores).toEqual({ p0: 0, p1: 0 });
    // 52 unique cards conserved
    const all = [...s.hands.p0, ...s.hands.p1, ...s.stock, ...s.discard];
    expect(new Set(all).size).toBe(52);
  });

  test('respects custom target', () => {
    const s = initialMatchState({
      hostUid: H, guestUid: G, hostName: 'a', guestName: 'b', seed: [9], target: 150,
    });
    expect(s.target).toBe(150);
  });
});

describe('first-turn upcard sequence', () => {
  test('both pass -> non-dealer draws stock', () => {
    let s = initialMatchState({
      hostUid: H, guestUid: G, hostName: 'a', guestName: 'b', seed: [7, 7, 7],
    });
    // upcard1, turn p0
    expect(legalMoves(s, H)).toEqual(['takeUpcard', 'passUpcard']);
    expect(legalMoves(s, G)).toEqual([]);

    s = ok(applyMove(s, { kind: 'passUpcard' }, H));
    expect(s.phase).toBe('upcard2');
    expect(s.turn).toBe('p1');
    expect(s.turnUid).toBe(G);

    // p0 can no longer act
    expect(legalMoves(s, H)).toEqual([]);
    expect(legalMoves(s, G)).toEqual(['takeUpcard', 'passUpcard']);

    s = ok(applyMove(s, { kind: 'passUpcard' }, G));
    expect(s.phase).toBe('draw');
    expect(s.turn).toBe('p0'); // non-dealer draws stock
    // Both players refused the upcard: the non-dealer MUST draw from stock and
    // may not pick up the very upcard both just passed.
    expect(legalMoves(s, H)).toEqual(['drawStock']);
    expect(applyMove(s, { kind: 'drawDiscard' }, H).ok).toBe(false);

    const stockBefore = s.stock.length;
    s = ok(applyMove(s, { kind: 'drawStock' }, H));
    expect(s.phase).toBe('discard');
    expect(s.hands.p0).toHaveLength(11);
    expect(s.stock).toHaveLength(stockBefore - 1);
    expect(s.noDiscard).toBeNull();
  });

  test('takeUpcard then cannot discard the just-taken card', () => {
    let s = initialMatchState({
      hostUid: H, guestUid: G, hostName: 'a', guestName: 'b', seed: [3, 1, 4],
    });
    const upcard = s.discard[s.discard.length - 1];
    s = ok(applyMove(s, { kind: 'takeUpcard' }, H));
    expect(s.phase).toBe('discard');
    expect(s.hands.p0).toHaveLength(11);
    expect(s.discard).toHaveLength(0);
    expect(s.noDiscard).toBe(upcard);

    const rej = applyMove(s, { kind: 'discard', card: upcard }, H);
    expect(rej.ok).toBe(false);

    // discarding a different card works
    const other = s.hands.p0.find((c) => c !== upcard)!;
    const s2 = ok(applyMove(s, { kind: 'discard', card: other }, H));
    expect(s2.phase).toBe('draw');
    expect(s2.turn).toBe('p1');
    expect(s2.discard[s2.discard.length - 1]).toBe(other);
  });
});

describe('rejections', () => {
  test('not your turn', () => {
    const s = base({ phase: 'draw', turn: 'p0' });
    const r = applyMove(s, { kind: 'drawStock' }, G);
    expect(r.ok).toBe(false);
  });
  test('wrong phase', () => {
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], p1: [] } });
    const r = applyMove(s, { kind: 'drawStock' }, H);
    expect(r.ok).toBe(false);
  });
  test('drawDiscard on empty pile', () => {
    const s = base({ phase: 'draw', turn: 'p0', discard: [] });
    const r = applyMove(s, { kind: 'drawDiscard' }, H);
    expect(r.ok).toBe(false);
  });
  test('purity: input not mutated', () => {
    const s = base({ phase: 'draw', turn: 'p0' });
    const snapshot = JSON.stringify(s);
    applyMove(s, { kind: 'drawStock' }, H);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
  test('version increments and lastMove recorded', () => {
    const s = base({ phase: 'draw', turn: 'p0', version: 42 });
    const r = ok(applyMove(s, { kind: 'drawStock' }, H));
    expect(r.version).toBe(43);
    expect(r.lastMove).toMatchObject({ by: H, seat: 'p0', kind: 'drawStock' });
    expect(r.turnUid).toBe(r.players[r.turn]);
  });
});

describe('knock / gin / big gin scoring', () => {
  test('gin: +25, defender no layoffs', () => {
    const p0 = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), // A-2-3-4 clubs
      C(0, 4), C(0, 5), C(0, 6), // 5-6-7 clubs
      C(0, 8), C(1, 8), C(2, 8), // three 9s (rank8 -> "9")
      C(3, 12), // K spades to discard
    ];
    // defender: J-Q-K hearts + isolated deadwood totalling 41
    const p1 = [
      C(2, 10), C(2, 11), C(2, 12), // J-Q-K hearts
      C(3, 9), C(1, 7), C(1, 11), C(3, 1), C(1, 0), C(2, 3), C(3, 5),
    ];
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1 }, scores: { p0: 0, p1: 0 } });
    const r = ok(applyMove(s, { kind: 'knock', discard: C(3, 12) }, H));
    expect(r.roundResult!.type).toBe('gin');
    expect(r.roundResult!.winner).toBe('p0');
    // defender deadwood 10+8+10+2+1+4+6 = 41; +25 gin
    expect(r.roundResult!.deadwood.p1).toBe(41);
    expect(r.roundResult!.points).toBe(66);
    expect(r.roundResult!.layoffs).toEqual([]);
    expect(r.roundResult!.knockCard).toBe(C(3, 12)); // discarded to go gin
    expect(r.scores.p0).toBe(66);
    expect(r.boxes.p0).toBe(1);
    expect(r.phase).toBe('roundOver');
  });

  test('big gin: +31, no discard', () => {
    const p0 = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4), // A-2-3-4-5 clubs
      C(0, 5), C(0, 6), C(0, 7), // 6-7-8 clubs
      C(0, 9), C(1, 9), C(2, 9), // three 10s
    ];
    const p1 = [
      C(2, 10), C(2, 11), C(2, 12),
      C(3, 9), C(1, 7), C(1, 11), C(3, 1), C(1, 0), C(2, 3), C(3, 5),
    ];
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1 } });
    expect(legalMoves(s, H)).toContain('bigGin');
    const r = ok(applyMove(s, { kind: 'bigGin' }, H));
    expect(r.roundResult!.type).toBe('bigGin');
    expect(r.roundResult!.deadwood.p1).toBe(41);
    expect(r.roundResult!.knockCard).toBeNull(); // big gin has no discard
    expect(r.roundResult!.points).toBe(72); // 41 + 31
    expect(r.scores.p0).toBe(72);
  });

  test('undercut on a tie: defender wins, +25', () => {
    // knocker deadwood 10, defender deadwood 10 (no layoff) -> tie -> undercut
    const p0 = [
      C(0, 0), C(0, 1), C(0, 2), // A-2-3 clubs
      C(1, 4), C(1, 5), C(1, 6), // 5-6-7 diamonds
      C(3, 1), C(2, 2), C(2, 0), C(3, 3), // 2♠ 3♥ A♥ 4♠ deadwood (=10)
      C(0, 12), // K clubs to discard
    ];
    // defender: three Jacks, three Kings (K♦ K♥ K♠), three 9s, 10♠ deadwood
    const p1 = [
      C(0, 10), C(1, 10), C(2, 10), // J♣ J♦ J♥
      C(1, 12), C(2, 12), C(3, 12), // K♦ K♥ K♠
      C(0, 8), C(1, 8), C(2, 8), // three 9s
      C(3, 9), // 10♠ deadwood (pip 10)
    ];
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1 }, discard: [C(1, 3)] });
    const r = ok(applyMove(s, { kind: 'knock', discard: C(0, 12) }, H));
    expect(r.roundResult!.type).toBe('undercut');
    expect(r.roundResult!.winner).toBe('p1');
    expect(r.roundResult!.deadwood.p0).toBe(10);
    expect(r.roundResult!.deadwood.p1).toBe(10);
    expect(r.roundResult!.points).toBe(25); // (10-10)+25
    expect(r.roundResult!.knockCard).toBe(C(0, 12)); // knocker's discard that got undercut
    expect(r.scores.p1).toBe(25);
    expect(r.boxes.p1).toBe(1);
  });

  test('normal knock: knocker wins by margin', () => {
    const p0 = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4), C(0, 5), // A-2-3-4-5-6 clubs
      C(0, 7), C(1, 7), C(2, 7), // three 8s
      C(2, 2), // 3♥ deadwood (pip 3)
      C(3, 12), // K spades to discard
    ];
    const p1 = [
      C(0, 12), C(1, 12), C(2, 12), // three Kings (K♣ K♦ K♥)
      C(0, 10), C(1, 10), C(2, 10), // three Jacks
      C(0, 8), C(1, 8), C(2, 8), // three 9s
      C(3, 9), // 10♠ deadwood
    ];
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1 }, discard: [C(1, 3)] });
    const r = ok(applyMove(s, { kind: 'knock', discard: C(3, 12) }, H));
    expect(r.roundResult!.type).toBe('knock');
    expect(r.roundResult!.winner).toBe('p0');
    expect(r.roundResult!.deadwood.p0).toBe(3);
    expect(r.roundResult!.deadwood.p1).toBe(10);
    expect(r.roundResult!.points).toBe(7); // 10 - 3
    expect(r.roundResult!.knockCard).toBe(C(3, 12)); // discarded to knock
  });

  test('legalMoves omits knock when the only knockable discard is noDiscard', () => {
    // 5-6-7-8 clubs (run) + 9d-9h-9s (set) + Ac-2d-2h + Ks. Deadwood = 5.
    // Removing Ks -> deadwood 5 (knockable); removing any other card -> >10.
    // But Ks is the just-taken card (noDiscard), so no legal knock exists.
    const p0 = [
      C(0, 4), C(0, 5), C(0, 6), C(0, 7),
      C(1, 8), C(2, 8), C(3, 8),
      C(0, 0), C(1, 1), C(2, 1),
      C(3, 12),
    ];
    const s = base({
      phase: 'discard', turn: 'p0', noDiscard: C(3, 12),
      hands: { p0, p1: [] },
    });
    expect(legalMoves(s, H)).not.toContain('knock');
    // and applyMove indeed rejects the only knockable discard.
    const r = applyMove(s, { kind: 'knock', discard: C(3, 12) }, H);
    expect(r.ok).toBe(false);
  });

  test('legalMoves still offers knock when a non-noDiscard discard is knockable', () => {
    // Same hand but nothing was just taken -> Ks is a legal knock discard.
    const p0 = [
      C(0, 4), C(0, 5), C(0, 6), C(0, 7),
      C(1, 8), C(2, 8), C(3, 8),
      C(0, 0), C(1, 1), C(2, 1),
      C(3, 12),
    ];
    const s = base({
      phase: 'discard', turn: 'p0', noDiscard: null,
      hands: { p0, p1: [C(2, 10), C(2, 11), C(2, 12), 43, 44, 45, 46, 47, 48, 49] },
    });
    expect(legalMoves(s, H)).toContain('knock');
    const r = ok(applyMove(s, { kind: 'knock', discard: C(3, 12) }, H));
    expect(r.roundResult!.knocker).toBe('p0');
  });

  test('knock rejected when deadwood > 10', () => {
    const p0 = [12, 24, 36, 48, 8, 20, 32, 44, 11, 23, 35];
    const s = base({ phase: 'discard', turn: 'p0', hands: { p0, p1: [] } });
    expect(legalMoves(s, H)).not.toContain('knock');
    const r = applyMove(s, { kind: 'knock', discard: 12 }, H);
    expect(r.ok).toBe(false);
  });
});

describe('void', () => {
  test('stock <= 2 after a discard voids the round (same dealer redeal)', () => {
    const p0 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s = base({
      phase: 'discard', turn: 'p0', dealer: 'p1',
      stock: [40, 41], // 2 cards
      discard: [42],
      hands: { p0, p1: [43, 44, 45, 46, 47, 48, 49, 50, 51, 39] },
      scores: { p0: 12, p1: 7 },
    });
    const r = ok(applyMove(s, { kind: 'discard', card: 0 }, H));
    expect(r.phase).toBe('roundOver');
    expect(r.roundResult!.type).toBe('void');
    expect(r.roundResult!.winner).toBeNull();
    expect(r.roundResult!.points).toBe(0);
    expect(r.roundResult!.knockCard).toBeNull();
    expect(r.scores).toEqual({ p0: 12, p1: 7 }); // unchanged

    // nextRound after void keeps the same dealer
    const r2 = ok(applyMove(r, { kind: 'nextRound', seed: [1, 2, 3] }, G));
    expect(r2.dealer).toBe('p1');
    expect(r2.round).toBe(r.round + 1);
    expect(r2.phase).toBe('upcard1');
    expect(r2.scores).toEqual({ p0: 12, p1: 7 });
  });
});

describe('round / dealer flow', () => {
  test('nextRound alternates dealer after a scored round', () => {
    const s = base({
      phase: 'roundOver', dealer: 'p1', round: 4,
      scores: { p0: 30, p1: 20 }, boxes: { p0: 1, p1: 1 },
      roundResult: {
        type: 'knock', knocker: 'p0', knockerMelds: [], knockerDeadwoodCards: [],
        defenderMelds: [], defenderDeadwoodCards: [], layoffs: [],
        deadwood: { p0: 3, p1: 10 }, winner: 'p0', points: 7, knockCard: null,
        handAtReveal: { p0: [], p1: [] },
      },
    });
    expect(legalMoves(s, H)).toEqual(['nextRound']);
    expect(legalMoves(s, G)).toEqual(['nextRound']);
    const r = ok(applyMove(s, { kind: 'nextRound', seed: [5, 5] }, H));
    expect(r.dealer).toBe('p0');
    expect(r.turn).toBe('p1'); // non-dealer acts first
    expect(r.round).toBe(5);
    expect(r.phase).toBe('upcard1');
    expect(r.scores).toEqual({ p0: 30, p1: 20 });
    expect(r.boxes).toEqual({ p0: 1, p1: 1 });
    expect(r.roundResult).toBeNull();
  });
});

describe('match end bonuses', () => {
  const ginHands = () => ({
    p0: [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4), C(0, 5), C(0, 6),
      C(0, 8), C(1, 8), C(2, 8), C(3, 12),
    ],
    p1: [
      C(2, 10), C(2, 11), C(2, 12),
      C(3, 9), C(1, 7), C(1, 11), C(3, 1), C(1, 0), C(2, 3), C(3, 5),
    ],
  });

  test('shutout doubles winner total', () => {
    const s = base({
      phase: 'discard', turn: 'p0', hands: ginHands(),
      scores: { p0: 90, p1: 0 }, boxes: { p0: 3, p1: 0 },
    });
    const r = ok(applyMove(s, { kind: 'knock', discard: C(3, 12) }, H));
    expect(r.phase).toBe('matchOver');
    const m = r.matchResult!;
    expect(r.scores.p0).toBe(156); // 90 + 66
    expect(m.base).toEqual({ p0: 156, p1: 0 });
    expect(m.boxes).toEqual({ p0: 4, p1: 0 });
    expect(m.shutout).toBe(true);
    expect(m.gameBonusTo).toBe('p0');
    // (156 + 100 + 25*4) * 2 = 356 * 2 = 712
    expect(m.final.p0).toBe(712);
    expect(m.final.p1).toBe(0);
  });

  test('non-shutout: game bonus + boxes, no doubling', () => {
    const s = base({
      phase: 'discard', turn: 'p0', hands: ginHands(),
      scores: { p0: 90, p1: 30 }, boxes: { p0: 2, p1: 1 },
    });
    const r = ok(applyMove(s, { kind: 'knock', discard: C(3, 12) }, H));
    expect(r.phase).toBe('matchOver');
    const m = r.matchResult!;
    expect(m.shutout).toBe(false);
    // winner: 156 + 100 + 25*3 = 331 ; loser: 30 + 25*1 = 55
    expect(m.final.p0).toBe(331);
    expect(m.final.p1).toBe(55);
  });

  test('rematch resets scores/boxes and re-deals with p1 dealer', () => {
    const s = base({
      phase: 'matchOver', dealer: 'p0', round: 9,
      scores: { p0: 156, p1: 30 }, boxes: { p0: 4, p1: 1 },
      matchResult: {
        winner: 'p0', base: { p0: 156, p1: 30 }, boxes: { p0: 4, p1: 1 },
        gameBonusTo: 'p0', shutout: false, final: { p0: 331, p1: 55 },
      },
    });
    expect(legalMoves(s, G)).toEqual(['rematch']);
    const r = ok(applyMove(s, { kind: 'rematch', seed: [8, 8, 8] }, G));
    expect(r.scores).toEqual({ p0: 0, p1: 0 });
    expect(r.boxes).toEqual({ p0: 0, p1: 0 });
    expect(r.round).toBe(1);
    expect(r.dealer).toBe('p1');
    expect(r.phase).toBe('upcard1');
    expect(r.matchResult).toBeNull();
  });
});
