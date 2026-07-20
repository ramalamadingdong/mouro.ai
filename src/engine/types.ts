/**
 * The Yahtzee domain contract.
 *
 * This module has ZERO runtime imports and must never import from React,
 * Firebase, or the DOM. Everything else — the reducer, the Firebase sync layer,
 * the zustand stores, and the UI — builds against these types. It does export a
 * handful of `as const` tables (categories, seats, tunables) because the runtime
 * and the type system must agree on them; the unions below are *derived* from
 * those tables rather than declared twice.
 *
 * Encoding notes (keep the wire format tiny and JSON-clean):
 *   - A die is an integer 1..6. A roll is `number[]` of length RULES.DICE.
 *   - A seat is an integer index into `players`, NOT a string union. The gin
 *     rummy reference used `'p0' | 'p1'` because it is strictly two-handed;
 *     Yahtzee seats 1..4 players, and an index makes `cards[seat]` and the
 *     turn-advance arithmetic (`(turn + 1) % players.length`) fall out for free.
 *   - A scorecard cell is `number | null`: null = not yet used, a number = used.
 *     ZERO IS A LEGAL SCORE (crossing a category out), so any code that reads a
 *     cell must distinguish "absent" from "falsy". See serialize.ts.
 *
 * No undefined, no class instances, no Date objects — the whole GameState is
 * written into Realtime Database verbatim and deep-cloned with JSON round-trips.
 */

/** Tunable rules. Every magic number in the engine lives here. */
export const RULES = {
  /** Dice rolled per turn. */
  DICE: 5,
  /** Faces per die (1..FACES). */
  FACES: 6,
  /** Rolls allowed per turn, including the first. */
  ROLLS_PER_TURN: 3,
  /** Rounds in a game — one per category, so every card fills exactly. */
  ROUNDS: 13,
  /** Bonus added when the upper section reaches UPPER_BONUS_AT. */
  UPPER_BONUS: 35,
  /** Upper-section subtotal that earns UPPER_BONUS. */
  UPPER_BONUS_AT: 63,
  /** Fixed score for a full house. */
  FULL_HOUSE: 25,
  /** Fixed score for a small straight (4 consecutive). */
  SMALL_STRAIGHT: 30,
  /** Fixed score for a large straight (5 consecutive). */
  LARGE_STRAIGHT: 40,
  /** Score for the first Yahtzee. */
  YAHTZEE: 50,
  /** Bonus per additional Yahtzee, once the Yahtzee box holds YAHTZEE. */
  YAHTZEE_BONUS: 100,
  /** Seats a room can hold. */
  MAX_PLAYERS: 4,
} as const;

/**
 * Upper-section categories, ordered so that `UPPER_CATEGORIES[face - 1]` is the
 * box a face counts into. The reducer relies on that alignment for joker rules.
 */
export const UPPER_CATEGORIES = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
] as const;

/** Lower-section categories, in scorecard order. */
export const LOWER_CATEGORIES = [
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yahtzee',
  'chance',
] as const;

/** Every category, in scorecard order. Length is RULES.ROUNDS by construction. */
export const CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES] as const;

export type UpperCategory = (typeof UPPER_CATEGORIES)[number];
export type LowerCategory = (typeof LOWER_CATEGORIES)[number];
export type Category = (typeof CATEGORIES)[number];

/**
 * A seat: an integer index into `GameState.players`, 0-based. Seat 0 is the
 * host and always acts first.
 */
export type Seat = number;

/** A player at the table. `uid` is the anonymous Firebase uid (or a local id in solo). */
export interface Player {
  uid: string;
  name: string;
}

/**
 * One player's scorecard. `null` means the box is still open; a number means it
 * has been used — INCLUDING 0, which is what scratching a category records.
 */
export type ScoreCard = Record<Category, number | null>;

/**
 * What kind of action the current player owes.
 *
 *  - `roll`   : start of a turn. The dice are empty; the only move is `roll`.
 *  - `decide` : dice are on the table. Score one of them, or re-roll if any of
 *               RULES.ROLLS_PER_TURN remain.
 *  - `over`   : every card is full; `result` is set and only `rematch` is legal.
 */
export type Phase = 'roll' | 'decide' | 'over';

/** A move submitted by a player. The reducer validates it against the state. */
export type Move =
  /**
   * Roll the dice. `keep` holds indices into the CURRENT `state.dice` that are
   * held back; every other die is re-rolled from `seed`. On the first roll of a
   * turn there are no dice yet, so `keep` must be empty.
   *
   * Holding dice is deliberately NOT a move: it is local UI state published to
   * a sibling RTDB node (rooms/<code>/holds), so toggling a die never costs a
   * database transaction round-trip.
   */
  | { kind: 'roll'; keep: number[]; seed: number[] }
  /** Commit the current dice to an open category and end the turn. */
  | { kind: 'score'; category: Category }
  /** Start a fresh game with the same players. Legal only in phase `over`. */
  | { kind: 'rematch' };

export type MoveKind = Move['kind'];

/** Result of running the reducer: either a new state or a rejection reason. */
export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

/** Per-seat score breakdown, computed from a finished (or in-progress) card. */
export interface ScoreBreakdown {
  /** Sum of the upper section, before the bonus. */
  upper: number;
  /** RULES.UPPER_BONUS if `upper >= RULES.UPPER_BONUS_AT`, else 0. */
  bonus: number;
  /** Sum of the lower section, excluding Yahtzee bonuses. */
  lower: number;
  /** Yahtzee bonuses earned (count * RULES.YAHTZEE_BONUS). */
  yahtzeeBonus: number;
  /** upper + bonus + lower + yahtzeeBonus. */
  total: number;
}

/** Set when `phase === 'over'`. Indexed by seat. */
export interface MatchResult {
  scores: ScoreBreakdown[];
  /** Seats holding the highest total. More than one on a tie. */
  winners: Seat[];
}

/** Denormalized record of the last accepted move. UI only. */
export interface LastMove {
  /** Acting player's uid. The security rules assert this equals auth.uid. */
  by: string;
  seat: Seat;
  kind: MoveKind;
  /** Present on a `score` move. */
  category?: Category;
  /** Present on a `score` move: the points that box took. */
  points?: number;
  /** Date.now() at write time. HEURISTIC ONLY — never used in game logic. */
  at: number;
}

/**
 * The complete, serializable game state, written whole into Realtime Database
 * at `rooms/<code>/state` via a transaction. Both clients run the reducer over
 * it.
 *
 * RTDB caveat: empty arrays and null fields are PRUNED on the wire, and arrays
 * come back as integer-keyed objects. At the start of a game EVERY scorecard
 * cell is null, so the entire `cards` node vanishes in transit. Always run
 * `normalize()` on a snapshot before handing it to the reducer or the UI.
 */
export interface GameState {
  /** Monotonic counter; increments on every accepted move. Enforced by rules. */
  version: number;
  /** Seated players, index = seat. Length 1..RULES.MAX_PLAYERS, never empty. */
  players: Player[];
  phase: Phase;
  /** Seat expected to act next. */
  turn: Seat;
  /** Denormalized `players[turn].uid`; the security rules read this. */
  turnUid: string;
  /** 1..RULES.ROUNDS. Increments when the turn wraps back to seat 0. */
  round: number;
  /** The dice on the table: RULES.DICE faces of 1..6, or [] before the first roll. */
  dice: number[];
  /** Rolls spent this turn, 0..RULES.ROLLS_PER_TURN. */
  rollsUsed: number;
  /** Scorecards, index = seat. Parallel to `players`. */
  cards: ScoreCard[];
  /** Count of *bonus* Yahtzees per seat (the first one scores in the box instead). */
  yahtzeeBonus: number[];
  /** Non-null exactly when `phase === 'over'`. */
  result: MatchResult | null;
  lastMove: LastMove | null;
}
