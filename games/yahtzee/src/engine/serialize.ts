/**
 * Snapshot repair + validation — the one boundary where untrusted data becomes
 * a typed GameState. Everything downstream may assume validity.
 *
 * Realtime Database damages what you write to it in three specific ways:
 *   1. Empty arrays and null-valued fields are PRUNED. A brand-new game has an
 *      all-null scorecard for every player, so the ENTIRE `cards` node vanishes
 *      in transit and must be rebuilt from scratch. Same for `dice: []` at the
 *      start of every turn and `result: null` for the whole game.
 *   2. Arrays come back as integer-keyed objects (`{"0":…,"1":…}`), and the key
 *      order is not guaranteed — they must be re-sorted NUMERICALLY, since
 *      "10" sorts before "9" lexicographically.
 *   3. Nothing else is coerced, so anything that survives must still be checked.
 *
 * `normalize` returns null on a structural violation rather than throwing, and
 * repairs only damage that is unambiguously recoverable.
 */

import { breakdown } from './scoring';
import {
  CATEGORIES,
  RULES,
  type Category,
  type GameState,
  type LastMove,
  type MatchResult,
  type MoveKind,
  type Phase,
  type Player,
  type ScoreBreakdown,
  type ScoreCard,
  type Seat,
} from './types';

const PHASES: readonly string[] = ['roll', 'decide', 'over'];
const MOVE_KINDS: readonly string[] = ['roll', 'score', 'rematch'];
const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Coerce a value that should be an array (may be pruned or integer-keyed). */
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      // Numeric sort, not lexicographic: "10" must follow "9".
      const sorted = keys.map(Number).sort((a, b) => a - b);
      return sorted.map((n) => v[String(n)]);
    }
    return [];
  }
  return [];
}

/**
 * Read a seat-indexed collection of fixed length `n`.
 *
 * `asArray` is WRONG for these. A per-seat array whose entries can themselves be
 * pruned comes back sparse, and compacting it by sorted key would slide a later
 * seat's entry onto an earlier seat — handing one player another's scorecard.
 * Reading by explicit index key keeps every seat aligned, leaving holes for the
 * per-entry normalizer to rebuild (and, where a hole is not legitimate, for the
 * box-count invariant at the end of `normalize` to reject).
 *
 * Turn order means a hole below the last filled seat is not reachable in honest
 * play today, so this is partly defensive — but it is free, and it is the
 * difference between detecting wire damage and silently misattributing scores.
 */
function asIndexed(v: unknown, n: number): unknown[] {
  if (Array.isArray(v)) return v;
  const o = isObj(v) ? v : {};
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) out.push(o[String(i)]);
  return out;
}

/**
 * A finite number, or null. NEVER write `Number(x) || null` for these: a
 * scorecard cell of 0 (a scratched category), a `turn` of 0 (the host's seat)
 * and a `rollsUsed` of 0 are all legitimate values that are falsy.
 */
function asFiniteOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** An integer in [lo, hi], or null. */
function asIntInRange(v: unknown, lo: number, hi: number): number | null {
  const n = asFiniteOrNull(v);
  if (n === null || !Number.isInteger(n) || n < lo || n > hi) return null;
  return n;
}

function normalizePlayers(v: unknown): Player[] | null {
  const raw = asArray(v);
  if (raw.length < 1 || raw.length > RULES.MAX_PLAYERS) return null;
  const players: Player[] = [];
  for (const p of raw) {
    if (!isObj(p)) return null;
    if (typeof p.uid !== 'string' || p.uid.length === 0) return null;
    // A missing name is cosmetic damage, not structural — fill it in.
    players.push({ uid: p.uid, name: typeof p.name === 'string' ? p.name : 'Player' });
  }
  return players;
}

/**
 * One scorecard. Every absent key is an open box; a present finite number is a
 * used box, including 0.
 */
function normalizeCard(v: unknown): ScoreCard {
  const o = isObj(v) ? v : {};
  const card = {} as ScoreCard;
  for (const cat of CATEGORIES) card[cat] = asFiniteOrNull(o[cat]);
  return card;
}

function normalizeLastMove(v: unknown): LastMove | null {
  if (!isObj(v)) return null;
  if (typeof v.by !== 'string') return null;
  if (typeof v.kind !== 'string' || !MOVE_KINDS.includes(v.kind)) return null;
  const seat = asFiniteOrNull(v.seat);
  if (seat === null) return null;
  const lm: LastMove = { by: v.by, seat, kind: v.kind as MoveKind, at: Number(v.at) || 0 };
  if (typeof v.category === 'string' && CATEGORY_SET.has(v.category)) {
    lm.category = v.category as Category;
  }
  const points = asFiniteOrNull(v.points);
  if (points !== null) lm.points = points;
  return lm;
}

function normalizeBreakdown(v: unknown): ScoreBreakdown | null {
  if (!isObj(v)) return null;
  const upper = asFiniteOrNull(v.upper);
  const bonus = asFiniteOrNull(v.bonus);
  const lower = asFiniteOrNull(v.lower);
  const yahtzeeBonus = asFiniteOrNull(v.yahtzeeBonus);
  const total = asFiniteOrNull(v.total);
  if (upper === null || bonus === null || lower === null) return null;
  if (yahtzeeBonus === null || total === null) return null;
  return { upper, bonus, lower, yahtzeeBonus, total };
}

function normalizeResult(v: unknown, seatCount: number): MatchResult | null {
  if (!isObj(v)) return null;
  const rawScores = asIndexed(v.scores, seatCount);
  const scores: ScoreBreakdown[] = [];
  for (const s of rawScores) {
    const b = normalizeBreakdown(s);
    if (b === null) return null;
    scores.push(b);
  }
  const winners: Seat[] = [];
  for (const w of asArray(v.winners)) {
    const n = asIntInRange(w, 0, seatCount - 1);
    if (n === null) return null;
    winners.push(n);
  }
  if (winners.length === 0) return null;
  return { scores, winners };
}

/** Repair a raw snapshot into a well-formed GameState, or null if it is not one. */
export function normalize(raw: unknown): GameState | null {
  if (!isObj(raw)) return null;

  const players = normalizePlayers(raw.players);
  if (!players) return null;
  const n = players.length;

  const version = asFiniteOrNull(raw.version);
  if (version === null) return null;

  if (typeof raw.phase !== 'string' || !PHASES.includes(raw.phase)) return null;
  const phase = raw.phase as Phase;

  const turn = asIntInRange(raw.turn, 0, n - 1);
  if (turn === null) return null;

  const rollsUsed = asIntInRange(raw.rollsUsed, 0, RULES.ROLLS_PER_TURN);
  if (rollsUsed === null) return null;

  // A finished game sits at ROUNDS + 1 — the turn that would have started it.
  const round = asIntInRange(raw.round, 1, RULES.ROUNDS + 1);
  if (round === null) return null;

  if (typeof raw.turnUid !== 'string') return null;
  // The security rules authorize writes off `turnUid`, so a snapshot where it
  // disagrees with `players[turn]` is either corrupt or hand-edited. The reducer
  // re-derives it on every commit and can never produce this.
  if (raw.turnUid !== players[turn].uid) return null;

  const dice: number[] = [];
  for (const d of asArray(raw.dice)) {
    const face = asIntInRange(d, 1, RULES.FACES);
    if (face === null) return null;
    dice.push(face);
  }
  if (dice.length !== 0 && dice.length !== RULES.DICE) return null;

  // `cards` is entirely pruned on a fresh game (every cell is null) and sparse
  // for most of it, so a missing entry is expected, not an error — rebuild one
  // all-open card per player.
  const rawCards = asIndexed(raw.cards, n);
  const cards: ScoreCard[] = [];
  for (let i = 0; i < n; i++) cards.push(normalizeCard(rawCards[i]));

  const rawBonus = asIndexed(raw.yahtzeeBonus, n);
  const yahtzeeBonus: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = asFiniteOrNull(rawBonus[i]);
    // Pruned (all zeros) is the common case on a fresh game.
    yahtzeeBonus.push(b === null || b < 0 ? 0 : b);
  }

  const result = normalizeResult(raw.result, n);

  const state: GameState = {
    version,
    players,
    phase,
    turn,
    turnUid: raw.turnUid,
    round,
    dice,
    rollsUsed,
    cards,
    yahtzeeBonus,
    result,
    lastMove: normalizeLastMove(raw.lastMove),
  };

  // ── Cross-field invariants ────────────────────────────────────────────────
  // These can only be checked once the whole object exists, and they are what
  // catch a snapshot that is individually well-typed but internally impossible.

  // A terminal phase must carry its result, and only a terminal phase may.
  if (phase === 'over' && state.result === null) return null;
  if (phase !== 'over' && state.result !== null) return null;

  // Phase must agree with the dice on the table.
  if (phase === 'roll' && (rollsUsed !== 0 || dice.length !== 0)) return null;
  if (phase === 'decide' && (rollsUsed === 0 || dice.length !== RULES.DICE)) return null;
  if (phase === 'over' && (round !== RULES.ROUNDS + 1 || dice.length !== 0)) return null;
  if (phase !== 'over' && round > RULES.ROUNDS) return null;

  // How many boxes each seat has filled is fully determined by where play has
  // reached: every seat has completed `round - 1` rounds, plus one more if the
  // turn has already passed them this round. Checking it exactly (rather than
  // just "not too many") is what stops a client from writing a state that
  // quietly grants itself extra turns, and it subsumes the weaker rule that
  // every card is full exactly when the game is over.
  for (let seat = 0; seat < n; seat++) {
    let used = 0;
    for (const cat of CATEGORIES) if (cards[seat][cat] !== null) used++;
    const expected = round - 1 + (seat < turn ? 1 : 0);
    if (used !== expected) return null;
  }

  // The archived totals must reconcile with the archived cards, so a client
  // cannot write a plausible-looking state that simply claims a higher score.
  if (state.result) {
    for (let seat = 0; seat < n; seat++) {
      const expected = breakdown(cards[seat], yahtzeeBonus[seat]);
      const got = state.result.scores[seat];
      if (
        got.upper !== expected.upper ||
        got.bonus !== expected.bonus ||
        got.lower !== expected.lower ||
        got.yahtzeeBonus !== expected.yahtzeeBonus ||
        got.total !== expected.total
      ) {
        return null;
      }
    }
  }

  return state;
}
