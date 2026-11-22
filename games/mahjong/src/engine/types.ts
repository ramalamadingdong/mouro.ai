/**
 * The game state, exactly as it is stored in `rooms/<code>/state` (online) and
 * in localStorage (against the cats). Every field here is mirrored by a clause
 * in `database.rules.json`; change them together (see RULES.md).
 *
 * Tiles are characters (see tiles.ts), so every collection of tiles — a hand,
 * a discard pile, the wall — is a string: one scalar on the wire that the
 * realtime database cannot hole or reorder, bounded by one regex in the rules.
 */

export const RULES = {
  /** Mahjong is always played four-handed; empty seats are filled by cats. */
  PLAYERS: 4,
  /** Fewest humans an online room starts with. */
  MIN_HUMANS: 2,
  /** Most humans in an online room. */
  MAX_PLAYERS: 4,
} as const;

/** Minimum faan to go Mahjong, offered in the setup screens. */
export const MIN_FAAN_CHOICES = [0, 1, 3] as const;
/** 1 = the East round (at least four hands), 4 = a full game of four rounds. */
export const ROUND_CHOICES = [1, 4] as const;

/** Shown in `turnUid` when nobody in particular is on turn. */
export const ANY_PLAYER = '*';

export interface Player {
  uid: string;
  name: string;
  isHuman: boolean;
  /** Set when the table had to move for this player while they were away. Cleared by their own move. */
  sitOut: boolean;
  /** Running total. The four always sum to zero. */
  score: number;
  /** Concealed tiles, sorted. */
  hand: string;
  /**
   * Melds on the table, comma separated. Each is a type letter and its tiles:
   * `c` chow, `p` pung, `k` exposed kong, `h` concealed kong — e.g. `cjkl,pFFF`.
   */
  melds: string;
  /** Flowers and seasons set aside. */
  flowers: string;
  /** This player's discards still on the table, oldest first. */
  discards: string;
}

export interface Config {
  /** Faan needed to go Mahjong. */
  minFaan: number;
  /** Prevailing-wind rounds to play: 1 or 4. */
  rounds: number;
}

/**
 * - `turn`: `toAct` holds a full hand and must discard, declare a kong, or
 *   go Mahjong.
 * - `claim`: a tile is on offer (a discard, or the tile of an added kong that
 *   can be robbed). `claim.asks` says who still has to answer.
 * - `scored`: the hand is over and `result` is on the table; any player deals
 *   the next hand.
 * - `gameover`: the last hand has been scored.
 */
export type Phase = 'turn' | 'claim' | 'scored' | 'gameover';

/**
 * One character per seat in `Claim.asks`:
 * `.` not asked (nothing to claim), `?` still deciding, `x` passed,
 * `w` Mahjong, `k` kong, `p` pung, and `l` / `m` / `h` chow with the
 * offered tile as the low / middle / high tile of the run.
 */
export type ClaimMark = '.' | '?' | 'x' | 'w' | 'k' | 'p' | 'l' | 'm' | 'h';

export interface Claim {
  tile: string;
  /** Who discarded it (or is adding it to a kong). */
  from: number;
  /** True while an added kong waits to see if anyone robs it. Only Mahjong may be called. */
  rob: boolean;
  asks: string;
}

export interface Result {
  /** Seat that went Mahjong, or -1 for a drawn hand (the wall ran out). */
  winner: number;
  /** Seat that discarded the winning tile, or -1 for self-drawn / a draw. */
  from: number;
  faan: number;
  /** The scoring, one `name:faan` per line, `|` separated. */
  lines: string;
  /** What each seat won (+) or paid (−) this hand, comma separated. */
  pay: string;
}

export type MoveKind = 'start' | 'discard' | 'kong' | 'win' | 'claim' | 'away' | 'next' | 'rematch';

/** What the table did as a result of a move, for the status line. */
export type Event = '' | 'discard' | 'pung' | 'chow' | 'kong' | 'win' | 'draw' | 'pass';

export interface LastMove {
  /** uid of whoever sent the move (for `away`, not the player it moved for). */
  by: string;
  kind: MoveKind;
  /** Seat the move was made for. */
  seat: number;
  /** What happened: a discard, a claim taking effect, a win, a drawn hand… */
  event: Event;
  /** Seat the event happened to (the claimer, the winner). */
  eventSeat: number;
  /** The tile involved, or ''. */
  tile: string;
}

export interface GameState {
  version: number;
  config: Config;
  players: Player[];
  /** Tiles still to be drawn. Ordinary draws come off the front, kong and flower replacements off the back. */
  wall: string;
  phase: Phase;
  /** Seat on turn in `turn`; null otherwise. */
  toAct: number | null;
  /** `players[toAct].uid`, or ANY_PLAYER. Denormalized for the database rules. */
  turnUid: string;
  /** The tile `toAct` just drew ('' after a chow or pung). Lets the hand show it apart. */
  drawn: string;
  /**
   * How `toAct` came to be on turn: `draw` an ordinary draw, `kong` a
   * replacement after a kong (Mahjong on it scores a faan), `claim` after a
   * chow or pung (no Mahjong by self-draw — they drew nothing).
   */
  via: 'draw' | 'kong' | 'claim';
  claim: Claim | null;
  result: Result | null;
  /** Seat of the dealer (East) for this hand. */
  dealer: number;
  /** Prevailing wind, 0 East … 3 North. */
  wind: number;
  /** 1 for the first hand of a game, +1 per hand. */
  handNo: number;
  /** 1 for the first game in a room, +1 per rematch. */
  gameNo: number;
  lastMove: LastMove;
}

export type Call = 'pass' | 'win' | 'pung' | 'kong' | 'chow';
export type ChowPos = 'l' | 'm' | 'h';

export type Move =
  | { kind: 'discard'; seat: number; tile: string }
  /** A concealed kong (four in hand) or adding the fourth tile to a pung. */
  | { kind: 'kong'; seat: number; tile: string }
  /** Mahjong on a self-drawn tile. */
  | { kind: 'win'; seat: number }
  | { kind: 'claim'; seat: number; call: Call; chow?: ChowPos }
  /** Another player moves for an absent one (online only): discards the drawn tile, or passes. */
  | { kind: 'away'; seat: number }
  /** After a scored hand: deal the next one. */
  | { kind: 'next'; seed: number }
  /** After the game: start again. */
  | { kind: 'rematch'; seed: number };

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };
