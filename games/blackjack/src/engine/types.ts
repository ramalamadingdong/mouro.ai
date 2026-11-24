/**
 * Engine types and tunables. Zero runtime imports, so anything (UI, computer
 * players, a future server) can depend on this file without dragging the
 * reducer along.
 *
 * Chips are always whole numbers. Bets move in steps of `RULES.BET_STEP`
 * (5, so the 10/25/50/100 chips all fit); a 3:2 blackjack payout on an odd
 * multiple of 5 is rounded DOWN to the whole chip (25 pays 37).
 */

/**
 * A card is an integer 0..(52 × DECKS − 1). `card % 52` is its face:
 * `rank = (card % 52) >> 2` (0 = Two … 12 = Ace) and `suit = card & 3`
 * (0 clubs, 1 diamonds, 2 hearts, 3 spades). Every physical card in the shoe
 * has its own number, so "each card exactly once" is checkable even though a
 * six-deck shoe holds six Aces of spades.
 */
export type Card = number;

export const RULES = {
  MIN_PLAYERS: 1,
  MAX_PLAYERS: 8,
  /** Decks in the shoe. */
  DECKS: 6,
  /**
   * The cut card: at the start of a round, a shoe with fewer cards than this
   * left is reshuffled. One and a half decks, as in most casinos.
   */
  CUT: 78,
  /** Every bet is a multiple of this: the smallest step the 10/25/50/100 chips make. */
  BET_STEP: 5,
  /** Default table limits. */
  DEFAULT_MIN_BET: 10,
  DEFAULT_MAX_BET: 500,
  /** Default number of rounds in a game. */
  DEFAULT_ROUNDS: 20,
  /** Most hands one seat can hold after splitting. */
  MAX_HANDS: 4,
} as const;

export const SHOE_SIZE = 52 * RULES.DECKS;

/**
 * 'idle'     — game created, no round dealt yet.
 * 'betting'  — `toAct` is the seat placing a bet, in seat order. When the
 *              last bet is in, `toAct` is null and the dealer must send `next`
 *              to deal the cards.
 * 'playing'  — `toAct` is the seat playing its hand `players[toAct].active`.
 *              When every hand is finished, `toAct` is null and `next` turns
 *              the dealer's hole card.
 * 'dealer'   — the dealer's hand is face up. Each `next` draws one card for
 *              the dealer, or settles the round once the dealer stands.
 * 'settled'  — the round is paid; `result` is set; waits for `deal`.
 * 'gameover' — the last round is played, or no human can afford a bet.
 */
export type Phase = 'idle' | 'betting' | 'playing' | 'dealer' | 'settled' | 'gameover';

export type LastActionKind = 'bet' | 'sitout' | 'hit' | 'stand' | 'double' | 'split' | 'blackjack' | 'bust';

export interface LastAction {
  kind: LastActionKind;
  /** Chips involved (the bet, the extra chips for a double or split); 0 otherwise. */
  amount: number;
}

/** How a hand finished. */
export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface Hand {
  cards: Card[];
  /** Chips riding on this hand (doubled when doubled down). */
  bet: number;
  /** No more cards: stood, busted, doubled, 21, a blackjack, or split aces. */
  done: boolean;
  doubled: boolean;
  /** Made by splitting: a two-card 21 here is NOT a blackjack. */
  split: boolean;
  /** Set when the round is settled. */
  outcome: Outcome | null;
  /** Chips paid back on this hand when settled, stake included (0 for a loss). */
  paid: number;
}

export interface PlayerState {
  /** Stable identity: the realtime uid online, a `local-`/`cat-` id offline. */
  uid: string;
  name: string;
  /** False for computer players. The game ends when no human can bet. */
  isHuman: boolean;
  /** Chips not on the table. */
  stack: number;
  /** This round's hands. Empty while betting (until this seat bets) and for a seat sitting the round out. */
  hands: Hand[];
  /** Index into `hands` of the hand being played. */
  active: number;
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
  minBet: number;
  maxBet: number;
  /** Rounds in a game. */
  rounds: number;
}

export interface RoundResult {
  /** Dealer's final total (bust when over 21). */
  dealerTotal: number;
  dealerBlackjack: boolean;
  /** Seat-indexed: chips won (positive) or lost (negative) this round. */
  net: number[];
}

/**
 * `turnUid` value meaning "no single player is on turn": the dealer must
 * act (`next`), the round is over (`deal`) or the game is over (`rematch`).
 * Any seated player may send those. The database rules read this field to
 * decide who may write, so it is denormalized into the state.
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
  /** Rounds dealt so far (1-based once the first `deal` lands). */
  handNo: number;
  /** Undealt cards; the engine deals from the end. */
  shoe: Card[];
  /** The dealer's cards. `dealer[1]` is the hole card, face down until 'dealer'. */
  dealer: Card[];
  /**
   * Net chips the house has won over the game (negative when the table is
   * ahead). The house has a bottomless bank, so this is what keeps the chip
   * count checkable: stacks + chips on the table + house = seats × startingStack.
   */
  house: number;
  toAct: number | null;
  /** Denormalized `players[toAct].uid`, or ANY_PLAYER when `toAct` is null. */
  turnUid: string;
  result: RoundResult | null;
  /** Set in 'gameover': the seat holding the most chips. */
  winner: number | null;
  lastMove: LastMove | null;
}

/**
 * Dealer moves — any player at the table may send them when `turnUid` is
 * ANY_PLAYER:
 *   deal     start the next round. Carries the seed for a reshuffle: ALL
 *            randomness enters the engine here (and in `rematch`).
 *   next     deal the cards / turn the hole card / draw one dealer card /
 *            settle. `from` must be the current phase AND the dealer's card
 *            count, so two clients racing to send it cannot advance twice.
 *   rematch  from 'gameover': reset every stack and deal round 1.
 *
 * Player moves — only from the seat in `toAct`:
 *   bet      while betting. `amount` 0 sits this round out.
 *   hit / stand / double / split   while playing, on the active hand.
 *
 * away — sent by any OTHER player for the seat in `toAct` when that player has
 * gone: sits them out of the round while betting, stands while playing. The
 * engine cannot see presence; the database rules and the client decide when
 * it is allowed.
 */
export type Move =
  | { kind: 'deal'; seed: number[] }
  | { kind: 'next'; from: Phase; dealerCards: number }
  | { kind: 'rematch'; seed: number[] }
  | { kind: 'bet'; amount: number }
  | { kind: 'hit' }
  | { kind: 'stand' }
  | { kind: 'double' }
  | { kind: 'split' }
  | { kind: 'away' };

/** The moves a player makes on their own turn. */
export type PlayerMove = Extract<Move, { kind: 'bet' | 'hit' | 'stand' | 'double' | 'split' }>;

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };

export type LegalActions =
  | {
      kind: 'bet';
      seat: number;
      /** Smallest bet (0 = sit out is always allowed too). */
      minBet: number;
      /** Largest bet: the table maximum, capped at the stack, rounded down to a step. */
      maxBet: number;
      step: number;
    }
  | {
      kind: 'play';
      seat: number;
      hand: number;
      canHit: boolean;
      canDouble: boolean;
      canSplit: boolean;
    };

export interface NewGameOptions {
  players: { uid: string; name: string; isHuman: boolean }[];
  startingStack: number;
  minBet?: number;
  maxBet?: number;
  rounds?: number;
}
