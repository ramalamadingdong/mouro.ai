/**
 * Min-deadwood meld engine.
 *
 * Melds: SET = 3-4 cards same rank; RUN = 3+ consecutive same-suit cards
 * (Ace LOW; A-2-3 valid, no Q-K-A wrap). Each card is in at most one meld.
 * bestArrangement returns the EXACT minimum-deadwood arrangement via a
 * take-or-skip DFS over enumerated disjoint melds with a bitmask memo.
 */
import type { Arrangement, CardId, KnockOption, Meld } from './types';
import { pipValue, rankOf, sortByRank, suitOf } from './cards';

/** All k-sized combinations of `items`. */
function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = items.length;
  if (k > n) return out;
  const idx: number[] = [];
  for (let i = 0; i < k; i++) idx.push(i);
  while (true) {
    out.push(idx.map((i) => items[i]));
    // advance
    let p = k - 1;
    while (p >= 0 && idx[p] === n - k + p) p--;
    if (p < 0) break;
    idx[p]++;
    for (let q = p + 1; q < k; q++) idx[q] = idx[q - 1] + 1;
  }
  return out;
}

/**
 * All valid melds present in a hand: every set of size 3/4 (by rank) and every
 * contiguous run of length >= 3 (by suit). Melds are returned with cards sorted
 * ascending by id.
 */
export function enumerateMelds(hand: CardId[]): Meld[] {
  const melds: Meld[] = [];

  // --- Sets (same rank) ---
  const byRank = new Map<number, CardId[]>();
  for (const c of hand) {
    const r = rankOf(c);
    const g = byRank.get(r);
    if (g) g.push(c);
    else byRank.set(r, [c]);
  }
  for (const group of byRank.values()) {
    if (group.length >= 3) {
      for (const combo of combinations(group, 3)) {
        melds.push(combo.slice().sort((a, b) => a - b));
      }
      if (group.length === 4) {
        melds.push(group.slice().sort((a, b) => a - b));
      }
    }
  }

  // --- Runs (same suit, consecutive) ---
  const bySuit = new Map<number, CardId[]>();
  for (const c of hand) {
    const s = suitOf(c);
    const g = bySuit.get(s);
    if (g) g.push(c);
    else bySuit.set(s, [c]);
  }
  for (const group of bySuit.values()) {
    const sorted = group.slice().sort((a, b) => rankOf(a) - rankOf(b));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 2; j < sorted.length; j++) {
        // sorted[i..j] contiguous iff rank gap equals index gap (ranks distinct)
        if (rankOf(sorted[j]) - rankOf(sorted[i]) === j - i) {
          melds.push(sorted.slice(i, j + 1));
        } else {
          break; // a gap here means no longer window starting at i is contiguous
        }
      }
    }
  }

  return melds;
}

/** Classify a valid meld: 'run' = same suit + consecutive ranks, else 'set'. */
export function meldKind(meld: Meld): 'set' | 'run' {
  const suit = suitOf(meld[0]);
  if (!meld.every((c) => suitOf(c) === suit)) return 'set';
  const ranks = meld.map(rankOf).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return 'set';
  }
  return 'run';
}

/** Whether a matching card pairs toward a set (same rank) or a run (same suit). */
export type MatchKind = 'set' | 'run';

/**
 * Cards in `hand` that could combine with `target` toward a meld — even an
 * incomplete one — for the hold-to-peek highlight. A card matches as a 'set' when
 * it shares `target`'s rank, or as a 'run' when it shares `target`'s suit and is
 * within 2 ranks (adjacent, or a one-gap fill). Ace is low and runs never wrap.
 * `target` itself is never included; ranks are distinct within a hand so each
 * match has exactly one kind.
 */
export function matchingCards(
  target: CardId,
  hand: CardId[],
): Map<CardId, MatchKind> {
  const tr = rankOf(target);
  const ts = suitOf(target);
  const out = new Map<CardId, MatchKind>();
  for (const c of hand) {
    if (c === target) continue;
    if (rankOf(c) === tr) {
      out.set(c, 'set');
    } else if (suitOf(c) === ts) {
      const d = Math.abs(rankOf(c) - tr);
      if (d === 1 || d === 2) out.set(c, 'run');
    }
  }
  return out;
}

/**
 * Exact minimum-deadwood arrangement of a hand into disjoint melds.
 * Maximizes total melded pip value (== minimizes deadwood).
 */
export function bestArrangement(hand: CardId[]): Arrangement {
  const n = hand.length;
  const pips = hand.map(pipValue);
  let totalPip = 0;
  for (const p of pips) totalPip += p;

  const idxOf = new Map<CardId, number>();
  for (let i = 0; i < n; i++) idxOf.set(hand[i], i);

  const meldList = enumerateMelds(hand);
  const meldMasks = meldList.map((cards) => {
    let mask = 0;
    let pip = 0;
    for (const c of cards) {
      const i = idxOf.get(c)!;
      mask |= 1 << i;
      pip += pips[i];
    }
    return { mask, pip, cards };
  });

  // memo[usedMask] = { pip: best additional melded pip, choice: meld index or -1 }
  const memo = new Map<number, { pip: number; choice: number }>();
  function best(used: number): number {
    const cached = memo.get(used);
    if (cached) return cached.pip;
    let bestPip = 0;
    let choice = -1;
    for (let k = 0; k < meldMasks.length; k++) {
      const mm = meldMasks[k];
      if ((mm.mask & used) === 0) {
        const val = mm.pip + best(used | mm.mask);
        if (val > bestPip) {
          bestPip = val;
          choice = k;
        }
      }
    }
    memo.set(used, { pip: bestPip, choice });
    return bestPip;
  }

  const meldedPip = best(0);

  // Reconstruct chosen melds by following the choice chain.
  const chosen: Meld[] = [];
  let used = 0;
  for (;;) {
    const entry = memo.get(used);
    if (!entry || entry.choice < 0) break;
    const mm = meldMasks[entry.choice];
    chosen.push(mm.cards.slice());
    used |= mm.mask;
  }

  const deadwood: CardId[] = [];
  for (let i = 0; i < n; i++) {
    if ((used & (1 << i)) === 0) deadwood.push(hand[i]);
  }

  return { melds: chosen, deadwood, deadwoodValue: totalPip - meldedPip };
}

/** Deadwood pip total of a hand under its best arrangement. */
export function deadwoodValue(hand: CardId[]): number {
  return bestArrangement(hand).deadwoodValue;
}

/**
 * For an 11-card hand: for each distinct card, the deadwood remaining after
 * discarding it. (deadwoodAfter <= KNOCK_MAX is knockable; 0 = gin.)
 */
export function knockOptions(hand: CardId[]): KnockOption[] {
  const seen = new Set<CardId>();
  const out: KnockOption[] = [];
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    if (seen.has(c)) continue;
    seen.add(c);
    const rest = hand.slice(0, i).concat(hand.slice(i + 1));
    out.push({ card: c, deadwoodAfter: deadwoodValue(rest) });
  }
  return out;
}

/** True iff an 11-card hand melds completely (deadwood empty) — big gin. */
export function isBigGin(hand: CardId[]): boolean {
  return hand.length === 11 && bestArrangement(hand).deadwood.length === 0;
}

/**
 * Reorder `hand` for display so each meld's cards sit contiguously (in the order
 * the meld lists them), with the leftover deadwood sorted by rank and trailing.
 * Pure and deterministic; the exact set of cards is preserved (never adds/drops).
 * `melds` typically comes from `bestArrangement(hand).melds`; any meld card not
 * actually in `hand` is ignored. With no melds this is just `sortByRank(hand)`.
 */
export function arrangeForDisplay(hand: CardId[], melds: Meld[]): CardId[] {
  const inHand = new Set(hand);
  const placed = new Set<CardId>();
  const grouped: CardId[] = [];
  for (const meld of melds) {
    for (const c of meld) {
      if (inHand.has(c) && !placed.has(c)) {
        placed.add(c);
        grouped.push(c);
      }
    }
  }
  const deadwood = sortByRank(hand.filter((c) => !placed.has(c)));
  return [...grouped, ...deadwood];
}
