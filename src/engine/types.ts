/**
 * Shared type contract for the gin rummy engine.
 *
 * This module is the single source of truth for the game's data shapes. It has
 * ZERO runtime imports (pure types) and must never import from React, Firebase,
 * or Expo. Everything else in the app — the reducer, the Firebase sync layer,
 * the zustand stores, and the UI — builds against these types.
 *
 * Card encoding: a card is an integer 0..51.
 *   suit = Math.floor(id / 13)   // 0=♣ clubs, 1=♦ diamonds, 2=♥ hearts, 3=♠ spades
 *   rank = id % 13               // 0=Ace .. 12=King (Ace is LOW only)
 *   pip  = Math.min(rank + 1, 10)// A=1, 2..9 face value, 10/J/Q/K = 10
 */

/** A card, encoded as an integer 0..51. See module header for the encoding. */
export type CardId = number;

/** The two player seats. `p0` is always the room host. */
export type Seat = 'p0' | 'p1';

/** A meld: 3 or 4 cards forming a set (same rank) or a run (same suit, consecutive). */
export type Meld = CardId[];

/**
 * Phases of a round. `turn` says which seat acts; `phase` says what kind of
 * action is expected.
 *
 *  - `upcard1`  : non-dealer chooses to take the initial upcard or pass.
 *  - `upcard2`  : dealer chooses to take the initial upcard or pass.
 *  - `draw`     : current player must draw from stock or the discard pile.
 *  - `discard`  : current player must discard (or knock / gin / big gin).
 *  - `roundOver`: round scored; either player may deal the next round.
 *  - `matchOver`: match decided; either player may start a rematch.
 */
export type Phase =
  | 'upcard1'
  | 'upcard2'
  | 'draw'
  | 'discard'
  | 'roundOver'
  | 'matchOver';

/** A move submitted by a player. The reducer validates it against the state. */
export type Move =
  | { kind: 'takeUpcard' }
  | { kind: 'passUpcard' }
  | { kind: 'drawStock' }
  | { kind: 'drawDiscard' }
  | { kind: 'discard'; card: CardId }
  | { kind: 'knock'; discard: CardId } // deadwood 0 after discard = gin
  | { kind: 'bigGin' } // all 11 cards melded, no discard
  | { kind: 'nextRound'; seed: number[] } // deal next round (or redeal after void)
  | { kind: 'rematch'; seed: number[] }; // reset scores and start a new match

export type MoveKind = Move['kind'];

/** Denormalized record of the last accepted move, for UI hints and animations. */
export interface LastMove {
  by: string; // acting player's uid
  seat: Seat;
  kind: MoveKind;
  /** Card involved, when meaningful (the discarded card, the taken upcard, etc.). */
  card?: CardId;
  /** Date.now() at write time. HEURISTIC ONLY — never used in game logic. */
  at: number;
}

/** How a round ended. `void` means the stock ran out with no knock. */
export type RoundResultType = 'knock' | 'gin' | 'bigGin' | 'undercut' | 'void';

/**
 * Full description of a finished round, used to render the reveal screen and to
 * apply the score. All melds/deadwood reflect the OPTIMAL arrangement computed
 * at reveal, with the defender's optimal layoffs already applied (except vs gin).
 */
export interface RoundResult {
  type: RoundResultType;
  /** Seat that knocked/ginned, or null for a void hand. */
  knocker: Seat | null;
  knockerMelds: Meld[];
  knockerDeadwoodCards: CardId[];
  defenderMelds: Meld[];
  defenderDeadwoodCards: CardId[];
  /** Defender cards laid off onto knocker melds (empty vs gin/big gin/void). */
  layoffs: LayoffPlacement[];
  /** Final deadwood pip totals per seat after layoffs. */
  deadwood: Record<Seat, number>;
  /** Seat that won the round, or null for a void hand. */
  winner: Seat | null;
  /** Points awarded to the winner this round (0 for a void hand). */
  points: number;
  /**
   * The card the winner discarded to knock / go gin. `null` for big gin (all 11
   * cards melded, no discard) and for a void hand. For an undercut this is the
   * KNOCKER's discard that the defender then undercut.
   */
  knockCard: CardId | null;
  /** Whole hands at the moment of reveal, for the UI. */
  handAtReveal: Record<Seat, CardId[]>;
}

/** A single laid-off card: `card` placed onto knocker meld at index `meldIndex`. */
export interface LayoffPlacement {
  card: CardId;
  meldIndex: number;
}

/** Final match outcome, including end-of-match bonuses. */
export interface MatchResult {
  winner: Seat;
  /** Running scores before end bonuses (game bonus, boxes). */
  base: Record<Seat, number>;
  /** Boxes (rounds won) per seat; each is worth SCORING.BOX at match end. */
  boxes: Record<Seat, number>;
  /** Seat that received the game bonus. */
  gameBonusTo: Seat;
  /** True when the loser scored zero points (winner's total is doubled). */
  shutout: boolean;
  /** Final totals per seat, including all bonuses (and shutout doubling). */
  final: Record<Seat, number>;
}

/**
 * The complete, serializable game state. This object is written whole into
 * Realtime Database at `rooms/<code>/state` via a transaction, and both clients
 * run the reducer over it. Keep it JSON-clean: no undefined, no class instances,
 * arrays of CardId only.
 *
 * RTDB caveat: empty arrays and null fields are PRUNED on the wire. Always run
 * `normalize()` on a snapshot before handing it to the reducer or the UI.
 */
export interface GameState {
  /** Monotonic counter; increments on every accepted move. Enforced by rules. */
  version: number;
  /** Seat -> uid. p0 is the host. */
  players: Record<Seat, string>;
  /** Seat -> display name. */
  names: Record<Seat, string>;
  /** Match target score (default 100). */
  target: number;
  /** Running match scores. */
  scores: Record<Seat, number>;
  /** Rounds won per seat (boxes / lines), scored at match end. */
  boxes: Record<Seat, number>;
  /** 1-based round number. */
  round: number;
  dealer: Seat;
  phase: Phase;
  /** Seat expected to act next. */
  turn: Seat;
  /** Denormalized players[turn]; the security rules read this. */
  turnUid: string;
  /**
   * The card just taken from the discard pile this turn, which may NOT be
   * discarded on the same turn. Null when the current player drew from stock or
   * has not drawn yet.
   */
  noDiscard: CardId | null;
  /** Draw pile. The LAST element is the top (next to be drawn). */
  stock: CardId[];
  /** Discard pile. The LAST element is the top (face up). */
  discard: CardId[];
  hands: Record<Seat, CardId[]>;
  /** Set while phase is `roundOver`; null otherwise. */
  roundResult: RoundResult | null;
  /** Set while phase is `matchOver`; null otherwise. */
  matchResult: MatchResult | null;
  lastMove: LastMove | null;
}

/** Result of running the reducer: either a new state or a rejection reason. */
export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

/** An optimal (minimum-deadwood) arrangement of a hand into melds + leftovers. */
export interface Arrangement {
  melds: Meld[];
  deadwood: CardId[];
  deadwoodValue: number;
}

/** Best defender arrangement after laying off onto a knocker's melds. */
export interface LayoffResult {
  /** Defender's melds used in the best arrangement. */
  melds: Meld[];
  /** Cards laid off onto the knocker's melds. */
  layoffs: LayoffPlacement[];
  /** Defender's remaining deadwood cards after melds + layoffs. */
  deadwood: CardId[];
  /** Pip value of the remaining deadwood. */
  deadwoodValue: number;
}

/** A discard candidate that would leave the hand knockable, with the resulting deadwood. */
export interface KnockOption {
  /** The card to discard. */
  card: CardId;
  /** Deadwood after discarding `card` (<= SCORING.KNOCK_MAX is knockable; 0 = gin). */
  deadwoodAfter: number;
}

/** Tunable scoring constants for the match. */
export interface ScoringConfig {
  /** Bonus for going gin. */
  GIN: number;
  /** Bonus for big gin (all 11 cards melded). */
  BIG_GIN: number;
  /** Bonus to the defender for an undercut. */
  UNDERCUT: number;
  /** Game bonus awarded to the match winner. */
  GAME: number;
  /** Value of each box (round won) at match end. */
  BOX: number;
  /** Match target score. */
  TARGET: number;
  /** Multiplier applied to the winner's total on a shutout (loser scored 0). */
  SHUTOUT_X: number;
  /** Maximum deadwood at which a player may knock. */
  KNOCK_MAX: number;
  /** Number of cards dealt to each player. */
  HAND_SIZE: number;
}
