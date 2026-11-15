/**
 * Coats, shapes, and the string encodings the state uses.
 *
 *   tile  = coat letter + shape digit                      "g3"
 *   cat   = tile + orientation (0–7) + x + y               "g3214"
 *
 * An orientation is `rot + 4 × flip`: mirror left-to-right first if flipped,
 * then turn clockwise `rot` quarter-turns. (x, y) is the top-left square of
 * the oriented shape's bounding box.
 */
import { RULES } from './types';

export type Coat = 'g' | 's' | 't' | 'w';

/** `rival` is the coat this one cannot stand; it is always mutual. */
export const COATS: Record<Coat, { name: string; rival: Coat }> = {
  g: { name: 'Ginger', rival: 's' },
  s: { name: 'Smoke', rival: 'g' },
  t: { name: 'Tuxedo', rival: 'w' },
  w: { name: 'Snow', rival: 't' },
};
export const COAT_KEYS = Object.keys(COATS) as Coat[];

export type Cell = readonly [x: number, y: number];

/** Each shape is a cat lying down: the first square is its head, the last its tail. */
export const SHAPES: readonly { name: string; cells: readonly Cell[] }[] = [
  { name: 'napper', cells: [[0, 0], [1, 0]] },
  { name: 'stretcher', cells: [[0, 0], [1, 0], [2, 0]] },
  { name: 'curler', cells: [[0, 0], [0, 1], [1, 1]] },
  { name: 'loaf', cells: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { name: 'long cat', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: 'sitter', cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: 'sprawler', cells: [[1, 1], [0, 0], [1, 0], [2, 0]] },
  { name: 'slinker', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: 'lounger', cells: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 2]] },
  { name: 'corner hog', cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
];

export const TILE_RE = /^[gstw][0-9]$/;
export const EMPTY_SLOT = '..';

export interface Tile {
  coat: Coat;
  shape: number;
}

/** A cat seated on a floor, decoded. `cells` are absolute, head first. */
export interface PlacedCat extends Tile {
  orient: number;
  x: number;
  y: number;
  cells: Cell[];
}

export function parseTile(s: string): Tile | null {
  return TILE_RE.test(s) ? { coat: s[0] as Coat, shape: Number(s[1]) } : null;
}

export function tileName(tile: Tile): string {
  return `${COATS[tile.coat].name} ${SHAPES[tile.shape].name}`;
}

/** The shape's squares in orientation 0–7, shifted so the bounding box starts at (0, 0). */
export function orient(shape: number, orientation: number): Cell[] {
  const flip = orientation >= 4;
  let out: [number, number][] = SHAPES[shape].cells.map(([x, y]) => (flip ? [-x, y] : [x, y]));
  for (let i = 0; i < orientation % 4; i++) out = out.map(([x, y]) => [-y, x]);
  const mx = Math.min(...out.map((c) => c[0]));
  const my = Math.min(...out.map((c) => c[1]));
  return out.map(([x, y]) => [x - mx, y - my]);
}

export function extent(cells: readonly Cell[]): [w: number, h: number] {
  return [Math.max(...cells.map((c) => c[0])) + 1, Math.max(...cells.map((c) => c[1])) + 1];
}

export function cellsAt(shape: number, orientation: number, x: number, y: number): Cell[] {
  return orient(shape, orientation).map(([cx, cy]) => [cx + x, cy + y]);
}

export function encodeCat(tile: Tile, orientation: number, x: number, y: number): string {
  return `${tile.coat}${tile.shape}${orientation}${x}${y}`;
}

/** The slots of a market string. `null` is a slot already taken this round. */
export function parseMarket(market: string): (Tile | null)[] {
  const out: (Tile | null)[] = [];
  for (let i = 0; i + 2 <= market.length; i += 2) out.push(parseTile(market.slice(i, i + 2)));
  return out;
}

/** Which cat (by index) sits on each square, or -1. */
export function gridOf(cats: readonly { cells: readonly Cell[] }[]): number[] {
  const g = new Array<number>(RULES.W * RULES.H).fill(-1);
  cats.forEach((c, i) => {
    for (const [x, y] of c.cells) g[y * RULES.W + x] = i;
  });
  return g;
}

export function fits(grid: readonly number[], cells: readonly Cell[]): boolean {
  return cells.every(([x, y]) => x >= 0 && x < RULES.W && y >= 0 && y < RULES.H && grid[y * RULES.W + x] < 0);
}

/**
 * Decode a floor string. Returns null if it is not a legal floor: a malformed
 * cat, one that pokes over the wall, or two cats on the same square.
 */
export function parseFloor(floor: string): PlacedCat[] | null {
  if (floor.length % 5 !== 0 || floor.length > RULES.ROUNDS * 5) return null;
  const cats: PlacedCat[] = [];
  const grid = new Array<number>(RULES.W * RULES.H).fill(-1);
  for (let i = 0; i < floor.length; i += 5) {
    const s = floor.slice(i, i + 5);
    if (!/^[gstw][0-9][0-7][0-6][0-6]$/.test(s)) return null;
    const cat = { coat: s[0] as Coat, shape: Number(s[1]), orient: Number(s[2]), x: Number(s[3]), y: Number(s[4]) };
    const cells = cellsAt(cat.shape, cat.orient, cat.x, cat.y);
    if (!fits(grid, cells)) return null;
    for (const [x, y] of cells) grid[y * RULES.W + x] = cats.length;
    cats.push({ ...cat, cells });
  }
  return cats;
}

/** Every distinct way a tile can still be seated on `grid`. Orientations that look the same are tried once. */
export function placements(grid: readonly number[], tile: Tile): { orient: number; x: number; y: number; cells: Cell[] }[] {
  const seen = new Set<string>();
  const out: { orient: number; x: number; y: number; cells: Cell[] }[] = [];
  for (let o = 0; o < 8; o++) {
    const base = orient(tile.shape, o);
    const key = base.map((c) => c.join()).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const [w, h] = extent(base);
    for (let y = 0; y + h <= RULES.H; y++) {
      for (let x = 0; x + w <= RULES.W; x++) {
        const cells: Cell[] = base.map(([cx, cy]) => [cx + x, cy + y]);
        if (fits(grid, cells)) out.push({ orient: o, x, y, cells });
      }
    }
  }
  return out;
}
