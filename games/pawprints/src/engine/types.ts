/**
 * The game state, exactly as it is stored in `rooms/<code>/state` (online) and
 * in localStorage (against the cats). Every field here is mirrored by a clause
 * in `database.rules.json`; change them together (see RULES.md).
 *
 * The board is one STRING, one character per point of the grid, row by row:
 * `.` for an empty point, otherwise the seat digit of whoever left a paw
 * there. A string is one scalar on the wire — it cannot be holed or reordered
 * by the realtime database the way an array can, and the rules can bound it
 * with a single regex.
 */

export const RULES = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  /** Points per side the board may have. The rules file bounds the string to fit 15×15. */
  MIN_SIZE: 7,
  MAX_SIZE: 15,
} as const;

/** Board sizes offered in the UI, in points per side. */
export const SIZE_CHOICES = [11, 13, 15] as const;

/** The character for "nobody" in `cells`. */
export const EMPTY = '.';

/** Shown in `turnUid` when nobody is on turn (the game is over). */
export const ANY_PLAYER = '*';

/**
 * How many paws in a row win. Five with two players (the classic game); with
 * three or four, every line gets blocked so often that five is a slog, so
 * four is enough.
 */
export function needFor(players: number): number {
  return players <= 2 ? 5 : 4;
}

export interface Player {
  uid: string;
  name: string;
  isHuman: boolean;
  /** Set when the table had to move for this player while they were away. Cleared by their own move. */
  sitOut: boolean;
}

export interface Config {
  /** Points per side; the board is square. */
  size: number;
}

export type Phase = 'playing' | 'gameover';

export type MoveKind = 'start' | 'paw' | 'away' | 'rematch';

export interface LastMove {
  /** uid of whoever sent the move (for `away`, not the player it moved for). */
  by: string;
  kind: MoveKind;
  /** Seat the move was made for. */
  seat: number;
  /** The point played, for `paw` and `away`. */
  cell: number | null;
}

export interface GameState {
  version: number;
  config: Config;
  players: Player[];
  cells: string;
  phase: Phase;
  /** Seat on turn, or null when the game is over. */
  toAct: number | null;
  /** `players[toAct].uid`, or ANY_PLAYER. Denormalized for the database rules. */
  turnUid: string;
  /** Seat that played first this game. Rotates on a rematch. */
  starter: number;
  /** 1 for the first game in a room, +1 per rematch. */
  gameNo: number;
  lastMove: LastMove;
}

export type Move =
  | { kind: 'paw'; cell: number }
  /** Another player moves for the absent player on turn (online only). */
  | { kind: 'away' }
  /** After the game: clear the board and go again, the next seat starting. */
  | { kind: 'rematch' };

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };
