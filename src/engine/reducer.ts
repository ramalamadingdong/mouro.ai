/**
 * The single source of game truth. A pure reducer over GameState.
 *
 * `applyMove` never mutates its input and never throws: it deep-clones, mutates
 * the clone, and funnels every success through `commit()` (which bumps
 * `version`, re-derives `turnUid`, and stamps `lastMove`). Every return in this
 * file is either `commit(...)` or `reject(...)`.
 *
 * The actor's uid is a separate argument rather than a field on the move, so a
 * move payload can never lie about who sent it.
 */

import { makeRng, rollDie } from './rng';
import { breakdown, emptyCard, isLower, isYahtzee, scoreFor } from './scoring';
import {
  CATEGORIES,
  RULES,
  UPPER_CATEGORIES,
  type ApplyResult,
  type Category,
  type GameState,
  type LastMove,
  type MatchResult,
  type Move,
  type MoveKind,
  type Player,
  type ScoreCard,
  type Seat,
} from './types';

/** Deterministic deep clone of a JSON-clean state. */
function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

function reject(error: string): ApplyResult {
  return { ok: false, error };
}

/** The seat for a uid, or null if the uid is not a player. */
export function seatOf(state: GameState, uid: string): Seat | null {
  const i = state.players.findIndex((p) => p.uid === uid);
  return i === -1 ? null : i;
}

/**
 * Finalize a successful move: bump version, re-sync the denormalized turnUid,
 * record lastMove.
 *
 * `turnUid` is re-derived here rather than at each call site so a case handler
 * that changes `turn` can never forget to update it — the security rules
 * authorize writes off `turnUid`, so drift would lock a player out of the game.
 */
function commit(
  s: GameState,
  uid: string,
  seat: Seat,
  kind: MoveKind,
  extra: { category?: Category; points?: number },
  baseVersion: number,
): ApplyResult {
  s.version = baseVersion + 1;
  s.turnUid = s.players[s.turn].uid;
  const lastMove: LastMove = { by: uid, seat, kind, at: Date.now() };
  // Assigning `undefined` is not allowed on the wire (Firebase rejects it), so
  // optional fields are added conditionally rather than always written.
  if (extra.category !== undefined) lastMove.category = extra.category;
  if (extra.points !== undefined) lastMove.points = extra.points;
  s.lastMove = lastMove;
  return { ok: true, state: s };
}

/** A fresh game for the given seated players. Seat 0 (the host) acts first. */
export function initialGameState(players: Player[]): GameState {
  return {
    version: 0,
    players: players.map((p) => ({ uid: p.uid, name: p.name })),
    phase: 'roll',
    turn: 0,
    turnUid: players[0].uid,
    round: 1,
    dice: [],
    rollsUsed: 0,
    cards: players.map(() => emptyCard()),
    yahtzeeBonus: players.map(() => 0),
    result: null,
    lastMove: null,
  };
}

/** True when the joker rule governs this roll for this card. */
function jokerApplies(dice: number[], card: ScoreCard): boolean {
  return isYahtzee(dice) && card.yahtzee !== null;
}

/**
 * Categories `seat` may legally score the CURRENT dice into.
 *
 * Normally that is simply every open box. The exception is the joker rule: once
 * the Yahtzee box is resolved (50 *or* scratched to 0) a further Yahtzee is
 * forced into its matching upper box if that box is open; failing that, into
 * any open lower box; and only if the whole lower section is full may it be
 * used to scratch an upper box.
 *
 * `legalCategories` and `applyMove` must agree exactly — the fuzz test treats
 * any rejection of a listed category as a hard failure.
 */
export function legalCategories(state: GameState, seat: Seat): Category[] {
  const card = state.cards[seat];
  if (!card) return [];
  const open = CATEGORIES.filter((c) => card[c] === null);
  if (open.length === 0) return [];
  if (!jokerApplies(state.dice, card)) return open;

  const matching = UPPER_CATEGORIES[state.dice[0] - 1];
  if (card[matching] === null) return [matching];

  const lower = open.filter(isLower);
  if (lower.length > 0) return lower;

  // Lower section exhausted: the Yahtzee must scratch an open upper box.
  return open;
}

/** Legal move kinds for `uid` in the given state. */
export function legalMoves(state: GameState, uid: string): MoveKind[] {
  if (state.phase === 'over') {
    return seatOf(state, uid) === null ? [] : ['rematch'];
  }
  if (uid !== state.turnUid) return [];

  const kinds: MoveKind[] = [];
  if (state.rollsUsed < RULES.ROLLS_PER_TURN) kinds.push('roll');
  // Scoring requires dice on the table, which is exactly `phase === 'decide'`.
  if (state.phase === 'decide') kinds.push('score');
  return kinds;
}

/**
 * Roll the dice, keeping the entries of `dice` at the indices in `keep`.
 * Kept dice retain their positions so a UI holding "the die on the left" stays
 * visually stable across re-rolls.
 */
function reroll(dice: number[], keep: number[], seed: number[]): number[] {
  const rng = makeRng(seed);
  const held = new Set(keep);
  const next: number[] = [];
  for (let i = 0; i < RULES.DICE; i++) {
    next.push(held.has(i) ? dice[i] : rollDie(rng, RULES.FACES));
  }
  return next;
}

/** Advance to the next seat, or end the game once every card is full. */
function endTurn(s: GameState): void {
  s.dice = [];
  s.rollsUsed = 0;
  const next = (s.turn + 1) % s.players.length;
  s.turn = next;
  // The round advances when play wraps back to seat 0. With a single player
  // that is every turn, which is correct: solo plays RULES.ROUNDS turns.
  if (next === 0) s.round += 1;

  if (s.round > RULES.ROUNDS) {
    s.phase = 'over';
    s.result = buildResult(s);
  } else {
    s.phase = 'roll';
  }
}

/** Final per-seat breakdown and the winning seat(s). */
function buildResult(s: GameState): MatchResult {
  const scores = s.cards.map((card, seat) => breakdown(card, s.yahtzeeBonus[seat]));
  let best = -Infinity;
  for (const b of scores) if (b.total > best) best = b.total;
  const winners: Seat[] = [];
  scores.forEach((b, seat) => {
    if (b.total === best) winners.push(seat);
  });
  return { scores, winners };
}

/** Apply a move. Pure: returns a fresh state or a rejection. */
export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const baseVersion = state.version;
  const actingSeat = seatOf(state, uid);
  if (actingSeat === null) return reject('not a player');

  // `rematch` is the one move any seated player may make, and only once the
  // game is over — so it is handled before the turn gate below.
  if (move.kind === 'rematch') {
    if (state.phase !== 'over') return reject('the game is not over yet');
    const s = initialGameState(state.players);
    return commit(s, uid, actingSeat, 'rematch', {}, baseVersion);
  }

  if (state.phase === 'over') return reject('the game is over');
  if (uid !== state.turnUid) return reject('not your turn');
  const turn = state.turn;

  switch (move.kind) {
    case 'roll': {
      if (state.rollsUsed >= RULES.ROLLS_PER_TURN) return reject('no rolls left this turn');

      const keep = move.keep ?? [];
      if (state.rollsUsed === 0 && keep.length > 0) {
        return reject('nothing to keep before the first roll');
      }
      if (keep.length > RULES.DICE) return reject('cannot keep more dice than were rolled');
      const seen = new Set<number>();
      for (const i of keep) {
        if (!Number.isInteger(i) || i < 0 || i >= RULES.DICE) return reject('bad keep index');
        if (seen.has(i)) return reject('duplicate keep index');
        seen.add(i);
      }
      if (!Array.isArray(move.seed) || move.seed.length === 0) return reject('missing roll seed');
      // Keeping all five dice would burn a roll and change nothing; it is almost
      // always a misclick, and allowing it lets a client waste the turn.
      if (keep.length === RULES.DICE) return reject('keeping every die is not a roll');

      const s = clone(state);
      s.dice = reroll(state.dice, keep, move.seed);
      s.rollsUsed = state.rollsUsed + 1;
      s.phase = 'decide';
      return commit(s, uid, turn, 'roll', {}, baseVersion);
    }

    case 'score': {
      if (state.phase !== 'decide') return reject('roll the dice first');
      const card = state.cards[turn];
      if (!CATEGORIES.includes(move.category)) return reject('unknown category');
      if (card[move.category] !== null) return reject('that box is already used');
      if (!legalCategories(state, turn).includes(move.category)) {
        return reject('the joker rule forces a different category');
      }

      const s = clone(state);
      const joker = jokerApplies(state.dice, card);
      const points = scoreFor(move.category, state.dice, joker);
      s.cards[turn][move.category] = points;

      // A Yahtzee earns the bonus only once the box itself holds the full 50.
      // If the box was scratched to 0, joker rules still apply but no bonus is
      // paid — a rule that is easy to get wrong and easy to test.
      if (isYahtzee(state.dice) && card.yahtzee === RULES.YAHTZEE) {
        s.yahtzeeBonus[turn] += 1;
      }

      endTurn(s);
      return commit(s, uid, turn, 'score', { category: move.category, points }, baseVersion);
    }
  }
}
