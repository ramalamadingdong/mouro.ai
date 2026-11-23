/**
 * The rules of Tabby Eights (crazy eights, with cats), as one pure reducer.
 *
 * `applyMove(state, move, uid)` never throws and never mutates. The sender's
 * uid is an argument, not part of the move, so a payload cannot lie about who
 * sent it. Every success path ends at `commit`, which bumps `version`,
 * re-derives `turnUid` and stamps `lastMove` — the three things the database
 * rules read.
 *
 * Rules: each round, seven cards each (five with three or four players) and
 * one card face up on the pile. On your turn, play one card that matches the
 * suit to follow or the rank of the top card; an eight is wild and you name
 * the next suit. Instead you may draw one card from the stock, and then play
 * or pass. The first to empty their hand scores what everyone else still
 * holds (eights 50, pictures 10, aces 1, the rest their number). First to the
 * target wins the game.
 *
 * All randomness is a seed inside the move that uses it (`deal`, `rematch`,
 * and `draw` / `away` in case the stock runs out and the pile is shuffled
 * back in), so every client computes the same cards.
 */
import { handPoints, isSuit, isWild, rankOf, shuffle, split, suitOf, without, freshDeck } from './cards';
import { makeRng } from './rng';
import {
  ANY_PLAYER,
  RULES,
  SUITS,
  type ApplyResult,
  type GameState,
  type LastMove,
  type Move,
  type Player,
  type Seed,
  type Suit,
} from './types';

export interface NewGame {
  players: { uid: string; name: string; isHuman: boolean }[];
  target: number;
  /** uid of whoever starts the game (the host online, the human offline). */
  by: string;
  seed: Seed;
}

function clampTarget(n: number): number {
  return Math.min(RULES.MAX_TARGET, Math.max(RULES.MIN_TARGET, Math.round(n)));
}

export function handSize(players: number): number {
  return players <= 2 ? RULES.HAND_TWO : RULES.HAND_MORE;
}

export function topCard(state: GameState): string {
  return state.pile.slice(-2);
}

/**
 * Shuffle and deal a round. The first card turned up for the pile is the
 * first one in the stock that is not an eight, so a round never opens wild.
 */
function dealRound(players: Player[], seed: Seed): { players: Player[]; stock: string; pile: string } {
  const deck = shuffle(freshDeck(), makeRng(seed));
  const per = handSize(players.length);
  const dealt = players.map((p, i) => ({
    ...p,
    hand: deck.filter((_, k) => k < per * players.length && k % players.length === i).join(''),
  }));
  const rest = deck.slice(per * players.length);
  const at = rest.findIndex((c) => !isWild(c));
  const up = rest[at];
  rest.splice(at, 1);
  return { players: dealt, stock: rest.join(''), pile: up };
}

function cleanName(name: string): string {
  return Array.from(name.trim() || 'Player')
    .slice(0, 24)
    .join('');
}

/** A fresh game, the first round dealt, seat 0 to lead. */
export function createGame(options: NewGame): GameState {
  const seated: Player[] = options.players.slice(0, RULES.MAX_PLAYERS).map((p) => ({
    uid: p.uid,
    name: cleanName(p.name),
    isHuman: p.isHuman,
    sitOut: false,
    hand: '',
    score: 0,
  }));
  const { players, stock, pile } = dealRound(seated, options.seed);
  return {
    version: 1,
    config: { target: clampTarget(options.target) },
    players,
    stock,
    pile,
    suit: suitOf(pile),
    phase: 'playing',
    toAct: 0,
    turnUid: players[0]?.uid ?? ANY_PLAYER,
    drew: false,
    passes: 0,
    starter: 0,
    round: 1,
    gameNo: 1,
    lastMove: { by: options.by, kind: 'start', seat: 0, card: null, suit: null },
  };
}

/** May `card` go on the pile now? (Whether the player holds it is a separate question.) */
export function canPlay(state: GameState, card: string): boolean {
  if (isWild(card)) return true;
  return suitOf(card) === state.suit || rankOf(card) === rankOf(topCard(state));
}

/** The cards in the hand of the player on turn that may be played, in hand order. */
export function playable(state: GameState): string[] {
  if (state.toAct === null) return [];
  return split(state.players[state.toAct].hand).filter((c) => canPlay(state, c));
}

/** Cards that could still be drawn: the stock, plus the pile under its top card. */
export function drawable(state: GameState): number {
  return (state.stock.length + state.pile.length - 2) / 2;
}

export function canDraw(state: GameState): boolean {
  return state.phase === 'playing' && !state.drew && drawable(state) > 0;
}

/** Passing is allowed after drawing, or when there is nothing to draw and nothing to play. */
export function canPass(state: GameState): boolean {
  if (state.phase !== 'playing') return false;
  return state.drew || (drawable(state) === 0 && playable(state).length === 0);
}

/** The suit a player holds most of (eights not counted), ties in suit order. */
export function favouriteSuit(hand: string): Suit {
  const counts = SUITS.map((s) => split(hand).filter((c) => !isWild(c) && suitOf(c) === s).length);
  let best = 0;
  for (let i = 1; i < SUITS.length; i++) if (counts[i] > counts[best]) best = i;
  return SUITS[best];
}

/**
 * The card the table plays for a player who is away, or null to draw/pass.
 * Deterministic, so every client that races to send it plays the same one:
 * a non-eight of the suit they hold most of, else any non-eight, else an
 * eight naming that suit.
 */
export function autoPlay(state: GameState): { card: string; suit?: Suit } | null {
  const options = playable(state);
  if (options.length === 0 || state.toAct === null) return null;
  const hand = state.players[state.toAct].hand;
  const fav = favouriteSuit(hand);
  const plain = options.filter((c) => !isWild(c));
  const card = plain.find((c) => suitOf(c) === fav) ?? plain[0];
  if (card) return { card };
  const rest = without(hand, options[0]) ?? '';
  return { card: options[0], suit: rest.length > 0 ? favouriteSuit(rest) : suitOf(options[0]) };
}

/** Points the round's winner takes (everyone else's cards), or for a blocked round, the margins. */
function settle(players: Player[], winner: number): Player[] {
  const mine = handPoints(players[winner].hand);
  const won = players.reduce((sum, p, i) => (i === winner ? sum : sum + Math.max(0, handPoints(p.hand) - mine)), 0);
  return players.map((p, i) => (i === winner ? { ...p, score: p.score + won } : p));
}

/** The seat that won the round just finished, or null while one is still being played. */
export function roundWinner(state: GameState): number | null {
  if (state.phase === 'playing') return null;
  const out = state.players.findIndex((p) => p.hand.length === 0);
  return out >= 0 ? out : blockedWinner(state.players, state.lastMove.seat);
}

/** A blocked round goes to the lowest hand; a tie to the first of them after `last`. */
function blockedWinner(players: Player[], last: number): number {
  const n = players.length;
  let best = (last + 1) % n;
  for (let step = 2; step <= n; step++) {
    const seat = (last + step) % n;
    if (handPoints(players[seat].hand) < handPoints(players[best].hand)) best = seat;
  }
  return best;
}

/** The seat that won the game, or null. */
export function gameWinner(state: GameState): number | null {
  if (state.phase !== 'gameover') return null;
  let best = 0;
  state.players.forEach((p, i) => {
    if (p.score > state.players[best].score) best = i;
  });
  return best;
}

/** What the round just finished was worth to its winner. */
export function roundPoints(state: GameState): number {
  const w = roundWinner(state);
  if (w === null) return 0;
  const mine = handPoints(state.players[w].hand);
  return state.players.reduce((s, p, i) => (i === w ? s : s + Math.max(0, handPoints(p.hand) - mine)), 0);
}

function commit(state: GameState, by: string, lastMove: Omit<LastMove, 'by'>): GameState {
  const toAct = state.phase === 'playing' ? state.toAct : null;
  return {
    ...state,
    toAct,
    turnUid: toAct === null ? ANY_PLAYER : state.players[toAct].uid,
    version: state.version + 1,
    lastMove: { by, ...lastMove },
  };
}

/** End the round (someone went out, or it is blocked) and score it. */
function finishRound(state: GameState, winner: number): GameState {
  const players = settle(state.players, winner);
  const over = players.some((p) => p.score >= state.config.target);
  return { ...state, players, phase: over ? 'gameover' : 'roundover', toAct: null, drew: false, passes: 0 };
}

function nextSeat(state: GameState, seat: number): number {
  return (seat + 1) % state.players.length;
}

function setSitOut(players: Player[], seat: number, away: boolean): Player[] {
  return players.map((p, i) => (i === seat ? { ...p, sitOut: away } : p));
}

/** Play `card` for the player on turn. */
function play(state: GameState, card: string, named: Suit | undefined): ApplyResult | GameState {
  const seat = state.toAct;
  if (state.phase !== 'playing' || seat === null) return { ok: false, error: 'The round is over.' };
  const hand = without(state.players[seat].hand, card);
  if (hand === null) return { ok: false, error: 'That card is not in your hand.' };
  if (!canPlay(state, card)) return { ok: false, error: 'That card does not match the pile.' };
  if (named !== undefined && !isSuit(named)) return { ok: false, error: 'Name fish, yarn, mice or bells.' };
  const suit: Suit = isWild(card) ? (named ?? suitOf(card)) : suitOf(card);
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand } : p));
  const after: GameState = { ...state, players, pile: state.pile + card, suit, drew: false, passes: 0 };
  if (hand.length === 0) return finishRound(after, seat);
  return { ...after, toAct: nextSeat(state, seat) };
}

/** Take the top card of the stock, shuffling the pile (all but its top card) back in first if it is empty. */
function draw(state: GameState, seed: Seed): GameState | null {
  const seat = state.toAct;
  if (seat === null || !canDraw(state)) return null;
  let stock = state.stock;
  let pile = state.pile;
  if (stock.length === 0) {
    stock = shuffle(split(pile.slice(0, -2)), makeRng(seed)).join('');
    pile = pile.slice(-2);
  }
  const card = stock.slice(0, 2);
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand: p.hand + card } : p));
  return { ...state, players, stock: stock.slice(2), pile, drew: true, passes: 0 };
}

/** End the turn without playing. A full lap of passes with nothing to draw blocks the round. */
function pass(state: GameState): GameState {
  const seat = state.toAct as number;
  const stuck = drawable(state) === 0;
  const passes = stuck ? state.passes + 1 : 0;
  if (stuck && passes >= state.players.length) {
    return finishRound({ ...state, passes }, blockedWinner(state.players, seat));
  }
  return { ...state, toAct: nextSeat(state, seat), drew: false, passes };
}

function newRound(state: GameState, seed: Seed, starter: number, round: number, reset: boolean): GameState {
  const base = state.players.map((p) => ({ ...p, sitOut: false, score: reset ? 0 : p.score }));
  const { players, stock, pile } = dealRound(base, seed);
  return {
    ...state,
    players,
    stock,
    pile,
    suit: suitOf(pile),
    phase: 'playing',
    toAct: starter,
    drew: false,
    passes: 0,
    starter,
    round,
  };
}

const isSeed = (v: unknown): v is Seed =>
  Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every((x) => Number.isInteger(x));

export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const seatOfSender = state.players.findIndex((p) => p.uid === uid);
  if (seatOfSender < 0) return { ok: false, error: 'You are not playing in this game.' };

  switch (move.kind) {
    case 'play': {
      if (state.toAct !== seatOfSender) return { ok: false, error: 'It is not your turn.' };
      const seat = seatOfSender;
      const result = play(state, move.card, move.suit);
      if ('ok' in result) return result;
      return {
        ok: true,
        state: commit({ ...result, players: setSitOut(result.players, seat, false) }, uid, {
          kind: 'play',
          seat,
          card: move.card,
          suit: isWild(move.card) ? result.suit : null,
        }),
      };
    }

    case 'draw': {
      if (state.toAct !== seatOfSender) return { ok: false, error: 'It is not your turn.' };
      if (!isSeed(move.seed)) return { ok: false, error: 'Bad seed.' };
      if (state.drew) return { ok: false, error: 'You have already drawn this turn.' };
      const result = draw(state, move.seed);
      if (!result) return { ok: false, error: 'There is nothing left to draw.' };
      const seat = seatOfSender;
      return {
        ok: true,
        state: commit({ ...result, players: setSitOut(result.players, seat, false) }, uid, {
          kind: 'draw',
          seat,
          card: null,
          suit: null,
        }),
      };
    }

    case 'pass': {
      if (state.toAct !== seatOfSender) return { ok: false, error: 'It is not your turn.' };
      if (!canPass(state)) {
        return { ok: false, error: state.drew ? 'The round is over.' : 'Draw a card first, or play one.' };
      }
      const seat = seatOfSender;
      const after = pass({ ...state, players: setSitOut(state.players, seat, false) });
      return { ok: true, state: commit(after, uid, { kind: 'pass', seat, card: null, suit: null }) };
    }

    case 'away': {
      // Who may act for an absent player is the database rules' call (they
      // can see presence; the engine cannot). The engine only refuses the
      // nonsensical case of moving "for" yourself.
      const seat = state.toAct;
      if (state.phase !== 'playing' || seat === null) return { ok: false, error: 'The round is over.' };
      if (seat === seatOfSender) return { ok: false, error: 'It is your own turn.' };
      if (!isSeed(move.seed)) return { ok: false, error: 'Bad seed.' };
      // One whole turn: play if possible, else draw and play that if possible, else pass.
      let cur = state;
      let choice = autoPlay(cur);
      if (!choice && canDraw(cur)) {
        cur = draw(cur, move.seed) ?? cur;
        choice = autoPlay(cur);
      }
      let after: GameState;
      if (choice) {
        const played = play(cur, choice.card, choice.suit);
        if ('ok' in played) return played;
        after = played;
      } else {
        after = pass(cur);
      }
      return {
        ok: true,
        state: commit({ ...after, players: setSitOut(after.players, seat, true) }, uid, {
          kind: 'away',
          seat,
          card: choice?.card ?? null,
          suit: choice && isWild(choice.card) ? after.suit : null,
        }),
      };
    }

    case 'deal': {
      if (state.phase !== 'roundover') return { ok: false, error: 'Finish this round first.' };
      if (!isSeed(move.seed)) return { ok: false, error: 'Bad seed.' };
      const starter = nextSeat(state, state.starter);
      const next = newRound(state, move.seed, starter, state.round + 1, false);
      return { ok: true, state: commit(next, uid, { kind: 'deal', seat: starter, card: null, suit: null }) };
    }

    case 'rematch': {
      if (state.phase !== 'gameover') return { ok: false, error: 'Finish this game first.' };
      if (!isSeed(move.seed)) return { ok: false, error: 'Bad seed.' };
      // The next game is led by the seat after the one that led this game's first round.
      const n = state.players.length;
      const first = (((state.starter - (state.round - 1) + 1) % n) + n) % n;
      const next = newRound(state, move.seed, first, 1, true);
      return {
        ok: true,
        state: commit({ ...next, gameNo: state.gameNo + 1 }, uid, {
          kind: 'rematch',
          seat: first,
          card: null,
          suit: null,
        }),
      };
    }

    default:
      return { ok: false, error: 'Unknown move.' };
  }
}

