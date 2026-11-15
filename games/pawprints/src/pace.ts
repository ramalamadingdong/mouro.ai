/**
 * Timing. Computer players in the older games acted too fast to follow, so
 * every cat paw here is its own visibly timed step, and every number that
 * controls that lives in this one block.
 */

/** A [shortest, longest] wait in milliseconds; the actual wait is uniform between them. */
type Range = readonly [min: number, max: number];

export const CPU_PACE = {
  /** A cat choosing an ordinary point. */
  think: [1100, 1900] as Range,
  /** A cat answering a line that is one paw from winning: it pounces a little faster. */
  pounce: [800, 1200] as Range,
  /** The first paw of a game, after the quilt has just been laid out. */
  opening: [900, 1300] as Range,
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

/** How long a cat "thinks" before its next paw, given what just happened. */
export function thinkDelay(opts: { urgent: boolean; opening: boolean }): number {
  if (opts.opening) return between(CPU_PACE.opening);
  return between(opts.urgent ? CPU_PACE.pounce : CPU_PACE.think);
}
