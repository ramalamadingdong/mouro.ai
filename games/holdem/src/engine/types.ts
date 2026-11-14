/**
 * Engine types and tunables. Zero runtime imports, so anything (UI, computer
 * players, a future server) can depend on this file without dragging the
 * reducer along.
 *
 * Chips are always whole numbers. Nothing in the engine divides a chip except
 * the split-pot code, which hands the remainder out explicitly.
 */

/**
 * A card is an integer 0..51: `rank = card >> 2` (0 = Two … 12 = Ace) and
 * `suit = card & 3` (0 clubs, 1 diamonds, 2 hearts, 3 spades). Integers rather
 * than objects because the Monte-Carlo equity estimate shuffles and evaluates
 * tens of thousands of cards per decision.
 */
export type Card = number;

export const RULES = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 6,
  /** Level-1 big blind unless the game options say otherwise (small blind is half). */
  DEFAULT_BIG_BLIND: 20,
  /** Blinds step up after this many hands unless the game config overrides it. */
  DEFAULT_BLIND_UP_EVERY: 6,
  /**
   * Big blind at each level, as a multiple of the level-1 big blind. Past the
   * end of the table the last value doubles every level, so a game can never
   * stall however long two players trade chips.
   */
  BLIND_MULTIPLIERS: [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 100],
} as const;

/**
 * 'idle'     — game created, no hand dealt yet.
 * betting    — 'preflop' | 'flop' | 'turn' | 'river'. `toAct` names the seat
 *              to act, or is null when the round is closed and the dealer must
 *              send `next`.
 * 'showdown' — the hand is over (by showdown OR because everyone else folded);
 *              `result` is set and chips are already paid out.
 * 'gameover' — one player holds every chip, or every human is out.
 */
export type Phase = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'gameover';

export type LastActionKind = 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface LastAction {
  kind: LastActionKind;
  /** Street total the action brought the player to (0 for fold/check). */
  amount: number;
}

export interface PlayerState {
  /** Stable identity: the realtime uid online, a `local-`/`cat-` id offline. */
  uid: string;
  name: string;
  /** False for computer players. The game ends when no human has chips left. */
  isHuman: boolean;
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in over the whole hand (includes `bet`). */
  committed: number;
  hole: Card[];
  /** Dealt into the current hand. False for busted players. */
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last FULL raise — the flag that decides who may re-raise. */
  acted: boolean;
  /**
   * Online only: somebody had to act for this player because they were away.
   * Cleared by the player's own next action. Clients use it to skip the grace
   * period on later turns, so one closed phone costs the table a single wait.
   */
  sitOut: boolean;
  lastAction: LastAction | null;
}

export interface GameConfig {
  startingStack: number;
  /** Level-1 big blind. */
  baseBigBlind: number;
  blindUpEvery: number;
}

export interface Pot {
  amount: number;
  /** Seats that can win this pot, ascending. */
  eligible: number[];
}

export interface ShownHand {
  category: number;
  name: string;
  score: number;
  /** The five cards that make the hand, strongest first. */
  best5: Card[];
}

export interface PotResult extends Pot {
  winners: number[];
  /** Chips each winner took from this pot (odd chips already assigned). */
  payouts: { seat: number; amount: number }[];
}

export interface HandResult {
  /** False when the hand ended because everyone else folded (no cards shown). */
  showdown: boolean;
  pots: PotResult[];
  /** Seat-indexed; null for seats that did not reach showdown. */
  hands: (ShownHand | null)[];
  /** Seat-indexed total paid out. */
  won: number[];
}

/**
 * `turnUid` value meaning "no single player is on turn": the round is closed
 * (someone must send `next`), the hand is over (`deal`) or the game is over
 * (`rematch`). Any seated player may send those. The database rules read this
 * field to decide who may write, so it is denormalized into the state.
 */
export const ANY_PLAYER = '*';

export interface LastMove {
  /** uid of whoever SENT the move (for `away`, not the player it acted for). */
  by: string;
  kind: Move['kind'];
  /** Seat the move acted on: the sender's, or the absent player's for `away`. */
  seat: number;
}

export interface GameState {
  /** Bumped on every successful move; the database rules require it to increase. */
  version: number;
  config: GameConfig;
  players: PlayerState[];
  phase: Phase;
  handNo: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  /** Undealt cards; the engine deals from the end. */
  deck: Card[];
  board: Card[];
  /** Highest street bet anyone must match. */
  currentBet: number;
  /** Size of the last full bet/raise: the minimum legal raise increment. */
  minRaise: number;
  toAct: number | null;
  /** Denormalized `players[toAct].uid`, or ANY_PLAYER when `toAct` is null. */
  turnUid: string;
  result: HandResult | null;
  /** Set in 'gameover': the seat holding the most chips. */
  winner: number | null;
  lastMove: LastMove | null;
}

/**
 * Dealer moves — any player at the table may send them when `turnUid` is
 * ANY_PLAYER:
 *   deal     start the next hand. Carries the seed for the shuffle (and, on
 *            hand 1, the button draw): ALL randomness enters the engine here.
 *   next     deal the next street, or go to showdown after the river. `from`
 *            must be the current phase, so two clients racing to send it
 *            cannot advance two streets.
 *   rematch  from 'gameover': reset every stack and deal hand 1.
 *
 * Player moves — only from the seat in `toAct`. `raise` covers an opening bet
 * too; `to` is always the player's new street total, never an increment.
 *
 * away — sent by any OTHER player for the seat in `toAct` when that player has
 * gone: checks if that is free, otherwise folds. The engine cannot see
 * presence; the database rules and the client decide when it is allowed.
 */
export type Move =
  | { kind: 'deal'; seed: number[] }
  | { kind: 'next'; from: Phase }
  | { kind: 'rematch'; seed: number[] }
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'raise'; to: number }
  | { kind: 'away' };

/** The four moves a player makes on their own turn. */
export type PlayerMove = Extract<Move, { kind: 'fold' | 'check' | 'call' | 'raise' }>;

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };

export interface LegalActions {
  seat: number;
  canCheck: boolean;
  /** Chips needed to call (already capped at the stack); 0 when checking is free. */
  callAmount: number;
  canRaise: boolean;
  /** Smallest legal `raise.to`. Equals `maxRaiseTo` when only an all-in is possible. */
  minRaiseTo: number;
  /** All-in: current street bet plus the whole stack. */
  maxRaiseTo: number;
}

export interface NewGameOptions {
  players: { uid: string; name: string; isHuman: boolean }[];
  startingStack: number;
  /** Level-1 big blind. Defaults to RULES.DEFAULT_BIG_BLIND. */
  bigBlind?: number;
  blindUpEvery?: number;
}
