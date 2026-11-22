/**
 * Timing. Computer players in the older games acted too fast to follow, so
 * every cat move here is its own visibly timed step, and every number that
 * controls that lives in this one block.
 */

/** A [shortest, longest] wait in milliseconds; the actual wait is uniform between them. */
type Range = readonly [min: number, max: number];

export const CPU_PACE = {
  /** A cat with a full hand choosing what to throw (or declaring a kong, or Mahjong). */
  turn: [1000, 1700] as Range,
  /** A cat deciding whether to call a tile someone threw. */
  claim: [700, 1100] as Range,
  /** The dealer's first throw, while the hands have just been dealt. */
  opening: [1400, 1900] as Range,
} as const;

/**
 * Online only (humans set their own pace there). How long a player's
 * connection must have been gone before another client plays for them, and
 * how long once they are already marked as sitting out.
 */
export const AWAY = {
  graceMs: 30_000,
  sittingOutMs: 2_500,
  /** Extra delay per rank among the remaining players, so they do not all fire at once. */
  staggerMs: 1_500,
} as const;

const between = ([min, max]: Range): number => min + Math.random() * (max - min);

export function thinkDelay(kind: 'turn' | 'claim' | 'opening'): number {
  return between(CPU_PACE[kind]);
}
