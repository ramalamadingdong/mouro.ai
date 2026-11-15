/**
 * Timing. Computer players that act instantly are impossible to follow, so
 * every cat's pick is its own visibly timed step, and every number that
 * controls that lives in this one block.
 */

/** A [shortest, longest] wait in milliseconds; the actual wait is uniform between them. */
type Range = readonly [min: number, max: number];

export const CPU_PACE = {
  /** A cat choosing at the door. */
  think: [1200, 2000] as Range,
  /** The first pick of a game, after the floors have just been drawn. */
  opening: [900, 1300] as Range,
} as const;

/**
 * Online only (humans set their own pace there). How long a player's
 * connection must have been gone before another client picks for them, and
 * how long once they are already marked as sitting out.
 */
export const AWAY = {
  graceMs: 30_000,
  sittingOutMs: 2_500,
  /** Extra delay per rank among the remaining players, so they do not all fire at once. */
  staggerMs: 1_500,
} as const;

const between = ([min, max]: Range): number => min + Math.random() * (max - min);

/** How long a cat "thinks" before its pick. */
export function thinkDelay(opts: { opening: boolean }): number {
  return between(opts.opening ? CPU_PACE.opening : CPU_PACE.think);
}
