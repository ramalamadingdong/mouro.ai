/**
 * `normalize()` — the repair layer between the Realtime Database and the engine.
 *
 * RTDB is not a JSON store; it is a tree, and it round-trips our state lossily:
 *
 *  - **`null` is deletion.** Any field set to null, and any empty array or
 *    object, simply is not there when you read it back.
 *  - **Arrays are integer-keyed objects.** They come back as arrays only when
 *    the keys happen to be contiguous from 0; otherwise you get `{"3": …}`.
 *
 * Two failure modes here are worse than anything in the gin rummy app and are
 * the reason this file could not be adapted from it:
 *
 *  1. `points` is a FIXED-LENGTH 24 array whose zeros AND NEGATIVES are
 *     meaningful. The classic `x || 0` idiom is a trap for every numeric field
 *     in this state — `Number.isFinite` everywhere instead.
 *  2. `opening: {p0: null, p1: null}` has BOTH children pruned, so the whole
 *     node vanishes. That is the normal state at the start of every game, so it
 *     must be reconstructed rather than treated as corruption.
 *
 * Anything that survives parsing then goes through a cross-field consistency
 * check. A snapshot that fails it returns `null` — the app shows "reconnecting"
 * rather than rendering a board that cannot exist. Fail closed.
 */
import { CHECKERS, POINTS } from './board';
import { CUBE_VALUES } from './cube';
import type {
  GameResult,
  GameState,
  LastMove,
  MatchResult,
  MoveKind,
  Phase,
  Seat,
  Step,
} from './types';

const PHASES: Phase[] = ['opening', 'roll', 'moving', 'doubled', 'gameOver', 'matchOver'];
const MOVE_KINDS: MoveKind[] = [
  'openingRoll',
  'roll',
  'play',
  'double',
  'take',
  'pass',
  'nextGame',
  'rematch',
];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function seat(v: unknown): Seat | null {
  return v === 'p0' || v === 'p1' ? v : null;
}

/**
 * Coerce a value that "should be" an array. Handles the integer-keyed-object
 * case RTDB produces for sparse arrays, and treats a missing value as empty.
 */
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    const keys = Object.keys(v)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => v[k]);
  }
  return [];
}

/** A number array of exactly `len` entries, padding with `fill`. */
function asFixedNumArray(v: unknown, len: number, fill: number): number[] | null {
  const raw = asArray(v);
  const out = new Array<number>(len).fill(fill);
  for (let i = 0; i < len; i++) {
    if (i >= raw.length) continue;
    const n = num(raw[i]);
    if (n === null) return null;
    out[i] = n;
  }
  // Trailing entries beyond `len` mean the snapshot is not our shape at all.
  if (raw.length > len) return null;
  return out;
}

function asNumArray(v: unknown): number[] | null {
  const raw = asArray(v);
  const out: number[] = [];
  for (const item of raw) {
    const n = num(item);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** `{p0, p1}` of numbers, defaulting a pruned child to 0. */
function asSeatNums(v: unknown): Record<Seat, number> | null {
  const o = isObj(v) ? v : {};
  const p0 = o.p0 === undefined ? 0 : num(o.p0);
  const p1 = o.p1 === undefined ? 0 : num(o.p1);
  if (p0 === null || p1 === null) return null;
  return { p0, p1 };
}

/** `{p0, p1}` of strings. Both must be present. */
function asSeatStrings(v: unknown): Record<Seat, string> | null {
  if (!isObj(v)) return null;
  const p0 = str(v.p0);
  const p1 = str(v.p1);
  if (p0 === null || p1 === null) return null;
  return { p0, p1 };
}

function asSteps(v: unknown): Step[] | null {
  const raw = asArray(v);
  const out: Step[] = [];
  for (const item of raw) {
    if (!isObj(item)) return null;
    // `from: 0` and `to: 0` and `to: -1` are all real values — never `||`.
    const from = num(item.from);
    const to = num(item.to);
    if (from === null || to === null) return null;
    if (from < 0 || from > POINTS) return null;
    if (to < -1 || to > POINTS - 1) return null;
    if (from <= to) return null;
    out.push({ from, to });
  }
  return out;
}

function asLastMove(v: unknown): LastMove | null {
  if (!isObj(v)) return null;
  const by = str(v.by);
  const s = seat(v.seat);
  const kind = str(v.kind) as MoveKind | null;
  const at = num(v.at);
  if (by === null || s === null || kind === null || !MOVE_KINDS.includes(kind)) return null;
  const out: LastMove = { by, seat: s, kind, at: at ?? 0 };
  if (v.dice !== undefined) {
    const dice = asNumArray(v.dice);
    if (dice) out.dice = dice;
  }
  if (v.steps !== undefined) {
    const steps = asSteps(v.steps);
    if (steps) out.steps = steps;
  } else if (kind === 'play') {
    // A forced no-play commits `steps: []`, which RTDB prunes away entirely.
    out.steps = [];
  }
  if (v.hits !== undefined) {
    const hits = asNumArray(v.hits);
    if (hits) out.hits = hits;
  }
  const cube = num(v.cube);
  if (cube !== null) out.cube = cube;
  return out;
}

function asGameResult(v: unknown): GameResult | null {
  if (!isObj(v)) return null;
  const winner = seat(v.winner);
  const multiplier = num(v.multiplier);
  const cube = num(v.cube);
  const points = num(v.points);
  const how = str(v.how);
  const scores = asSeatNums(v.scores);
  if (winner === null || multiplier === null || cube === null || points === null) return null;
  if (how !== 'single' && how !== 'gammon' && how !== 'backgammon' && how !== 'pass') return null;
  if (multiplier !== 1 && multiplier !== 2 && multiplier !== 3) return null;
  if (!scores) return null;
  return {
    winner,
    multiplier,
    cube,
    points,
    how,
    scores,
    crawford: v.crawford === true,
  };
}

function asMatchResult(v: unknown): MatchResult | null {
  if (!isObj(v)) return null;
  const winner = seat(v.winner);
  const scores = asSeatNums(v.scores);
  const target = num(v.target);
  const games = num(v.games);
  if (winner === null || !scores || target === null || games === null) return null;
  return { winner, scores, target, games, shutout: v.shutout === true };
}

/**
 * Parse and validate a raw RTDB snapshot. Returns `null` for anything that is
 * not a coherent game state.
 */
export function normalize(raw: unknown): GameState | null {
  if (!isObj(raw)) return null;

  const version = num(raw.version);
  const players = asSeatStrings(raw.players);
  const names = asSeatStrings(raw.names);
  const target = num(raw.target);
  const scores = asSeatNums(raw.scores);
  const game = num(raw.game);
  const phase = str(raw.phase) as Phase | null;
  const turn = seat(raw.turn);
  const turnUid = str(raw.turnUid);
  const points = asFixedNumArray(raw.points, POINTS, 0);
  const bar = asSeatNums(raw.bar);
  const off = asSeatNums(raw.off);
  const dice = asNumArray(raw.dice);

  if (
    version === null ||
    !players ||
    !names ||
    target === null ||
    !scores ||
    game === null ||
    phase === null ||
    !PHASES.includes(phase) ||
    turn === null ||
    turnUid === null ||
    !points ||
    !bar ||
    !off ||
    !dice
  ) {
    return null;
  }

  // Cube. `owner: null` is pruned away, but the node survives via `value`.
  const cubeRaw = isObj(raw.cube) ? raw.cube : {};
  const cubeValue = num(cubeRaw.value);
  if (cubeValue === null) return null;
  const cube = { value: cubeValue, owner: seat(cubeRaw.owner) };

  // Offer. Pruned entirely when null.
  let offer: GameState['offer'] = null;
  if (isObj(raw.offer)) {
    const by = seat(raw.offer.by);
    const value = num(raw.offer.value);
    if (by === null || value === null) return null;
    offer = { by, value };
  }

  // Opening. This is the one node that vanishes in its normal state, because
  // `{p0: null, p1: null}` prunes both children and then the parent.
  let opening: GameState['opening'] = null;
  if (isObj(raw.opening)) {
    const p0 = num(raw.opening.p0);
    const p1 = num(raw.opening.p1);
    opening = { p0, p1 };
  } else if (phase === 'opening') {
    opening = { p0: null, p1: null };
  }

  const state: GameState = {
    version,
    players,
    names,
    target,
    scores,
    game,
    phase,
    turn,
    turnUid,
    points,
    bar,
    off,
    dice,
    cube,
    offer,
    crawford: raw.crawford === true,
    crawfordDone: raw.crawfordDone === true,
    opening,
    gameResult: asGameResult(raw.gameResult),
    matchResult: asMatchResult(raw.matchResult),
    lastMove: asLastMove(raw.lastMove),
  };

  return isCoherent(state) ? state : null;
}

/**
 * Cross-field consistency. Anything that fails here is a snapshot no legal
 * sequence of moves could have produced — a partial write, a hand edit, or a
 * bug. Refusing it is what keeps the reducer's preconditions honest.
 *
 * Checker conservation lives here rather than in the security rules because
 * RTDB rules cannot sum an array. Both clients check it on every read, which is
 * the best a Cloud-Functions-free backend can do.
 */
function isCoherent(s: GameState): boolean {
  if (s.version < 0 || !Number.isInteger(s.version)) return false;
  if (s.target < 1 || !Number.isInteger(s.target)) return false;
  if (s.game < 1 || !Number.isInteger(s.game)) return false;

  // Board shape and checker conservation.
  if (s.points.length !== POINTS) return false;
  let p0 = 0;
  let p1 = 0;
  for (const v of s.points) {
    if (!Number.isInteger(v) || Math.abs(v) > CHECKERS) return false;
    if (v > 0) p0 += v;
    else p1 += -v;
  }
  for (const seatKey of ['p0', 'p1'] as Seat[]) {
    if (s.bar[seatKey] < 0 || s.off[seatKey] < 0 || s.off[seatKey] > CHECKERS) return false;
    if (!Number.isInteger(s.bar[seatKey]) || !Number.isInteger(s.off[seatKey])) return false;
  }
  if (p0 + s.bar.p0 + s.off.p0 !== CHECKERS) return false;
  if (p1 + s.bar.p1 + s.off.p1 !== CHECKERS) return false;

  // Dice.
  if (s.dice.length !== 0 && s.dice.length !== 2) return false;
  for (const d of s.dice) if (!Number.isInteger(d) || d < 1 || d > 6) return false;

  // Cube.
  if (!(CUBE_VALUES as readonly number[]).includes(s.cube.value)) return false;

  // The denormalized turn pointer must agree with the seat map.
  if (s.turnUid !== s.players[s.turn]) return false;

  // Phase coherence.
  if (s.phase === 'moving' && s.dice.length !== 2) return false;
  if (s.phase === 'doubled' && !s.offer) return false;
  if (s.phase !== 'doubled' && s.offer) return false;
  if (s.phase === 'opening' && !s.opening) return false;
  if (s.phase === 'gameOver' && !s.gameResult) return false;
  if (s.phase === 'matchOver' && (!s.matchResult || !s.gameResult)) return false;

  // A reached target and `matchOver` imply each other.
  const reached = s.scores.p0 >= s.target || s.scores.p1 >= s.target;
  if (reached !== (s.phase === 'matchOver')) return false;

  // The Crawford game cannot also be after the Crawford game.
  if (s.crawford && s.crawfordDone) return false;

  return true;
}
