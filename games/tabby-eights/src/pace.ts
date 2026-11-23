/**
 * Timing. Computer players in the older games acted too fast to follow, so
 * every cat card (and every draw) here is its own visibly timed step, and every number that
 * controls that lives in this one block.
 */

/** A [shortest, longest] wait in milliseconds; the actual wait is uniform between them. */
type Range = readonly [min: number, max: number];

export const CPU_PACE = {
  /** A cat choosing which card to play. */
  think: [1200, 2000] as Range,
  /** A cat with nothing that fits, reaching for the stock. */
  draw: [900, 1400] as Range,
  /** After drawing: playing the new card, or passing. */
  afterDraw: [900, 1300] as Range,
  /** The first card of a round, after the cards have just been dealt. */
  opening: [1200, 1600] as Range,
} as const;

/**
 * Online only (humans set their own pace there). How long a player's
 * connection must have been gone before another client takes their turn, and
 * how long once they are already marked as sitting out.
 */
export const AWAY = {
  graceMs: 30_000,
  sittingOutMs: 2_500,
  /** Extra delay per rank among the remaining players, so they do not all fire at once. */
  staggerMs: 1_500,
} as const;

const between = ([min, max]: Range): number => min + Math.random() * (max - min);

/** How long a cat "thinks" before its next step, given what it is about to do. */
export function thinkDelay(opts: { opening: boolean; drawing: boolean; drew: boolean }): number {
  if (opts.opening) return between(CPU_PACE.opening);
  if (opts.drew) return between(CPU_PACE.afterDraw);
  return between(opts.drawing ? CPU_PACE.draw : CPU_PACE.think);
}
