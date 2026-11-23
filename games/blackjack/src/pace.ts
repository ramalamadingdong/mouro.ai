/**
 * Timing. The owner's one explicit complaint about the other games was that
 * computer players act too fast to follow, so every computer action here — a
 * cat's bet, each hit, every card the dealer turns — is a separate, visibly
 * timed step, and every number that controls that lives in this one block.
 */
import type { LegalActions, PlayerMove } from '@/engine';

/** A [shortest, longest] wait in milliseconds; the actual wait is uniform between them. */
type Range = readonly [min: number, max: number];

export const CPU_PACE = {
  /** A cat standing or hitting: a glance at the cards. */
  quick: [900, 1600] as Range,
  /** A cat placing a bet: chips have to be counted out. */
  bet: [1100, 2000] as Range,
  /** A cat doubling down or splitting: a real think. */
  big: [1800, 2800] as Range,
  /** The dealer's pause before dealing, turning the hole card, and each card it draws. */
  dealer: [800, 1200] as Range,
  /**
   * Multiplier applied to all of the above once the human has tapped
   * "Skip ahead" (offered when their own hands are finished). Never applied
   * automatically: the default is always full pace.
   */
  skipAhead: 0.25,
} as const;

/**
 * Online only (humans set their own pace there). How long a player's
 * connection must have been gone before another client acts for them, and how
 * long once they are already marked as sitting out.
 */
export const AWAY = {
  /** First absence in a round: give a dropped connection time to come back. */
  graceMs: 30_000,
  /** Already sitting out: do not make the table wait again every round. */
  sittingOutMs: 2_500,
  /** Extra delay per rank among the remaining players, so they do not all fire at once. */
  staggerMs: 1_500,
} as const;

const between = ([min, max]: Range): number => min + Math.random() * (max - min);

/** How long the dealer waits before its next step. */
export function dealerDelay(): number {
  return between(CPU_PACE.dealer);
}

/** How long a cat "thinks" before making `move`. Decided AFTER the move, so big decisions take longer. */
export function thinkDelay(move: PlayerMove, legal: LegalActions): number {
  if (legal.kind === 'bet') return between(CPU_PACE.bet);
  if (move.kind === 'double' || move.kind === 'split') return between(CPU_PACE.big);
  return between(CPU_PACE.quick);
}
