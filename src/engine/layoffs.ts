/**
 * Layoff engine: after a normal knock, the defender minimizes deadwood by
 * (a) arranging their own melds AND (b) laying off leftover cards onto the
 * knocker's melds (extend a run at either end, add a 4th to a set), honoring
 * chaining (7♠ onto 4-5-6♠ then 8♠ becomes layable). Never called vs gin/big
 * gin.
 */
import type { CardId, LayoffPlacement, LayoffResult, Meld } from './types';
import { pipValue, rankOf, suitOf } from './cards';
import { enumerateMelds } from './melds';

/** A candidate coverage unit over the defender's hand (bitmask of card indices). */
interface Unit {
  mask: number;
  pip: number;
  /** own meld cards, or null when this is a layoff unit. */
  meld: Meld | null;
  /** for layoff units: the knocker meld index these cards attach to. */
  meldIndex: number;
  /** for layoff units: the cards, in the order they extend the knocker meld. */
  layoffCards: CardId[];
}

/** Classify a knocker meld as a run: returns {suit, lo, hi} or null (it's a set). */
function asRun(meld: Meld): { suit: number; lo: number; hi: number } | null {
  if (meld.length < 3) return null;
  const suit = suitOf(meld[0]);
  if (!meld.every((c) => suitOf(c) === suit)) return null;
  const ranks = meld.map(rankOf).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return null;
  }
  return { suit, lo: ranks[0], hi: ranks[ranks.length - 1] };
}

/**
 * Best defender arrangement (own melds + layoffs onto knocker melds) minimizing
 * remaining deadwood.
 */
export function bestLayoff(
  defenderHand: CardId[],
  knockerMelds: Meld[],
): LayoffResult {
  const n = defenderHand.length;
  const pips = defenderHand.map(pipValue);
  let totalPip = 0;
  for (const p of pips) totalPip += p;

  const idxOf = new Map<CardId, number>();
  for (let i = 0; i < n; i++) idxOf.set(defenderHand[i], i);

  const units: Unit[] = [];

  // Own melds.
  for (const meld of enumerateMelds(defenderHand)) {
    let mask = 0;
    let pip = 0;
    for (const c of meld) {
      const i = idxOf.get(c)!;
      mask |= 1 << i;
      pip += pips[i];
    }
    units.push({ mask, pip, meld: meld.slice(), meldIndex: -1, layoffCards: [] });
  }

  // Layoff units onto each knocker meld.
  for (let mi = 0; mi < knockerMelds.length; mi++) {
    const km = knockerMelds[mi];
    const run = asRun(km);
    if (run) {
      const { suit, lo, hi } = run;
      // Contiguous down chain (lo-1, lo-2, ...) and up chain (hi+1, hi+2, ...).
      const down: CardId[] = [];
      for (let r = lo - 1; r >= 0; r--) {
        const card = suit * 13 + r;
        if (idxOf.has(card)) down.push(card);
        else break;
      }
      const up: CardId[] = [];
      for (let r = hi + 1; r <= 12; r++) {
        const card = suit * 13 + r;
        if (idxOf.has(card)) up.push(card);
        else break;
      }
      for (let d = 0; d <= down.length; d++) {
        for (let u = 0; u <= up.length; u++) {
          if (d === 0 && u === 0) continue;
          const cards: CardId[] = [];
          // Order: down cards nearest the run first, then up cards.
          for (let k = 0; k < d; k++) cards.push(down[k]);
          for (let k = 0; k < u; k++) cards.push(up[k]);
          let mask = 0;
          let pip = 0;
          for (const c of cards) {
            const i = idxOf.get(c)!;
            mask |= 1 << i;
            pip += pips[i];
          }
          units.push({ mask, pip, meld: null, meldIndex: mi, layoffCards: cards });
        }
      }
    } else {
      // Set: only cards can be added up to a 4-card set. Missing rank cards.
      if (km.length < 4) {
        const r = rankOf(km[0]);
        for (const c of defenderHand) {
          if (rankOf(c) === r && !km.includes(c)) {
            const i = idxOf.get(c)!;
            units.push({
              mask: 1 << i,
              pip: pips[i],
              meld: null,
              meldIndex: mi,
              layoffCards: [c],
            });
          }
        }
      }
    }
  }

  // DFS take-or-skip over disjoint units, maximizing covered pip.
  const memo = new Map<number, { pip: number; choice: number }>();
  function best(used: number): number {
    const cached = memo.get(used);
    if (cached) return cached.pip;
    let bestPip = 0;
    let choice = -1;
    for (let k = 0; k < units.length; k++) {
      const u = units[k];
      if ((u.mask & used) === 0) {
        const val = u.pip + best(used | u.mask);
        if (val > bestPip) {
          bestPip = val;
          choice = k;
        }
      }
    }
    memo.set(used, { pip: bestPip, choice });
    return bestPip;
  }
  const coveredPip = best(0);

  // Reconstruct chosen units.
  const melds: Meld[] = [];
  const layoffs: LayoffPlacement[] = [];
  let used = 0;
  for (;;) {
    const entry = memo.get(used);
    if (!entry || entry.choice < 0) break;
    const u = units[entry.choice];
    if (u.meld) {
      melds.push(u.meld.slice());
    } else {
      for (const c of u.layoffCards) layoffs.push({ card: c, meldIndex: u.meldIndex });
    }
    used |= u.mask;
  }

  const deadwood: CardId[] = [];
  for (let i = 0; i < n; i++) {
    if ((used & (1 << i)) === 0) deadwood.push(defenderHand[i]);
  }

  return { melds, layoffs, deadwood, deadwoodValue: totalPip - coveredPip };
}
