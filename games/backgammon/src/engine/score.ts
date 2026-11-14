/**
 * Game and match scoring: gammons, backgammons, and when a match is over.
 */
import { CHECKERS } from './board';
import type { GameResult, GameState, MatchResult, Seat } from './types';

/**
 * Tawleh scoring: 2 points for a mars — the loser had not borne off a single
 * checker — otherwise 1. There is no triple game: a checker left on the bar
 * or in the winner's home board makes no difference.
 */
export function gameMultiplier(state: GameState, winner: Seat): 1 | 2 {
  const loser: Seat = winner === 'p0' ? 'p1' : 'p0';
  return state.off[loser] > 0 ? 1 : 2;
}

/** Has this seat borne off every checker? */
export function hasWon(state: GameState, seat: Seat): boolean {
  return state.off[seat] >= CHECKERS;
}

export function buildGameResult(state: GameState, winner: Seat): GameResult {
  const multiplier = gameMultiplier(state, winner);
  const scores: Record<Seat, number> = { ...state.scores };
  scores[winner] += multiplier;
  return {
    winner,
    multiplier,
    points: multiplier,
    how: multiplier === 2 ? 'mars' : 'single',
    scores,
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
