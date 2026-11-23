/**
 * The game state, exactly as it is stored in `rooms/<code>/state` (online) and
 * in localStorage (against the cats). Every field here is mirrored by a clause
 * in `database.rules.json`; change them together (see RULES.md).
 *
 * Cards are two characters: a suit letter and a rank letter (`fA`, `y8`,
 * `bT`). A hand, the stock and the pile are each ONE STRING of cards run
 * together. A string is one scalar on the wire — it cannot be holed or
 * reordered by the realtime database the way an array can, and the rules can
 * bound it with a single regex.
 */

export const RULES = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  /** Cards dealt to each player: seven heads-up, five with three or four. */
  HAND_TWO: 7,
  HAND_MORE: 5,
  /** Points a player needs to win the game; the rules file bounds it the same way. */
  MIN_TARGET: 1,
  MAX_TARGET: 500,
} as const;

/** Game lengths offered in the UI, in points. */
export const TARGET_CHOICES = [50, 100, 200] as const;

/**
 * The four suits. `f` fish, `y` yarn, `m` mice, `b` bells. The order is the
 * order a hand is sorted in on screen.
 */
export const SUITS = ['f', 'y', 'm', 'b'] as const;
export type Suit = (typeof SUITS)[number];

/** Ace low to king. `T` is the ten, so every card stays two characters. */
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

/** The wild rank. */
export const WILD: Rank = '8';

/** Shown in `turnUid` when nobody is on turn (between rounds, or the game is over). */
export const ANY_PLAYER = '*';

export interface Player {
  uid: string;
  name: string;
  isHuman: boolean;
  /** Set when the table had to move for this player while they were away. Cleared by their own move. */
  sitOut: boolean;
  /** The cards in this player's paws, in the order they were taken. */
  hand: string;
  /** Points won so far this game. */
  score: number;
}

export interface Config {
  /** Points needed to win the game. */
  target: number;
}

/**
 * `playing`: a round is under way. `roundover`: someone went out (or the round
 * was blocked) and the next round waits for a `deal`. `gameover`: someone
 * reached the target; a `rematch` starts again from nought.
 */
export type Phase = 'playing' | 'roundover' | 'gameover';

export type MoveKind = 'start' | 'play' | 'draw' | 'pass' | 'away' | 'deal' | 'rematch';

export interface LastMove {
  /** uid of whoever sent the move (for `away`, not the player it moved for). */
  by: string;
  kind: MoveKind;
  /** Seat the move was made for. */
  seat: number;
  /** The card played, for `play` (and `away` when it played one). */
  card: string | null;
  /** The suit named, when that card was an eight. */
  suit: Suit | null;
}

export interface GameState {
  version: number;
  config: Config;
  players: Player[];
  /** Face-down cards still to draw; the next card drawn is the first one. */
  stock: string;
  /** Face-up discards, oldest first; the top card is the last two characters. Never empty. */
  pile: string;
  /** The suit to follow: the top card's, or the one named with an eight. */
  suit: Suit;
  phase: Phase;
  /** Seat on turn, or null between rounds and when the game is over. */
  toAct: number | null;
  /** `players[toAct].uid`, or ANY_PLAYER. Denormalized for the database rules. */
  turnUid: string;
  /** The player on turn has already drawn their one card this turn. */
  drew: boolean;
  /** Turns passed in a row with nothing left to draw; at one per player the round is blocked. */
  passes: number;
  /** Seat that leads this round. Moves one along every round. */
  starter: number;
  /** 1 for the first round of a game. */
  round: number;
  /** 1 for the first game in a room, +1 per rematch. */
  gameNo: number;
  lastMove: LastMove;
}

/** Randomness travels inside the move that uses it, so every client computes the same deck. */
export type Seed = number[];

export type Move =
  /** Play a card from your hand. `suit` is the suit you name when the card is an eight. */
  | { kind: 'play'; card: string; suit?: Suit }
  /** Take one card from the stock (the seed shuffles the pile back in if the stock is empty). */
  | { kind: 'draw'; seed: Seed }
  /** End your turn without playing: only after drawing, or when there is nothing to draw and nothing to play. */
  | { kind: 'pass' }
  /** Another player takes the whole turn for the absent player on turn (online only). */
  | { kind: 'away'; seed: Seed }
  /** After a round: shuffle and deal the next one. */
  | { kind: 'deal'; seed: Seed }
  /** After the game: scores back to nought and deal again. */
  | { kind: 'rematch'; seed: Seed };

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };
