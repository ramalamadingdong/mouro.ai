/**
 * The game state, exactly as it is stored in `rooms/<code>/state` (online) and
 * in localStorage (against the cats). Every field here is mirrored by a clause
 * in `database.rules.json`; change them together (see RULES.md).
 *
 * Edges and boxes are STRINGS, one character per edge / box: `.` for undrawn /
 * unclaimed, otherwise the seat digit of whoever drew / claimed it. A string
 * is one scalar on the wire — it cannot be holed or reordered by the
 * realtime database the way an array can, and the rules can bound it with a
 * single regex.
 */

export const RULES = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  /** Boxes per side the board may have. The rules file bounds the strings to fit 8×8. */
  MIN_SIZE: 1,
  MAX_SIZE: 8,
} as const;

/** Board sizes offered in the UI, in boxes per side. */
export const SIZE_CHOICES = [3, 4, 5, 6] as const;

/** The character for "nobody" in `edges` and `boxes`. */
export const EMPTY = '.';

/** Shown in `turnUid` when nobody is on turn (the game is over). */
export const ANY_PLAYER = '*';

export interface Player {
  uid: string;
  name: string;
  isHuman: boolean;
  /** Set when the table had to move for this player while they were away. Cleared by their own move. */
  sitOut: boolean;
}

export interface Config {
  cols: number;
  rows: number;
}

export type Phase = 'playing' | 'gameover';

export type MoveKind = 'start' | 'line' | 'away' | 'rematch';

export interface LastMove {
  /** uid of whoever sent the move (for `away`, not the player it moved for). */
  by: string;
  kind: MoveKind;
  /** Seat the move was made for. */
  seat: number;
  /** The edge drawn, for `line` and `away`. */
  edge: number | null;
  /** How many boxes that line closed (0, 1 or 2). */
  closed: number;
}

export interface GameState {
  version: number;
  config: Config;
  players: Player[];
  edges: string;
  boxes: string;
  phase: Phase;
  /** Seat on turn, or null when the game is over. */
  toAct: number | null;
  /** `players[toAct].uid`, or ANY_PLAYER. Denormalized for the database rules. */
  turnUid: string;
  /** Seat that drew first this game. Rotates on a rematch. */
  starter: number;
  /** 1 for the first game in a room, +1 per rematch. */
  gameNo: number;
  lastMove: LastMove;
}

export type Move =
  | { kind: 'line'; edge: number }
  /** Another player moves for the absent player on turn (online only). */
  | { kind: 'away' }
  /** After the game: clear the board and go again, the next seat starting. */
  | { kind: 'rematch' };

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };
