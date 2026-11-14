/**
 * Timing. The owner's one explicit complaint about the other games was that
 * computer players act too fast to follow, so every computer action here is a
 * separate, visibly timed step — and every number that controls that lives in
 * this one block.
 */
import type { LegalActions, PlayerMove } from '@/engine';

/** A [shortest, longest] wait in milliseconds; the actual wait is uniform between them. */
type Range = readonly [min: number, max: number];

export const CPU_PACE = {
  /** A cat folding or checking: a glance at the cards. */
  quick: [900, 1600] as Range,
  /** A cat calling, betting or raising: chips have to be counted out. */
  commit: [1400, 2800] as Range,
  /** A cat moving all-in, or calling for half its stack or more: a real think. */
  big: [2400, 3500] as Range,
  /** The dealer's pause before each flop / turn / river, and before the showdown reveal. */
  street: [700, 1000] as Range,
  /**
   * Multiplier applied to all of the above once the human has tapped
   * "Skip ahead" after folding. Never applied automatically: the default is
   * always full pace.
   */
  skipAhead: 0.25,
} as const;

/**
 * Online only (humans set their own pace there). How long a player's
 * connection must have been gone before another client acts for them, and how
 * long once they are already marked as sitting out.
 */
export const AWAY = {
  /** First absence in a hand: give a dropped connection time to come back. */
  graceMs: 30_000,
  /** Already sitting out: do not make the table wait again every orbit. */
  sittingOutMs: 2_500,
  /** Extra delay per rank among the remaining players, so they do not all fire at once. */
  staggerMs: 1_500,
} as const;

const between = ([min, max]: Range): number => min + Math.random() * (max - min);

/** How long the dealer waits before the next street. */
export function streetDelay(): number {
  return between(CPU_PACE.street);
}

/** How long a cat "thinks" before making `move`. Decided AFTER the move, so big decisions take longer. */
export function thinkDelay(move: PlayerMove, legal: LegalActions, stack: number): number {
  if (move.kind === 'fold' || move.kind === 'check') return between(CPU_PACE.quick);
  const allIn = move.kind === 'raise' && move.to >= legal.maxRaiseTo;
  const bigCall = move.kind === 'call' && legal.callAmount >= stack / 2;
  return between(allIn || bigCall ? CPU_PACE.big : CPU_PACE.commit);
}
