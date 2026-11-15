/**
 * Timing. Computer players in the older games acted too fast to follow, so
 * every cat line here is its own visibly timed step, and every number that
 * controls that lives in this one block.
 */

/** A [shortest, longest] wait in milliseconds; the actual wait is uniform between them. */
type Range = readonly [min: number, max: number];

export const CPU_PACE = {
  /** A cat choosing an ordinary line. */
  think: [1100, 1900] as Range,
  /** A cat taking the next box of a chain it is already eating: quicker, but each one visible. */
  chain: [550, 850] as Range,
  /** The first line of a game, after the board has just been drawn. */
  opening: [900, 1300] as Range,
} as const;

/**
 * Online only (humans set their own pace there). How long a player's
 * connection must have been gone before another client draws for them, and
 * how long once they are already marked as sitting out.
 */
export const AWAY = {
  graceMs: 30_000,
  sittingOutMs: 2_500,
  /** Extra delay per rank among the remaining players, so they do not all fire at once. */
  staggerMs: 1_500,
} as const;

const between = ([min, max]: Range): number => min + Math.random() * (max - min);

/** How long a cat "thinks" before its next line, given what just happened. */
export function thinkDelay(opts: { chain: boolean; opening: boolean }): number {
  if (opts.opening) return between(CPU_PACE.opening);
  return between(opts.chain ? CPU_PACE.chain : CPU_PACE.think);
}
