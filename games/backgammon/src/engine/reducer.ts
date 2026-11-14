/**
 * The reducer: the only thing that may produce a new `GameState`.
 *
 * `applyMove` never throws and never mutates its input. It returns
 * `{ok:true, state}` or `{ok:false, error}` — the error strings are shown to
 * the player, so they are written as plain English.
 *
 * Both clients run this, and the winning writer's result is what lands in the
 * database (see `src/net/rooms.ts`, which runs this INSIDE the
 * realtime transaction). The security rules independently enforce the three
 * things they are able to see: membership, `turnUid`, and a strictly increasing
 * `version`. They cannot enforce the rules of the game, which is why every
 * client re-validates.
 */
import { CHECKERS, otherSeat, startingPoints } from './board';
import { DEFAULT_MATCH_LENGTH } from './match';
import { applySteps, isCompleteTurn, maxUsableDice, turnLines } from './moves';
import { rollDice, rollDie } from './rng';
import { buildGameResult, buildMatchResult, hasWon } from './score';
import type { ApplyResult, GameState, LastMove, Move, MoveKind, Seat, Step } from './types';

/** Which seat is this uid, if any? */
export function seatOf(state: GameState | null, uid: string | null): Seat | null {
  if (!state || !uid) return null;
  if (state.players.p0 === uid) return 'p0';
  if (state.players.p1 === uid) return 'p1';
  return null;
}

/**
 * A fresh match, ready for the opening roll.
 *
 * Note there is NO seed here. The opening position is fixed and every random
 * event in backgammon is a move that carries its own seed, so `initial` plus the
 * ordered move log replays a match exactly. (The gin rummy app has to bake its
 * first deal's seed into the initial state; this is strictly cleaner.)
 */
export function initialMatchState(args: {
  hostUid: string;
  guestUid: string;
  hostName: string;
  guestName: string;
  target?: number;
}): GameState {
  const target = args.target ?? DEFAULT_MATCH_LENGTH;
  const scores: Record<Seat, number> = { p0: 0, p1: 0 };
  return {
    version: 0,
    players: { p0: args.hostUid, p1: args.guestUid },
    names: { p0: args.hostName, p1: args.guestName },
    target,
    scores,
    game: 1,
    phase: 'opening',
    turn: 'p0',
    turnUid: args.hostUid,
    points: startingPoints(),
    bar: { p0: 0, p1: 0 },
    off: { p0: 0, p1: 0 },
    dice: [],
    opening: { p0: null, p1: null },
    gameResult: null,
    matchResult: null,
    lastMove: null,
  };
}

function clone(s: GameState): GameState {
  // Deterministic on JSON-clean state, which `GameState` is by construction.
  return JSON.parse(JSON.stringify(s)) as GameState;
}

function reject(error: string): ApplyResult {
  return { ok: false, error };
}

/**
 * The single exit for every accepted move. Bumps `version`, re-syncs the
 * denormalized `turnUid`, and stamps `lastMove` — all three of which the
 * security rules read, so no accepted move may skip this.
 */
function commit(
  s: GameState,
  uid: string,
  seat: Seat,
  kind: MoveKind,
  baseVersion: number,
  extra?: Partial<Pick<LastMove, 'dice' | 'steps' | 'hits'>>,
): ApplyResult {
  s.version = baseVersion + 1;
  s.turnUid = s.players[s.turn];
  const lastMove: LastMove = { by: uid, seat, kind, at: Date.now() };
  if (extra?.dice) lastMove.dice = extra.dice;
  if (extra?.steps) lastMove.steps = extra.steps;
  if (extra?.hits && extra.hits.length) lastMove.hits = extra.hits;
  s.lastMove = lastMove;
  return { ok: true, state: s };
}

/** Reset the board for a new game within the same match. */
function resetForNewGame(s: GameState): void {
  s.points = startingPoints();
  s.bar = { p0: 0, p1: 0 };
  s.off = { p0: 0, p1: 0 };
  s.dice = [];
  s.phase = 'opening';
  s.turn = 'p0';
  s.opening = { p0: null, p1: null };
  s.gameResult = null;
}

/** Score a finished game onto `s`, and decide whether the match is over too. */
function finishGame(s: GameState, result: GameState['gameResult']): void {
  if (!result) return;
  s.gameResult = result;
  s.scores = { ...result.scores };
  const match = buildMatchResult(s.scores, s.target, s.game);
  if (match) {
    s.matchResult = match;
    s.phase = 'matchOver';
  } else {
    s.phase = 'gameOver';
  }
  s.dice = [];
}

export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const baseVersion = state.version;

  // ── Terminal-phase moves: EITHER player may act, so they are handled before
  //    the turn check. The phase guard is what keeps them safe.
  if (move.kind === 'nextGame') {
    if (state.phase !== 'gameOver') return reject('The game is not over.');
    const seat = seatOf(state, uid);
    if (!seat) return reject('You are not in this match.');
    const s = clone(state);
    s.game += 1;
    resetForNewGame(s);
    return commit(s, uid, seat, 'nextGame', baseVersion);
  }

  if (move.kind === 'rematch') {
    if (state.phase !== 'matchOver') return reject('The match is not over.');
    const seat = seatOf(state, uid);
    if (!seat) return reject('You are not in this match.');
    const s = clone(state);
    s.scores = { p0: 0, p1: 0 };
    s.game = 1;
    s.matchResult = null;
    resetForNewGame(s);
    return commit(s, uid, seat, 'rematch', baseVersion);
  }

  // ── Everything else is turn-bound.
  if (uid !== state.turnUid) return reject("It's not your turn.");
  const seat = seatOf(state, uid);
  if (!seat) return reject('You are not in this match.');

  switch (move.kind) {
    case 'openingRoll': {
      if (state.phase !== 'opening') return reject('Not the opening roll.');
      if (!Array.isArray(move.seed) || move.seed.length === 0) return reject('Bad roll.');
      const s = clone(state);
      const opening = s.opening ?? { p0: null, p1: null };
      if (opening[seat] !== null) return reject('You have already rolled.');
      const d = rollDie(move.seed);
      opening[seat] = d;
      s.opening = opening;

      if (opening.p0 === null || opening.p1 === null) {
        // The other player still owes a die.
        s.turn = otherSeat(seat);
        return commit(s, uid, seat, 'openingRoll', baseVersion, { dice: [d] });
      }

      if (opening.p0 === opening.p1) {
        // Tie: both roll again. (Automatic doubles are an explicit non-goal.)
        s.opening = { p0: null, p1: null };
        s.turn = 'p0';
        return commit(s, uid, seat, 'openingRoll', baseVersion, { dice: [d] });
      }

      // The two opening dice ARE the winner's first roll — the real rule, and it
      // gives a free invariant: an opening turn never has doubles.
      // Tawleh: the higher die wins the start, and the winner then rolls
      // their own two dice for the first turn (the opening dice are not played).
      s.turn = opening.p0 > opening.p1 ? 'p0' : 'p1';
      s.dice = [];
      s.phase = 'roll';
      s.opening = null;
      return commit(s, uid, seat, 'openingRoll', baseVersion, { dice: [d] });
    }

    case 'roll': {
      if (state.phase !== 'roll') return reject('You cannot roll right now.');
      if (!Array.isArray(move.seed) || move.seed.length === 0) return reject('Bad roll.');
      const s = clone(state);
      const [a, b] = rollDice(move.seed);
      s.dice = [a, b];
      s.phase = 'moving';
      return commit(s, uid, seat, 'roll', baseVersion, { dice: [a, b] });
    }

    case 'play': {
      if (state.phase !== 'moving') return reject('There are no dice on the table.');
      const steps: Step[] = Array.isArray(move.steps) ? move.steps : [];

      // The ONE rule check. Membership in the maximal-line set is what enforces
      // bar-first, hitting, blocked points, exact and overshoot bear-offs,
      // must-use-both-dice, must-use-the-larger-die and doubles-give-four.
      if (!isCompleteTurn(state, seat, steps)) {
        const needed = maxUsableDice(state, seat);
        if (steps.length < needed) {
          return reject(
            needed === 1 ? 'You must play a die if you can.' : `You must play ${needed} dice if you can.`,
          );
        }
        return reject('That is not a legal play.');
      }

      const applied = applySteps(state, seat, steps);
      if (!applied) return reject('That is not a legal play.');

      const s = clone(state);
      s.points = applied.points;
      s.bar = applied.bar;
      s.off = applied.off;
      s.dice = [];

      if (hasWon(s, seat)) {
        finishGame(s, buildGameResult(s, seat));
        return commit(s, uid, seat, 'play', baseVersion, {
          dice: state.dice,
          steps,
          hits: applied.hits,
        });
      }

      s.turn = otherSeat(seat);
      s.phase = 'roll';
      return commit(s, uid, seat, 'play', baseVersion, {
        dice: state.dice,
        steps,
        hits: applied.hits,
      });
    }

    default:
      return reject('Unknown move.');
  }
}

/**
 * What this uid may legally do right now. Used by the UI to enable buttons and
 * by the CPU to decide what to consider — one source of truth for both.
 */
export function legalMoves(state: GameState, uid: string): MoveKind[] {
  const seat = seatOf(state, uid);
  if (!seat) return [];

  if (state.phase === 'gameOver') return ['nextGame'];
  if (state.phase === 'matchOver') return ['rematch'];
  if (uid !== state.turnUid) return [];

  switch (state.phase) {
    case 'opening':
      return state.opening && state.opening[seat] === null ? ['openingRoll'] : [];
    case 'roll':
      return ['roll'];
    case 'moving':
      return turnLines(state, seat).length ? ['play'] : [];
    default:
      return [];
  }
}

/** Convenience for the UI: has this seat borne off everything? */
export function isFinished(state: GameState, seat: Seat): boolean {
  return state.off[seat] >= CHECKERS;
}
