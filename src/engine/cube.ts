/**
 * The doubling cube, and the Crawford rule.
 *
 * Deliberate non-goals (say so before "fixing" any of them): automatic doubles,
 * beavers and raccoons, the Jacoby rule (meaningless in match play anyway),
 * resignations, and match-equity-driven cube decisions.
 */
import type { GameState, Seat } from './types';

/** The cube tops out at 64; there is nowhere to turn it after that. */
export const CUBE_MAX = 64;

/** Legal cube values, used by `normalize()` to reject a corrupt snapshot. */
export const CUBE_VALUES = [1, 2, 4, 8, 16, 32, 64] as const;

/** Match lengths offered in the lobby. Odd lengths are the tradition. */
export const MATCH_LENGTHS = [1, 3, 5, 7, 9, 11, 15, 21] as const;
export const DEFAULT_MATCH_LENGTH = 5;

/**
 * May this seat double right now?
 *
 * "On roll, before rolling" is exactly `phase === 'roll'`. There is no doubling
 * window during `opening`, which is correct: no turn precedes the opening roll,
 * so nobody is on roll yet.
 */
export function canDouble(state: GameState, seat: Seat): boolean {
  return (
    state.phase === 'roll' &&
    state.turn === seat &&
    !state.crawford &&
    state.cube.value < CUBE_MAX &&
    (state.cube.owner === null || state.cube.owner === seat)
  );
}

/** What the cube would become if turned. */
export function nextCubeValue(value: number): number {
  return Math.min(CUBE_MAX, value * 2);
}

/**
 * Whether the game starting NOW is the Crawford game: the first game after
 * either player reaches one point short of the match, played without a cube.
 *
 * `crawfordDone` never un-latches within a match, so a second player later
 * reaching `target - 1` does not re-trigger it.
 *
 * Free correctness worth noting: in a 1-point match `target - 1 === 0`, which
 * every fresh scoreline satisfies, so game 1 is automatically the Crawford
 * game — i.e. there is no doubling in a 1-pointer. That is the right answer,
 * and it falls out rather than being special-cased.
 */
export function isCrawfordGame(
  scores: Record<Seat, number>,
  target: number,
  crawfordDone: boolean,
): boolean {
  if (crawfordDone) return false;
  return scores.p0 === target - 1 || scores.p1 === target - 1;
}
