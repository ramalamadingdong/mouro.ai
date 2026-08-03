/**
 * Every shape the engine deals in. ZERO runtime imports — this file must stay
 * importable from anywhere (tests, scripts, the CPU) without pulling in code.
 *
 * The whole engine is pure: no React, no Firebase, no Expo. `GameState` is
 * JSON-clean by construction, because it is written to the Realtime Database
 * verbatim and read back through `normalize()`.
 */

export type Seat = 'p0' | 'p1';

/**
 * Where a game is.
 *
 *  - `opening`  both players roll one die to decide who starts; ties re-roll.
 *  - `roll`     the player on roll must roll — and may double FIRST.
 *  - `moving`   dice are on the table; the whole turn must be committed at once.
 *  - `doubled`  a double is on offer; the responder must take or pass.
 *  - `gameOver` this game is scored; either player may start the next one.
 *  - `matchOver` the match is decided; either player may vote to rematch.
 *
 * The Crawford rule is deliberately NOT a phase — it is a property of an entire
 * game across every phase, so it lives as `GameState.crawford`. Making it a
 * phase would force a `crawfordRoll`/`crawfordMoving` twin of everything.
 */
export type Phase = 'opening' | 'roll' | 'moving' | 'doubled' | 'gameOver' | 'matchOver';

/**
 * One checker movement, expressed in the ACTING SEAT'S OWN FRAME (see board.ts):
 * both seats travel from index 23 down to 0, bear off at `OFF`, and re-enter
 * from `BAR`. The sentinels are chosen so `from - to` is the die consumed —
 * uniformly, including bar entry and exact bear-offs.
 */
export interface Step {
  /** 0..23, or `BAR` (24) when entering from the bar. */
  from: number;
  /** 0..23, or `OFF` (-1) when bearing off. */
  to: number;
}

export type MoveKind =
  | 'openingRoll'
  | 'roll'
  | 'play'
  | 'double'
  | 'take'
  | 'pass'
  | 'nextGame'
  | 'rematch';

/**
 * Everything a player can do.
 *
 * A turn is committed ATOMICALLY as a single `play`. That is not an
 * optimisation, it is what makes the rules checkable at all: the
 * must-use-both-dice rule means a locally legal step can be illegal because it
 * strands you on a shorter sequence, so validating step k requires enumerating
 * whole turns anyway. Once you enumerate, `play` is accepted iff the submitted
 * step list is a member of the maximal-line set — one membership test that
 * enforces bar-first, hitting, bearing off, must-use-both-dice, must-use-the-
 * larger-die and doubles-give-four without restating a single rule.
 *
 * Seeds ride INSIDE the roll moves, so `initial` + the ordered move log replays
 * a whole match deterministically. The opening position is fixed, so unlike the
 * gin app's deal, `initialMatchState` needs no seed at all.
 */
export type Move =
  | { kind: 'openingRoll'; seed: number[] }
  | { kind: 'roll'; seed: number[] }
  /** The whole turn. `[]` is a legal, and sometimes forced, "no play". */
  | { kind: 'play'; steps: Step[] }
  | { kind: 'double' }
  | { kind: 'take' }
  | { kind: 'pass' }
  | { kind: 'nextGame' }
  | { kind: 'rematch' };

/**
 * What the last accepted move was. UI HEURISTIC ONLY — animations and captions
 * read this; game logic never does. `at` is wall-clock from whichever client
 * wrote it and must not be trusted for ordering (that is what `version` is for).
 */
export interface LastMove {
  by: string;
  seat: Seat;
  kind: MoveKind;
  /** The dice on the table for a `play`, or the result of a roll. */
  dice?: number[];
  /** The committed steps for a `play`; `[]` for a forced no-play. */
  steps?: Step[];
  /** Own-frame indices, in the HIT player's frame, where a blot was sent to the bar. */
  hits?: number[];
  /** Cube value involved in a `double` / `take` / `pass`. */
  cube?: number;
  at: number;
}

/** How a single game finished. */
export interface GameResult {
  winner: Seat;
  /** 1 single, 2 gammon, 3 backgammon. Always 1 when the cube was passed. */
  multiplier: 1 | 2 | 3;
  /** The cube value that applied. A pass scores the value BEFORE the double. */
  cube: number;
  /** `cube * multiplier` — what was added to the winner's score. */
  points: number;
  /** How it ended, for the reveal copy. */
  how: 'single' | 'gammon' | 'backgammon' | 'pass';
  /** Score AFTER this game, for a stable end-of-game reveal. */
  scores: Record<Seat, number>;
  /** True if this was the Crawford game. */
  crawford: boolean;
}

/** How the match finished. */
export interface MatchResult {
  winner: Seat;
  scores: Record<Seat, number>;
  target: number;
  /** Games played in the match. */
  games: number;
  /** The loser never scored. */
  shutout: boolean;
}

/**
 * The complete authoritative state of a match. Written to the database WHOLE in
 * a single transaction and read back through `normalize()`.
 */
export interface GameState {
  /** Monotonic. The security rules reject any write that does not increase it. */
  version: number;

  /** seat -> uid. `p0` is always the host. */
  players: Record<Seat, string>;
  names: Record<Seat, string>;

  /** MATCH LENGTH IN POINTS (1, 3, 5, 7, 9, 11, 15, 21) — not games. */
  target: number;
  scores: Record<Seat, number>;
  /** 1-based game number within the match. */
  game: number;

  phase: Phase;
  turn: Seat;
  /**
   * Denormalized `players[turn]`. The RTDB security rule can only compare
   * scalars it can read, so the seat->uid indirection has to be flattened here.
   * `commit()` re-syncs it on every accepted move; `normalize()` rejects a
   * snapshot where it disagrees.
   */
  turnUid: string;

  /**
   * 24 signed point counts in p0's ABSOLUTE frame. `+n` = n p0 checkers,
   * `-n` = n p1 checkers, `0` = empty. Always exactly 24 entries.
   */
  points: number[];
  bar: Record<Seat, number>;
  off: Record<Seat, number>;

  /** `[]` before a roll, `[d1, d2]` after. Doubles stay TWO entries here. */
  dice: number[];

  cube: { value: number; owner: Seat | null };
  /** A live double awaiting take/pass; `null` otherwise. */
  offer: { by: Seat; value: number } | null;

  /** THIS game is the Crawford game — no doubling allowed. */
  crawford: boolean;
  /** The Crawford game has been played; latches for the rest of the match. */
  crawfordDone: boolean;

  /** Only meaningful while `phase === 'opening'`; each seat's single die. */
  opening: { p0: number | null; p1: number | null } | null;

  gameResult: GameResult | null;
  matchResult: MatchResult | null;
  lastMove: LastMove | null;
}

/** `applyMove` never throws — it returns one of these. */
export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

/** One legal way to play a whole turn. */
export interface TurnLine {
  steps: Step[];
  /** The die each step consumed, parallel to `steps`. */
  dice: number[];
  /** Own-frame indices, in the VICTIM's frame, of blots hit along the way. */
  hits: number[];
}
