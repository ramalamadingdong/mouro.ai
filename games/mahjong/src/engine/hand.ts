/**
 * Hand analysis: melds, complete hands, and the tiles a hand is waiting on.
 * A complete hand is four sets (chow or pung/kong) and a pair, counting the
 * melds already on the table, or the Thirteen Orphans.
 */
import { PLAY_KINDS, countsOf, isSuited, isTerminalOrHonor, kindOf, rankOf, tileOf } from './tiles';

export type MeldType = 'chow' | 'pung' | 'kong' | 'hidden-kong';

export interface Meld {
  type: MeldType;
  /** Lowest kind (for a chow) or the kind (pung / kong). */
  kind: number;
  tiles: string;
}

const TYPE_OF: Record<string, MeldType> = { c: 'chow', p: 'pung', k: 'kong', h: 'hidden-kong' };
const LETTER_OF: Record<MeldType, string> = { chow: 'c', pung: 'p', kong: 'k', 'hidden-kong': 'h' };

export function parseMelds(melds: string): Meld[] {
  if (!melds) return [];
  const out: Meld[] = [];
  for (const token of melds.split(',')) {
    const type = TYPE_OF[token[0]];
    const tiles = token.slice(1);
    if (!type || tiles.length === 0) continue;
    out.push({ type, kind: Math.min(...Array.from(tiles, kindOf)), tiles });
  }
  return out;
}

export function meldToken(type: MeldType, tiles: string): string {
  return LETTER_OF[type] + tiles;
}

export function addMeld(melds: string, type: MeldType, tiles: string): string {
  const token = meldToken(type, tiles);
  return melds ? `${melds},${token}` : token;
}

/** Tiles in hand + 3 per meld: 13 between turns, 14 on turn. */
export function handSize(hand: string, melds: string): number {
  return hand.length + parseMelds(melds).length * 3;
}

export interface SetPart {
  type: 'chow' | 'pung';
  kind: number;
}

export interface Decomposition {
  pair: number;
  sets: SetPart[];
}

/** Every way to split `counts` (34 long) into sets only. */
function setsOnly(counts: number[], from: number, acc: SetPart[], out: SetPart[][]): void {
  let k = from;
  while (k < PLAY_KINDS && counts[k] === 0) k++;
  if (k === PLAY_KINDS) {
    out.push(acc.slice());
    return;
  }
  if (counts[k] >= 3) {
    counts[k] -= 3;
    acc.push({ type: 'pung', kind: k });
    setsOnly(counts, k, acc, out);
    acc.pop();
    counts[k] += 3;
  }
  if (isSuited(k) && rankOf(k) <= 7 && counts[k + 1] > 0 && counts[k + 2] > 0) {
    counts[k] -= 1;
    counts[k + 1] -= 1;
    counts[k + 2] -= 1;
    acc.push({ type: 'chow', kind: k });
    setsOnly(counts, k, acc, out);
    acc.pop();
    counts[k] += 1;
    counts[k + 1] += 1;
    counts[k + 2] += 1;
  }
}

/** Every way the concealed tiles split into sets and one pair. Empty if none. */
export function decompositions(concealed: string): Decomposition[] {
  const counts = countsOf(concealed).slice(0, PLAY_KINDS);
  if (concealed.length % 3 !== 2) return [];
  const out: Decomposition[] = [];
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (counts[k] < 2) continue;
    counts[k] -= 2;
    const found: SetPart[][] = [];
    setsOnly(counts, 0, [], found);
    for (const sets of found) out.push({ pair: k, sets });
    counts[k] += 2;
  }
  return out;
}

export function isThirteenOrphans(concealed: string): boolean {
  if (concealed.length !== 14) return false;
  const counts = countsOf(concealed);
  let pairs = 0;
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (isTerminalOrHonor(k)) {
      if (counts[k] === 0) return false;
      if (counts[k] === 2) pairs += 1;
      if (counts[k] > 2) return false;
    } else if (counts[k] > 0) return false;
  }
  return pairs === 1;
}

/** True when the concealed tiles (with melds already set aside) form a winning shape. */
export function isComplete(concealed: string): boolean {
  return isThirteenOrphans(concealed) || decompositions(concealed).length > 0;
}

/**
 * Tiles that would complete a hand of 3n+1 concealed tiles, ignoring how many
 * are left and whether it scores enough. Shown to the player as "Waiting on".
 */
export function waits(concealed: string): string[] {
  if (concealed.length % 3 !== 1) return [];
  const counts = countsOf(concealed);
  const out: string[] = [];
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (counts[k] >= 4) continue;
    if (isComplete(concealed + tileOf(k))) out.push(tileOf(k));
  }
  return out;
}
