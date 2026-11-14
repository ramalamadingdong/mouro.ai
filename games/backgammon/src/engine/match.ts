/**
 * Match settings for Tawleh.
 *
 * Tawleh is played without a doubling cube: a game is worth 1 point, or 2 for
 * a mars (the loser had not borne off a single checker). There is no triple
 * game, so there is also no Crawford rule to manage.
 */
export const MATCH_LENGTHS = [1, 3, 5, 7, 9, 11, 15, 21] as const;
export const DEFAULT_MATCH_LENGTH = 5;
