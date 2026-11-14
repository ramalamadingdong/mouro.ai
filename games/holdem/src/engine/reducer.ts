/**
 * The No-Limit Hold'em reducer: `applyMove(state, move, uid)` returns a new
 * state or an error and never throws or mutates its input. The same reducer
 * runs the offline game against the cats and the online rooms.
 *
 * The dealer is explicit. A betting round that closes does NOT deal the next
 * street by itself: it leaves `toAct === null` and waits for a `next` move, and
 * a finished hand waits for `deal`. That costs one extra move per street, and
 * buys two things: the UI can pace the deal and hold the showdown without the
 * engine knowing about time, and an all-in runout is revealed street by street
 * instead of jumping straight to the result. Online, what is on screen is
 * always exactly what is in the database.
 *
 * All randomness is a seed carried inside the move that consumes it (`deal`,
 * `rematch`); nothing here calls Math.random(). A game is fully replayable
 * from its options plus the ordered move log.
 */
import { freshDeck, shuffle } from './cards';
import { evaluate } from './evaluate';
import { buildPots, splitPot } from './pots';
import { makeRng } from './rng';
import {
  ANY_PLAYER,
  RULES,
  type ApplyResult,
  type GameState,
  type HandResult,
  type LegalActions,
  type Move,
  type NewGameOptions,
  type PlayerMove,
  type PlayerState,
  type PotResult,
  type ShownHand,
} from './types';

const BETTING_PHASES = ['preflop', 'flop', 'turn', 'river'] as const;

export function isBettingPhase(phase: GameState['phase']): boolean {
  return (BETTING_PHASES as readonly string[]).includes(phase);
}

/** Blinds for hand number `handNo` (1-based). */
export function blindsForHand(
  baseBigBlind: number,
  blindUpEvery: number,
  handNo: number,
): { smallBlind: number; bigBlind: number; level: number } {
  const level = Math.floor((Math.max(1, handNo) - 1) / Math.max(1, blindUpEvery));
  const table = RULES.BLIND_MULTIPLIERS;
  const last = table.length - 1;
  const multiplier = level <= last ? table[level] : table[last] * 2 ** (level - last);
  const bigBlind = Math.max(2, Math.round(baseBigBlind * multiplier));
  return { smallBlind: Math.max(1, Math.floor(bigBlind / 2)), bigBlind, level: level + 1 };
}

export function createGame(options: NewGameOptions): GameState {
  if (options.players.length < RULES.MIN_PLAYERS || options.players.length > RULES.MAX_PLAYERS) {
    throw new Error(`Hold'em needs ${RULES.MIN_PLAYERS}-${RULES.MAX_PLAYERS} players.`);
  }
  const baseBigBlind = Math.max(2, Math.floor(options.bigBlind ?? RULES.DEFAULT_BIG_BLIND));
  // Nobody may start already unable to post a blind.
  const startingStack = Math.max(baseBigBlind * 2, Math.floor(options.startingStack));
  const blindUpEvery = Math.max(1, Math.floor(options.blindUpEvery ?? RULES.DEFAULT_BLIND_UP_EVERY));
  const { smallBlind, bigBlind } = blindsForHand(baseBigBlind, blindUpEvery, 1);

  return {
    version: 0,
    config: { startingStack, baseBigBlind, blindUpEvery },
    players: options.players.map((p) => ({
      uid: p.uid,
      name: p.name,
      isHuman: p.isHuman,
      stack: startingStack,
      bet: 0,
      committed: 0,
      hole: [],
      inHand: false,
      folded: false,
      allIn: false,
      acted: false,
      sitOut: false,
      lastAction: null,
    })),
    phase: 'idle',
    handNo: 0,
    // Drawn from the first deal's seed, so creating a game needs no randomness.
    button: 0,
    smallBlind,
    bigBlind,
    deck: [],
    board: [],
    currentBet: 0,
    minRaise: bigBlind,
    toAct: null,
    turnUid: ANY_PLAYER,
    result: null,
    winner: null,
    lastMove: null,
  };
}

// ── Queries ────────────────────────────────────────────────────────────────

const isLive = (p: PlayerState): boolean => p.inHand && !p.folded;

/** Chips in the middle right now (all streets, including current bets). */
export function potTotal(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.committed, 0);
}

/** Every chip in the game. Constant for the whole game — the fuzz test's anchor. */
export function totalChips(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.stack + p.committed, 0);
}

/** First seat clockwise after `from` that satisfies `test`, or -1. */
function nextSeat(state: GameState, from: number, test: (p: PlayerState, seat: number) => boolean): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const seat = (from + step) % n;
    if (test(state.players[seat], seat)) return seat;
  }
  return -1;
}

/**
 * Does this seat still owe the round a decision?
 *
 * The first clause is the subtle one: when every opponent left in the hand is
 * all-in and this player already has them covered on this street, there is
 * nobody to bet at and nothing to call, so they are skipped even if they have
 * not "acted". Without it the lone player with chips would be asked to check
 * down an all-in runout, or to "call" a short all-in blind they already cover.
 */
function needsAction(state: GameState, seat: number): boolean {
  const p = state.players[seat];
  if (!isLive(p) || p.allIn) return false;
  let othersAllIn = true;
  let othersTopBet = 0;
  state.players.forEach((o, i) => {
    if (i === seat || !isLive(o)) return;
    if (!o.allIn) othersAllIn = false;
    othersTopBet = Math.max(othersTopBet, o.bet);
  });
  if (othersAllIn && p.bet >= othersTopBet) return false;
  return p.bet < state.currentBet || !p.acted;
}

/**
 * What the seat in `toAct` may do. The single statement of legality: the UI,
 * the computer players and the fuzz test all read it, and `applyMove`
 * validates against it. Folding is always legal and is not listed.
 */
export function legalActions(state: GameState): LegalActions | null {
  if (state.toAct === null || !isBettingPhase(state.phase)) return null;
  const seat = state.toAct;
  const p = state.players[seat];
  const callAmount = Math.min(Math.max(0, state.currentBet - p.bet), p.stack);
  const maxRaiseTo = p.bet + p.stack;
  // Someone must be able to respond, or a raise is just a bet at nobody.
  const someoneCanRespond = state.players.some((o, i) => i !== seat && isLive(o) && !o.allIn);
  // `acted` is only still true here when a SHORT all-in raised over a bet this
  // player already matched: that does not reopen the betting, so they may
  // call or fold but not re-raise.
  const canRaise = !p.acted && maxRaiseTo > state.currentBet && someoneCanRespond;
  return {
    seat,
    canCheck: callAmount === 0,
    callAmount,
    canRaise,
    // A stack too short for a full raise may still shove: min and max meet.
    minRaiseTo: Math.min(maxRaiseTo, state.currentBet + state.minRaise),
    maxRaiseTo,
  };
}

/** True once nobody can be dealt another hand: one stack left, or no human left. */
export function isGameOver(state: GameState): boolean {
  const alive = state.players.filter((p) => p.stack + p.committed > 0);
  return alive.length <= 1 || !alive.some((p) => p.isHuman);
}

// ── Internals (all mutate a private clone) ─────────────────────────────────

function clone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hole: [...p.hole] })),
    deck: [...state.deck],
    board: [...state.board],
    // `config` and `result` are never mutated after creation, so sharing them
    // is safe and keeps a clone cheap.
  };
}

function putIn(p: PlayerState, amount: number): void {
  p.stack -= amount;
  p.bet += amount;
  p.committed += amount;
  if (p.stack === 0) p.allIn = true;
}

/**
 * Give back the part of the biggest street bet that nobody matched (a bet
 * everyone folded to, or an all-in over a shorter stack). Done when the round
 * closes so the pot on screen is the pot actually being played for.
 */
function refundUncalled(state: GameState): void {
  let top = -1;
  let second = 0;
  state.players.forEach((p, i) => {
    if (!p.inHand) return;
    if (top < 0 || p.bet > state.players[top].bet) {
      if (top >= 0) second = Math.max(second, state.players[top].bet);
      top = i;
    } else {
      second = Math.max(second, p.bet);
    }
  });
  if (top < 0) return;
  const p = state.players[top];
  const excess = p.bet - second;
  if (excess <= 0 || p.folded) return;
  p.bet -= excess;
  p.committed -= excess;
  p.stack += excess;
  p.allIn = false;
}

/** Pay the pots out and end the hand. `showdown` is false when all but one folded. */
function settle(state: GameState, showdown: boolean): void {
  refundUncalled(state);
  const n = state.players.length;
  const hands: (ShownHand | null)[] = state.players.map((p) =>
    showdown && isLive(p) ? evaluate([...p.hole, ...state.board]) : null,
  );
  const won = new Array<number>(n).fill(0);

  const pots: PotResult[] = buildPots(
    state.players.map((p) => ({ committed: p.committed, folded: !isLive(p) })),
  ).map((pot) => {
    let winners = pot.eligible;
    if (showdown) {
      const best = Math.max(...pot.eligible.map((seat) => hands[seat]!.score));
      winners = pot.eligible.filter((seat) => hands[seat]!.score === best);
    }
    const payouts = splitPot(pot.amount, winners, state.button, n);
    for (const { seat, amount } of payouts) won[seat] += amount;
    return { ...pot, winners, payouts };
  });

  state.players.forEach((p, i) => {
    p.stack += won[i];
    p.bet = 0;
    p.committed = 0;
  });
  const result: HandResult = { showdown, pots, hands, won };
  state.result = result;
  state.phase = 'showdown';
  state.toAct = null;
}

/** Hand the turn to the next seat that owes a decision, or close the round. */
function advanceTurn(state: GameState, from: number): void {
  if (state.players.filter(isLive).length === 1) {
    settle(state, false);
    return;
  }
  const seat = nextSeat(state, from, (_p, i) => needsAction(state, i));
  if (seat >= 0) {
    state.toAct = seat;
  } else {
    refundUncalled(state);
    state.toAct = null;
  }
}

function deal(state: GameState, seed: readonly number[]): string | null {
  if (state.phase !== 'idle' && state.phase !== 'showdown') return 'A hand is still being played.';
  if (!Array.isArray(seed) || seed.length === 0 || !seed.every(Number.isFinite)) return 'A deal needs a seed.';

  if (isGameOver(state)) {
    state.phase = 'gameover';
    state.toAct = null;
    state.winner = state.players.reduce((best, p, i) => (p.stack > state.players[best].stack ? i : best), 0);
    return null;
  }

  const hasChips = (p: PlayerState): boolean => p.stack > 0;
  // One stream per hand, seeded by the move and salted with the hand number
  // so a client that reused a seed would still not repeat a deck.
  const rng = makeRng([...seed, state.handNo + 1]);
  state.handNo += 1;
  if (state.handNo === 1) {
    // First hand: draw for the button.
    state.button = Math.floor(rng() * state.players.length);
    if (!hasChips(state.players[state.button])) state.button = nextSeat(state, state.button, hasChips);
  } else {
    // "Moving button": it simply passes to the next player who still has
    // chips. (Casinos use a dead-button rule so nobody skips a blind when a
    // player busts; for a casual table the simpler rule is indistinguishable.)
    state.button = nextSeat(state, state.button, hasChips);
  }
  const { smallBlind, bigBlind } = blindsForHand(state.config.baseBigBlind, state.config.blindUpEvery, state.handNo);
  state.smallBlind = smallBlind;
  state.bigBlind = bigBlind;

  for (const p of state.players) {
    p.bet = 0;
    p.committed = 0;
    p.hole = [];
    p.inHand = hasChips(p);
    p.folded = false;
    p.allIn = false;
    p.acted = false;
    p.lastAction = null;
  }

  state.deck = shuffle(freshDeck(), rng);
  state.board = [];
  state.result = null;
  const playing = state.players.filter((p) => p.inHand).length;
  for (let round = 0; round < 2; round++) {
    let seat = state.button;
    for (let i = 0; i < playing; i++) {
      seat = nextSeat(state, seat, (p) => p.inHand);
      state.players[seat].hole.push(state.deck.pop()!);
    }
  }

  // Heads-up the button posts the SMALL blind and acts first preflop; with
  // three or more the blinds are the two seats to the button's left.
  const sbSeat = playing === 2 ? state.button : nextSeat(state, state.button, (p) => p.inHand);
  const bbSeat = nextSeat(state, sbSeat, (p) => p.inHand);
  const post = (seat: number, blind: number, kind: 'sb' | 'bb'): void => {
    const p = state.players[seat];
    putIn(p, Math.min(blind, p.stack));
    p.lastAction = { kind, amount: p.bet };
  };
  post(sbSeat, smallBlind, 'sb');
  post(bbSeat, bigBlind, 'bb');

  // The price to call is the full big blind even if the big blind could not
  // afford it; whatever nobody matches is refunded when the round closes.
  state.currentBet = bigBlind;
  state.minRaise = bigBlind;
  state.phase = 'preflop';
  advanceTurn(state, bbSeat);
  return null;
}

function rematch(state: GameState, seed: readonly number[]): string | null {
  if (state.phase !== 'gameover') return 'The game is not over yet.';
  for (const p of state.players) {
    p.stack = state.config.startingStack;
    p.sitOut = false;
  }
  state.handNo = 0;
  state.winner = null;
  state.phase = 'idle';
  return deal(state, seed);
}

function nextStreet(state: GameState, from: GameState['phase']): string | null {
  if (!isBettingPhase(state.phase) || state.toAct !== null) return 'The betting round is not finished.';
  // Two clients may both send `next` for the same closed round; the loser of
  // that race arrives here one street late and must be refused, not obeyed.
  if (from !== state.phase) return 'That street has already been dealt.';
  if (state.phase === 'river') {
    settle(state, true);
    return null;
  }
  for (const p of state.players) {
    p.bet = 0;
    p.acted = false;
    p.lastAction = null;
  }
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  const cards = state.phase === 'preflop' ? 3 : 1;
  for (let i = 0; i < cards; i++) state.board.push(state.deck.pop()!);
  state.phase = state.phase === 'preflop' ? 'flop' : state.phase === 'flop' ? 'turn' : 'river';
  // Postflop the first live seat left of the button opens (heads-up that is
  // the big blind, which falls out of the same rule).
  advanceTurn(state, state.button);
  return null;
}

function playerAction(state: GameState, action: PlayerMove, seat: number): string | null {
  const legal = legalActions(state);
  if (!legal) return 'Nobody is due to act.';
  if (seat !== legal.seat) return 'It is not your turn.';
  const p = state.players[seat];

  switch (action.kind) {
    case 'fold':
      p.folded = true;
      p.lastAction = { kind: 'fold', amount: 0 };
      break;

    case 'check':
      if (!legal.canCheck) return 'There is a bet to call.';
      p.lastAction = { kind: 'check', amount: 0 };
      break;

    case 'call':
      if (legal.canCheck) return 'There is nothing to call.';
      putIn(p, legal.callAmount);
      p.lastAction = { kind: p.allIn ? 'allin' : 'call', amount: p.bet };
      break;

    case 'raise': {
      const to = action.to;
      if (!legal.canRaise) return 'Raising is not allowed here.';
      if (!Number.isInteger(to) || to < legal.minRaiseTo || to > legal.maxRaiseTo) {
        return `A raise must be between ${legal.minRaiseTo} and ${legal.maxRaiseTo}.`;
      }
      const opening = state.currentBet === 0;
      const increase = to - state.currentBet;
      putIn(p, to - p.bet);
      state.currentBet = to;
      // Only a FULL raise sets the next minimum and reopens the betting. A
      // short all-in leaves `minRaise` and everyone's `acted` flag alone, so
      // players who already matched the previous bet can only call or fold.
      if (increase >= state.minRaise) {
        state.minRaise = increase;
        for (const other of state.players) other.acted = false;
      }
      p.lastAction = { kind: p.allIn ? 'allin' : opening ? 'bet' : 'raise', amount: to };
      break;
    }
  }

  p.acted = true;
  advanceTurn(state, seat);
  return null;
}

/** Act for the absent player on turn: check if that is free, otherwise fold. */
function away(state: GameState, senderSeat: number): string | null {
  const legal = legalActions(state);
  if (!legal) return 'Nobody is due to act.';
  if (senderSeat === legal.seat) return 'You cannot be away from your own turn.';
  const error = playerAction(state, { kind: legal.canCheck ? 'check' : 'fold' }, legal.seat);
  if (error === null) state.players[legal.seat].sitOut = true;
  return error;
}

// ── Public reducer ─────────────────────────────────────────────────────────

/**
 * Apply one move. `uid` is who is sending it, and is an argument rather than
 * a field on the move so a payload cannot lie about its sender (the same
 * convention as the other games' engines).
 */
export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const seat = state.players.findIndex((p) => p.uid === uid);
  if (seat < 0) return { ok: false, error: 'You are not seated at this table.' };

  const next = clone(state);
  let error: string | null;
  let actedOn = seat;
  switch (move.kind) {
    case 'deal':
      error = deal(next, move.seed);
      break;
    case 'rematch':
      error = rematch(next, move.seed);
      break;
    case 'next':
      error = nextStreet(next, move.from);
      break;
    case 'fold':
    case 'check':
    case 'call':
    case 'raise':
      error = playerAction(next, move, seat);
      if (error === null) next.players[seat].sitOut = false;
      break;
    case 'away':
      actedOn = state.toAct ?? seat;
      error = away(next, seat);
      break;
    default:
      error = 'Unknown move.';
  }
  if (error !== null) return { ok: false, error };

  // The one commit point: everything the database rules read is derived here.
  next.version = state.version + 1;
  next.turnUid = next.toAct === null ? ANY_PLAYER : next.players[next.toAct].uid;
  next.lastMove = { by: uid, kind: move.kind, seat: actedOn };
  return { ok: true, state: next };
}
