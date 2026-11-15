/**
 * The game state, exactly as it is stored in `rooms/<code>/state` (online) and
 * in localStorage (against the cats). Every field here is mirrored by a clause
 * in `database.rules.json`; change them together (see RULES.md).
 *
 * The market and each floor are STRINGS (see tiles.ts for the encoding). A
 * string is one scalar on the wire — it cannot be holed or reordered by the
 * realtime database the way an array can, and the rules can bound it with a
 * single regex.
 */

export const RULES = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  /** The café floor, in squares. */
  W: 7,
  H: 7,
  /** Every player takes one cat per round. */
  ROUNDS: 12,
  /** Cats at the door at the start of a round: one more than this per player. */
  MARKET_EXTRA: 2,
} as const;

export const PTS = { friend: 2, spat: 3, row: 5 } as const;

/** Shown in `turnUid` when nobody is on turn (the game is over). */
export const ANY_PLAYER = '*';

export interface Player {
  uid: string;
  name: string;
  isHuman: boolean;
  /** Set when the table had to move for this player while they were away. Cleared by their own move. */
  sitOut: boolean;
}

export type Phase = 'playing' | 'gameover';

export type MoveKind = 'start' | 'seat' | 'pass' | 'away' | 'rematch';

export interface LastMove {
  /** uid of whoever sent the move (for `away`, not the player it moved for). */
  by: string;
  kind: MoveKind;
  /** Seat the move was made for. */
  seat: number;
  /** The tile taken from the door (2 chars), for `seat`, `pass` and `away`. */
  tile: string | null;
  /** The cat as seated (5 chars), or null when the tile was sent away. */
  cat: string | null;
}

export interface GameState {
  version: number;
  players: Player[];
  /** The cats at the door: 2 chars per slot, `..` for a slot already taken this round. */
  market: string;
  /** One string per seat: 5 chars per seated cat, in the order they arrived. */
  floors: string[];
  /** Picks made so far this game, 0 … ROUNDS × players. Round and turn are derived from it. */
  picks: number;
  phase: Phase;
  /** Seat on turn, or null when the game is over. */
  toAct: number | null;
  /** `players[toAct].uid`, or ANY_PLAYER. Denormalized for the database rules. */
  turnUid: string;
  /** Seat that picked first in round one. Rotates on a rematch. */
  starter: number;
  /** 1 for the first game in a room, +1 per rematch. */
  gameNo: number;
  lastMove: LastMove;
}

export type Move =
  /** Take the tile in `slot` and seat it: orientation 0–7, top-left square of its bounding box at (x, y). */
  | { kind: 'seat'; slot: number; orient: number; x: number; y: number }
  /** Take the tile in `slot` and send it away (no points). */
  | { kind: 'pass'; slot: number }
  /** Another player moves for the absent player on turn (online only). */
  | { kind: 'away' }
  /** After the game: clear the floors and go again, the next seat picking first. */
  | { kind: 'rematch' };

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };

/** A source of randomness in [0, 1). The engine never calls Math.random itself. */
export type Rnd = () => number;
