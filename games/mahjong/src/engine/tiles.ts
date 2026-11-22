/**
 * Tiles. A tile is ONE CHARACTER of `ALPHABET`, and the character's index is
 * the tile's kind:
 *
 *    0– 8  characters 1–9      a–i
 *    9–17  dots 1–9            j–r
 *   18–26  bamboo 1–9          s–A
 *   27–30  winds E S W N       B–E
 *   31–33  dragons red green white   F–H
 *   34–37  flowers 1–4 (plum, orchid, chrysanthemum, bamboo)   I–L
 *   38–41  seasons 1–4 (spring, summer, autumn, winter)        M–P
 *
 * Kinds 0–33 come four times each, the eight bonus tiles once: 144 tiles.
 * Hands, melds, discards and the wall are all strings of these characters, so
 * each is one scalar on the wire and the database rules bound it with a regex
 * (`^[a-zA-P,]*$`; the comma separates melds).
 */

export const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP';

export const KINDS = 42;
/** Kinds that can be part of a hand (everything but flowers and seasons). */
export const PLAY_KINDS = 34;

export const WIND_EAST = 27;
export const DRAGON_RED = 31;
export const FLOWER_FIRST = 34;
export const SEASON_FIRST = 38;

export type Suit = 'characters' | 'dots' | 'bamboo' | 'winds' | 'dragons' | 'flowers' | 'seasons';

export function kindOf(tile: string): number {
  return ALPHABET.indexOf(tile);
}

export function tileOf(kind: number): string {
  return ALPHABET[kind];
}

export function isTile(tile: string): boolean {
  return tile.length === 1 && ALPHABET.includes(tile);
}

export function isBonus(kind: number): boolean {
  return kind >= FLOWER_FIRST;
}

export function isHonor(kind: number): boolean {
  return kind >= WIND_EAST && kind < FLOWER_FIRST;
}

export function isSuited(kind: number): boolean {
  return kind >= 0 && kind < WIND_EAST;
}

export function isDragon(kind: number): boolean {
  return kind >= DRAGON_RED && kind < FLOWER_FIRST;
}

export function isWind(kind: number): boolean {
  return kind >= WIND_EAST && kind < DRAGON_RED;
}

/** 1–9 for suited tiles, 1–4 for winds (E S W N) and bonus tiles, 1–3 for dragons. */
export function rankOf(kind: number): number {
  if (kind < WIND_EAST) return (kind % 9) + 1;
  if (kind < DRAGON_RED) return kind - WIND_EAST + 1;
  if (kind < FLOWER_FIRST) return kind - DRAGON_RED + 1;
  if (kind < SEASON_FIRST) return kind - FLOWER_FIRST + 1;
  return kind - SEASON_FIRST + 1;
}

export function suitOf(kind: number): Suit {
  if (kind < 9) return 'characters';
  if (kind < 18) return 'dots';
  if (kind < 27) return 'bamboo';
  if (kind < 31) return 'winds';
  if (kind < 34) return 'dragons';
  if (kind < 38) return 'flowers';
  return 'seasons';
}

export function isTerminalOrHonor(kind: number): boolean {
  return isHonor(kind) || (isSuited(kind) && (rankOf(kind) === 1 || rankOf(kind) === 9));
}

export const WIND_NAMES = ['East', 'South', 'West', 'North'] as const;

const SUIT_NAMES: Record<Suit, string> = {
  characters: 'Characters',
  dots: 'Dots',
  bamboo: 'Bamboo',
  winds: 'Wind',
  dragons: 'Dragon',
  flowers: 'Flower',
  seasons: 'Season',
};
const DRAGON_NAMES = ['Red', 'Green', 'White'];
const FLOWER_NAMES = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo'];
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** "3 Dots", "East Wind", "Red Dragon", "Plum (Flower 1)". For labels and screen readers. */
export function tileName(tile: string): string {
  const kind = kindOf(tile);
  if (kind < 0) return '?';
  const suit = suitOf(kind);
  const rank = rankOf(kind);
  if (isSuited(kind)) return `${rank} ${SUIT_NAMES[suit]}`;
  if (suit === 'winds') return `${WIND_NAMES[rank - 1]} Wind`;
  if (suit === 'dragons') return `${DRAGON_NAMES[rank - 1]} Dragon`;
  if (suit === 'flowers') return `${FLOWER_NAMES[rank - 1]} (Flower ${rank})`;
  return `${SEASON_NAMES[rank - 1]} (Season ${rank})`;
}

/** The full set, sorted: 136 playing tiles and 8 bonus tiles. */
export function fullSet(): string {
  let out = '';
  for (let k = 0; k < KINDS; k++) out += tileOf(k).repeat(isBonus(k) ? 1 : 4);
  return out;
}

export function sortTiles(tiles: string): string {
  return Array.from(tiles)
    .sort((a, b) => kindOf(a) - kindOf(b))
    .join('');
}

/** Per-kind counts of a tile string, length KINDS. */
export function countsOf(tiles: string): number[] {
  const out = new Array<number>(KINDS).fill(0);
  for (const t of tiles) {
    const k = kindOf(t);
    if (k >= 0) out[k] += 1;
  }
  return out;
}

/** Remove one copy of each tile in `take` from `from`. Null if one is missing. */
export function removeTiles(from: string, take: string): string | null {
  let out = from;
  for (const t of take) {
    const i = out.indexOf(t);
    if (i < 0) return null;
    out = out.slice(0, i) + out.slice(i + 1);
  }
  return out;
}

export function countOf(tiles: string, tile: string): number {
  let n = 0;
  for (const t of tiles) if (t === tile) n += 1;
  return n;
}
