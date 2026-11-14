/**
 * Scoring constants for the match. See SPEC.md "GIN RUMMY RULES".
 */
import type { ScoringConfig } from './types';

export const SCORING: ScoringConfig = {
  GIN: 25,
  BIG_GIN: 31,
  UNDERCUT: 25,
  GAME: 100,
  BOX: 25,
  TARGET: 100,
  SHUTOUT_X: 2,
  KNOCK_MAX: 10,
  HAND_SIZE: 10,
};
