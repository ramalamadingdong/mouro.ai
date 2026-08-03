/**
 * The computer opponent.
 *
 * Pure TypeScript, engine imports only, and NO `Math.random`. Variety comes
 * from an rng seeded on the POSITION (`version`, `game`, cube), so the same
 * position always yields the same move — tests stay stable — while the sequence
 * still varies across a match and across matches.
 *
 * Difficulty is one knob struct, exactly as in the gin rummy app's CPU:
 *
 *   easy    race + hit, and blunders about one move in five
 *   medium  full evaluation, direct shots only, no lookahead
 *   hard    full evaluation with blocked-combination shots, plus a 1-ply
 *           average over all 21 distinct opponent rolls for the best candidates
 */
import { boardKey, toScratch, type Scratch } from '@/engine/board';
import { applyPly, turnLines } from '@/engine/moves';
import { makeRng } from '@/engine/rng';
import { seatOf } from '@/engine/reducer';
import type { GameState, Move, Seat, Step, TurnLine } from '@/engine/types';
import { evaluate, evaluateSimple } from '@/ai/eval';
import { shouldDouble, shouldTake } from '@/ai/cube-policy';
import type { Difficulty } from '@/ai/difficulty';

interface Tier {
  /** Use the full linear evaluation rather than the race-and-hit shortcut. */
  full: boolean;
  /** Count blockable indirect shots, not just direct ones. */
  combos: boolean;
  /** Average the top candidates over every opponent reply. */
  lookahead: boolean;
  /** How many candidates get the 1-ply treatment. */
  topK: number;
  /** Probability of choosing the second-best line instead of the best. */
  blunder: number;
}

const TIERS: Record<Difficulty, Tier> = {
  easy: { full: false, combos: false, lookahead: false, topK: 0, blunder: 0.2 },
  medium: { full: true, combos: false, lookahead: false, topK: 0, blunder: 0 },
  hard: { full: true, combos: true, lookahead: true, topK: 6, blunder: 0 },
};

/** Node budget for the 1-ply search; beyond it, hard degrades to 0-ply. */
const PLY_BUDGET = 20_000;

/** The 21 distinct rolls, with their weight out of 36. */
const ROLLS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) out.push([a, b, a === b ? 1 : 2]);
  }
  return out;
})();

/** Apply a whole line to a scratch board, returning a fresh one. */
function afterLine(base: Scratch, line: TurnLine): Scratch {
  const b: Scratch = {
    pts: base.pts.slice(),
    bar: base.bar,
    off: base.off,
    oppBar: base.oppBar,
  };
  for (let i = 0; i < line.steps.length; i++) {
    const st = line.steps[i];
    const hit = st.to !== -1 && b.pts[st.to] === -1;
    applyPly(b, { step: st, die: line.dice[i], hit });
  }
  return b;
}

/** Flip a scratch board into the opponent's own frame. */
function flip(b: Scratch): Scratch {
  const pts = new Int8Array(24);
  for (let i = 0; i < 24; i++) pts[i] = -b.pts[23 - i];
  // The opponent's borne-off count is not represented in my scratch board; 0 is
  // a safe stand-in because the reply search only compares sibling positions
  // that all share it.
  return { pts, bar: b.oppBar, off: 0, oppBar: b.bar };
}

/**
 * All the ways the opponent could answer, as scratch boards — used only for
 * hard's 1-ply average, so it takes the opponent's own greedy best rather than
 * searching further.
 */
function replyValue(after: Scratch, combos: boolean, budget: { n: number }): number {
  const opp = flip(after);
  let total = 0;
  let weight = 0;

  for (const [d1, d2, w] of ROLLS) {
    if (budget.n <= 0) break;
    // A pseudo-state is enough for `turnLines`: it only reads points/bar/off,
    // phase and dice.
    const pseudo = scratchToState(opp, [d1, d2]);
    const lines = turnLines(pseudo, 'p0');
    budget.n -= Math.max(1, lines.length);

    let best = -Infinity;
    for (const line of lines) {
      const v = evaluate(afterLine(opp, line), combos);
      if (v > best) best = v;
    }
    if (best === -Infinity) best = evaluate(opp, combos);
    total += w * best;
    weight += w;
  }

  // Their gain is my loss.
  return weight === 0 ? 0 : -(total / weight);
}

/** Wrap a scratch board in the minimal `GameState` `turnLines` needs. */
function scratchToState(b: Scratch, dice: number[]): GameState {
  const points = new Array<number>(24).fill(0);
  for (let i = 0; i < 24; i++) points[i] = b.pts[i];
  return {
    version: 0,
    players: { p0: 'a', p1: 'b' },
    names: { p0: 'a', p1: 'b' },
    target: 5,
    scores: { p0: 0, p1: 0 },
    game: 1,
    phase: 'moving',
    turn: 'p0',
    turnUid: 'a',
    points,
    bar: { p0: b.bar, p1: b.oppBar },
    off: { p0: b.off, p1: 0 },
    dice,
    cube: { value: 1, owner: null },
    offer: null,
    crawford: false,
    crawfordDone: false,
    opening: null,
    gameResult: null,
    matchResult: null,
    lastMove: null,
  };
}

/** Stable ordering for ties, so the same position always plays the same move. */
function lineKey(steps: Step[]): string {
  return steps.map((s) => `${s.from},${s.to}`).join('|');
}

/**
 * Choose the turn to play. Exported separately from `chooseMove` so the tests
 * (and a future hint button) can ask for the CPU's preferred play directly.
 */
export function chooseLine(state: GameState, seat: Seat, difficulty: Difficulty): Step[] {
  const tier = TIERS[difficulty];
  const lines = turnLines(state, seat);
  if (lines.length === 0) return [];
  if (lines.length === 1) return lines[0].steps;

  const base = toScratch(state, seat);

  // One entry per distinct RESULTING position: the CPU only cares where the
  // checkers end up, and this roughly halves the work in the middle game.
  const byPosition = new Map<string, { line: TurnLine; after: Scratch }>();
  for (const line of lines) {
    const after = afterLine(base, line);
    const key = boardKey(after);
    const seen = byPosition.get(key);
    if (!seen || lineKey(line.steps) < lineKey(seen.line.steps)) {
      byPosition.set(key, { line, after });
    }
  }

  const scored = Array.from(byPosition.values()).map((c) => ({
    ...c,
    score: tier.full ? evaluate(c.after, tier.combos) : evaluateSimple(c.after),
  }));

  // Deterministic sort: score first, then the lexicographically smallest line.
  scored.sort((a, b) => b.score - a.score || (lineKey(a.line.steps) < lineKey(b.line.steps) ? -1 : 1));

  if (tier.lookahead && scored.length > 1) {
    const budget = { n: PLY_BUDGET };
    const top = scored.slice(0, tier.topK);
    for (const c of top) {
      // Blend: the static score still matters, the reply average breaks ties
      // between positions that look equally good but are not equally safe.
      c.score = c.score * 0.4 + replyValue(c.after, tier.combos, budget) * 0.6;
    }
    top.sort((a, b) => b.score - a.score || (lineKey(a.line.steps) < lineKey(b.line.steps) ? -1 : 1));
    scored.splice(0, top.length, ...top);
  }

  if (tier.blunder > 0 && scored.length > 1) {
    const rng = makeRng([state.version, state.game, state.cube.value, 7]);
    if (rng() < tier.blunder) return scored[1].line.steps;
  }

  return scored[0].line.steps;
}

/**
 * The CPU's move for the current position.
 *
 * `seed` is supplied by the caller for the rolling moves so the dice stay
 * genuinely random in play, while every DECISION here remains deterministic.
 */
export function chooseMove(
  state: GameState,
  uid: string,
  difficulty: Difficulty,
  seed: number[],
): Move | null {
  const seat = seatOf(state, uid);
  if (!seat) return null;

  switch (state.phase) {
    case 'opening':
      if (state.turn !== seat) return null;
      return { kind: 'openingRoll', seed };
    case 'roll':
      if (state.turn !== seat) return null;
      return shouldDouble(state, seat, difficulty) ? { kind: 'double' } : { kind: 'roll', seed };
    case 'moving':
      if (state.turn !== seat) return null;
      return { kind: 'play', steps: chooseLine(state, seat, difficulty) };
    case 'doubled':
      if (state.turn !== seat) return null;
      return shouldTake(state, seat, difficulty) ? { kind: 'take' } : { kind: 'pass' };
    case 'gameOver':
      return { kind: 'nextGame' };
    default:
      return null;
  }
}
