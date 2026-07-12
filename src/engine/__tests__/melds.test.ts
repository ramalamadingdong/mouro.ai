import {
  enumerateMelds,
  bestArrangement,
  deadwoodValue,
  knockOptions,
  isBigGin,
  meldKind,
  matchingCards,
} from '../melds';
import { pipValue, makeDeck } from '../cards';
import { makeRng, shuffle } from '../rng';
import type { CardId, Meld } from '../types';

const C = (suit: number, rank: number): CardId => suit * 13 + rank;

// ---- Independent brute-force reference for minimum deadwood ----

interface RefMeld {
  mask: number;
  pip: number;
  cards: CardId[];
}

/** Independently generate all valid melds for a hand. */
function refMelds(hand: CardId[]): RefMeld[] {
  const idx = new Map<CardId, number>();
  hand.forEach((c, i) => idx.set(c, i));
  const out: RefMeld[] = [];
  const push = (cards: CardId[]) => {
    let mask = 0;
    let pip = 0;
    for (const c of cards) {
      mask |= 1 << idx.get(c)!;
      pip += pipValue(c);
    }
    out.push({ mask, pip, cards: cards.slice() });
  };
  // Sets: same rank, size 3 and 4.
  for (let r = 0; r < 13; r++) {
    const group = hand.filter((c) => c % 13 === r);
    if (group.length >= 3) {
      // all size-3 combos
      for (let a = 0; a < group.length; a++)
        for (let b = a + 1; b < group.length; b++)
          for (let d = b + 1; d < group.length; d++) push([group[a], group[b], group[d]]);
      if (group.length === 4) push(group);
    }
  }
  // Runs: same suit, consecutive, length >= 3.
  for (let s = 0; s < 4; s++) {
    const ranks = hand.filter((c) => Math.floor(c / 13) === s).map((c) => c % 13).sort((x, y) => x - y);
    for (let i = 0; i < ranks.length; i++) {
      for (let j = i + 2; j < ranks.length; j++) {
        let ok = true;
        for (let k = i + 1; k <= j; k++) if (ranks[k] !== ranks[k - 1] + 1) ok = false;
        if (ok) {
          const cards: CardId[] = [];
          for (let k = i; k <= j; k++) cards.push(s * 13 + ranks[k]);
          push(cards);
        }
      }
    }
  }
  return out;
}

/** Brute-force minimum deadwood (no memo, exhaustive take/skip). */
function refDeadwood(hand: CardId[]): number {
  const melds = refMelds(hand);
  const total = hand.reduce((a, c) => a + pipValue(c), 0);
  let bestMelded = 0;
  const rec = (i: number, used: number, melded: number) => {
    if (melded > bestMelded) bestMelded = melded;
    for (let k = i; k < melds.length; k++) {
      if ((melds[k].mask & used) === 0) {
        rec(k + 1, used | melds[k].mask, melded + melds[k].pip);
      }
    }
  };
  rec(0, 0, 0);
  return total - bestMelded;
}

describe('enumerateMelds', () => {
  test('finds both overlapping set and run (6♦6♥6♠ vs 4♠5♠6♠)', () => {
    const hand = [C(1, 5), C(2, 5), C(3, 5), C(3, 3), C(3, 4)]; // 6d 6h 6s 4s 5s
    const melds = enumerateMelds(hand);
    const has = (cards: CardId[]) =>
      melds.some((m) => m.length === cards.length && cards.every((c) => m.includes(c)));
    expect(has([C(1, 5), C(2, 5), C(3, 5)])).toBe(true); // set of 6s
    expect(has([C(3, 3), C(3, 4), C(3, 5)])).toBe(true); // run 4-5-6 spades
  });

  test('no Q-K-A wrap run', () => {
    const hand = [C(0, 11), C(0, 12), C(0, 0)]; // Q K A clubs
    const melds = enumerateMelds(hand);
    expect(melds).toHaveLength(0);
  });

  test('A-2-3 is a valid run (ace low)', () => {
    const hand = [C(0, 0), C(0, 1), C(0, 2)];
    const melds = enumerateMelds(hand);
    expect(melds.some((m) => m.length === 3)).toBe(true);
  });

  test('4-card set yields size-3 combos and the size-4 set', () => {
    const hand = [C(0, 6), C(1, 6), C(2, 6), C(3, 6)]; // four 7s
    const melds = enumerateMelds(hand);
    const sizes = melds.map((m) => m.length).sort();
    // four size-3 combos + one size-4
    expect(melds.filter((m) => m.length === 3)).toHaveLength(4);
    expect(melds.filter((m) => m.length === 4)).toHaveLength(1);
    expect(sizes[sizes.length - 1]).toBe(4);
  });
});

describe('meldKind', () => {
  test('same-suit consecutive ranks is a run', () => {
    expect(meldKind([C(0, 0), C(0, 1), C(0, 2)])).toBe('run'); // A-2-3 clubs
    expect(meldKind([C(2, 5), C(2, 6), C(2, 7), C(2, 8)])).toBe('run'); // 6-7-8-9 hearts
  });

  test('same rank across suits is a set', () => {
    expect(meldKind([C(0, 0), C(1, 0), C(2, 0)])).toBe('set'); // three aces
    expect(meldKind([C(0, 6), C(1, 6), C(2, 6), C(3, 6)])).toBe('set'); // four 7s
  });

  test('classifies every meld enumerated from a mixed hand', () => {
    const hand = [C(1, 5), C(2, 5), C(3, 5), C(3, 3), C(3, 4)]; // 6d 6h 6s, 4s 5s
    for (const m of enumerateMelds(hand)) {
      const sameSuit = m.every((c) => Math.floor(c / 13) === Math.floor(m[0] / 13));
      expect(meldKind(m)).toBe(sameSuit ? 'run' : 'set');
    }
  });
});

describe('matchingCards', () => {
  test('same rank matches as a set, across suits', () => {
    const hand = [C(0, 6), C(1, 6), C(2, 6), C(3, 0)]; // 7c 7d 7h, plus Ks-ish loose
    const m = matchingCards(C(0, 6), hand); // hold 7 clubs
    expect(m.get(C(1, 6))).toBe('set'); // 7 diamonds
    expect(m.get(C(2, 6))).toBe('set'); // 7 hearts
    expect(m.has(C(3, 0))).toBe(false); // unrelated card
  });

  test('same suit within 2 ranks matches as a run (adjacent + one-gap)', () => {
    const target = C(2, 6); // 7 hearts
    const hand = [C(2, 4), C(2, 5), C(2, 7), C(2, 8), C(2, 9)]; // 5h 6h 8h 9h 10h
    const m = matchingCards(target, hand);
    expect(m.get(C(2, 5))).toBe('run'); // 6h, diff 1
    expect(m.get(C(2, 7))).toBe('run'); // 8h, diff 1
    expect(m.get(C(2, 4))).toBe('run'); // 5h, diff 2 (one gap)
    expect(m.get(C(2, 8))).toBe('run'); // 9h, diff 2 (one gap)
    expect(m.has(C(2, 9))).toBe(false); // 10h, diff 3 — too far
  });

  test('excludes the target itself and does not wrap Q-K-A', () => {
    const target = C(0, 0); // Ace clubs
    const hand = [C(0, 0), C(0, 12), C(0, 11), C(0, 1)]; // Ac Kc Qc 2c
    const m = matchingCards(target, hand);
    expect(m.has(C(0, 0))).toBe(false); // target excluded even if present in hand
    expect(m.get(C(0, 1))).toBe('run'); // 2c, diff 1
    expect(m.has(C(0, 12))).toBe(false); // Kc — no wrap (diff 12)
    expect(m.has(C(0, 11))).toBe(false); // Qc — no wrap
  });

  test('a different-suit non-adjacent card is not a match', () => {
    const m = matchingCards(C(0, 6), [C(1, 7)]); // hold 7c, hand 8d
    expect(m.size).toBe(0);
  });
});

describe('bestArrangement', () => {
  test('overlapping set/run picks lower deadwood', () => {
    const hand = [C(1, 5), C(2, 5), C(3, 5), C(3, 3), C(3, 4)]; // 6d6h6s 4s5s
    const arr = bestArrangement(hand);
    // best: set of three 6s melded (18), leaving 4s+5s = 9 deadwood.
    expect(arr.deadwoodValue).toBe(9);
    expect(deadwoodValue(hand)).toBe(9);
  });

  test('arrangement is self-consistent (disjoint melds, deadwood matches)', () => {
    const hand = [C(0, 0), C(0, 1), C(0, 2), C(1, 6), C(2, 6), C(3, 6), C(3, 9), C(2, 11), C(1, 4), C(0, 8)];
    const arr = bestArrangement(hand);
    const meldedCards = arr.melds.flat();
    // disjoint
    expect(new Set(meldedCards).size).toBe(meldedCards.length);
    // melds + deadwood partition the hand
    const all = [...meldedCards, ...arr.deadwood].sort((a, b) => a - b);
    expect(all).toEqual([...hand].sort((a, b) => a - b));
    // deadwoodValue matches
    expect(arr.deadwood.reduce((a, c) => a + pipValue(c), 0)).toBe(arr.deadwoodValue);
  });

  test('matches brute force on 500 random 10- and 11-card hands', () => {
    const deck = makeDeck();
    for (let t = 0; t < 500; t++) {
      const rng = makeRng([t + 1, 12345, t * 7 + 3]);
      const shuffled = shuffle(deck, rng);
      const size = t % 2 === 0 ? 10 : 11;
      const hand = shuffled.slice(0, size);
      expect(bestArrangement(hand).deadwoodValue).toBe(refDeadwood(hand));
    }
  });
});

describe('knockOptions', () => {
  test('reports deadwood after discarding each distinct card', () => {
    // 11-card hand: run A-2-3-4 clubs, set of three 5s, 3 loose cards.
    const hand = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), // A-2-3-4 clubs
      C(0, 4), C(1, 4), C(2, 4), // three 5s
      C(3, 11), C(3, 12), C(2, 10), C(1, 8), // Q♠ K♠ J♥ 9♦ loose
    ];
    const opts = knockOptions(hand);
    expect(opts).toHaveLength(11);
    // Discarding the highest loose card (K♠) gives the min deadwood among options.
    const best = Math.min(...opts.map((o) => o.deadwoodAfter));
    // With A-2-3-4 + 555 melded (8 cards), 3 loose remain; discard one -> 2 loose.
    // loose pips: Q=10,K=10,J=10,9=9 -> discard K leaves Q+J = 20 (or 9+something).
    expect(best).toBeGreaterThan(0);
    // each option = deadwood of the 10-card remainder
    for (const o of opts) {
      const rest = hand.filter((c) => c !== o.card);
      expect(o.deadwoodAfter).toBe(deadwoodValue(rest));
    }
  });

  test('gin option (deadwoodAfter 0) detected', () => {
    // 11 cards: A-2-3-4-5 clubs run, 6-7-8 clubs run, three 10s; discard nothing needed
    const hand = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), // extra card to discard = A? keep structure
      C(0, 4), C(0, 5), C(0, 6), // 5-6-7 clubs
      C(0, 9), C(1, 9), C(2, 9), // three 10s
      C(3, 12), // K spades loose -> discard to gin
    ];
    const opts = knockOptions(hand);
    const ginOpt = opts.find((o) => o.deadwoodAfter === 0);
    expect(ginOpt).toBeDefined();
    expect(ginOpt!.card).toBe(C(3, 12));
  });
});

describe('isBigGin', () => {
  test('true for an 11-card fully-melded hand', () => {
    const hand = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4), // A-2-3-4-5 clubs
      C(0, 5), C(0, 6), C(0, 7), // 6-7-8 clubs
      C(0, 9), C(1, 9), C(2, 9), // three 10s
    ];
    expect(hand).toHaveLength(11);
    expect(isBigGin(hand)).toBe(true);
  });

  test('false when a card is left over', () => {
    const hand = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4),
      C(0, 5), C(0, 6), C(0, 7),
      C(0, 9), C(1, 9), C(3, 12), // K spades leftover
    ];
    expect(isBigGin(hand)).toBe(false);
  });

  test('false for a 10-card hand', () => {
    const hand = [
      C(0, 0), C(0, 1), C(0, 2), C(0, 3), C(0, 4),
      C(0, 5), C(0, 6), C(0, 7), C(0, 9), C(1, 9),
    ];
    expect(isBigGin(hand)).toBe(false);
  });
});
