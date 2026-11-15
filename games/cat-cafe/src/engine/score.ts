/** Scoring a café floor. */
import { COATS, gridOf, type Cell, type Coat } from './tiles';
import { PTS, RULES } from './types';

export type Mood = 'sleep' | 'happy' | 'grumpy';

export interface Link {
  kind: 'friend' | 'spat';
  /** Midpoint of the border the two cats share, in squares. */
  x: number;
  y: number;
}

export interface Tally {
  grid: number[];
  /** Pairs of touching cats with the same coat. */
  friends: number;
  /** Pairs of touching rivals. */
  spats: number;
  rows: number;
  fullRows: number[];
  links: Link[];
  /** One per cat: grumpy if it touches a rival, else happy if it touches a friend. */
  mood: Mood[];
  total: number;
}

/** Pairs are counted once per two cats, however long the border they share. */
export function tally(cats: readonly { coat: Coat; cells: readonly Cell[] }[]): Tally {
  const { W, H } = RULES;
  const grid = gridOf(cats);
  const seen = new Set<number>();
  const links: Link[] = [];
  const mood: Mood[] = cats.map(() => 'sleep');
  let friends = 0;
  let spats = 0;
  const meet = (a: number, b: number, x: number, y: number): void => {
    if (b < 0 || a === b) return;
    const key = Math.min(a, b) * 100 + Math.max(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    const ca = cats[a].coat;
    const cb = cats[b].coat;
    if (ca === cb) {
      friends++;
      links.push({ kind: 'friend', x, y });
      for (const i of [a, b]) if (mood[i] !== 'grumpy') mood[i] = 'happy';
    } else if (COATS[ca].rival === cb) {
      spats++;
      links.push({ kind: 'spat', x, y });
      mood[a] = mood[b] = 'grumpy';
    }
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = grid[y * W + x];
      if (a < 0) continue;
      if (x + 1 < W) meet(a, grid[y * W + x + 1], x + 1, y + 0.5);
      if (y + 1 < H) meet(a, grid[(y + 1) * W + x], x + 0.5, y + 1);
    }
  }
  const fullRows: number[] = [];
  for (let y = 0; y < H; y++) if (grid.slice(y * W, y * W + W).every((v) => v >= 0)) fullRows.push(y);
  const total = friends * PTS.friend - spats * PTS.spat + fullRows.length * PTS.row;
  return { grid, friends, spats, rows: fullRows.length, fullRows, links, mood, total };
}
