/**
 * Game and match scoring: gammons, backgammons, and when a match is over.
 */
import { CHECKERS, ownAt } from './board';
import type { GameResult, GameState, MatchResult, Seat } from './types';

/**
 * How many times the cube value the winner scores, evaluated at the moment the
 * winner bears off their 15th checker.
 *
 *   1  single      — the loser has borne off at least one checker
 *   2  gammon      — the loser has borne off none
 *   3  backgammon  — the loser has borne off none AND still has a checker on
 *                    the bar or in the winner's home board
 *
 * "The winner's home board" is the loser's own-frame 18..23: `toOwn` is a
 * reflection, so the winner's home 0..5 maps to the loser's 18..23.
 */
export function gameMultiplier(state: GameState, winner: Seat): 1 | 2 | 3 {
  const loser: Seat = winner === 'p0' ? 'p1' : 'p0';
  if (state.off[loser] > 0) return 1;
  if (state.bar[loser] > 0) return 3;
  for (let i = 18; i < 24; i++) {
    if (ownAt(state.points, loser, i) > 0) return 3;
  }
  return 2;
}

/** Has this seat borne off every checker? */
export function hasWon(state: GameState, seat: Seat): boolean {
  return state.off[seat] >= CHECKERS;
}

/**
 * Build the result of a game that ended by bearing off, and the scores after it.
 */
export function buildGameResult(state: GameState, winner: Seat): GameResult {
  const multiplier = gameMultiplier(state, winner);
  const cube = state.cube.value;
  const points = cube * multiplier;
  const scores: Record<Seat, number> = { ...state.scores };
  scores[winner] += points;
  return {
    winner,
    multiplier,
    cube,
    points,
    how: multiplier === 3 ? 'backgammon' : multiplier === 2 ? 'gammon' : 'single',
    scores,
    crawford: state.crawford,
  };
}

/**
 * Build the result of a game that ended because a double was dropped. The
 * doubler scores the cube value from BEFORE the double, at multiplier 1.
 */
export function buildPassResult(state: GameState, winner: Seat): GameResult {
  const cube = state.cube.value;
  const scores: Record<Seat, number> = { ...state.scores };
  scores[winner] += cube;
  return {
    winner,
    multiplier: 1,
    cube,
    points: cube,
    how: 'pass',
    scores,
    crawford: state.crawford,
  };
}

/** The match result if `scores` has reached the target, else null. */
export function buildMatchResult(
  scores: Record<Seat, number>,
  target: number,
  games: number,
): MatchResult | null {
  const winner: Seat | null =
    scores.p0 >= target ? 'p0' : scores.p1 >= target ? 'p1' : null;
  if (!winner) return null;
  const loser: Seat = winner === 'p0' ? 'p1' : 'p0';
  return {
    winner,
    scores: { ...scores },
    target,
    games,
    shutout: scores[loser] === 0,
  };
}
