/**
 * The computer opponent.
 *
 * Pure TypeScript, engine imports only, and NO `Math.random`: variety comes
 * from an rng seeded on the position, so the same position always yields the
 * same move (tests stay stable) while play still varies across a match.
 *
 *   easy    races and hits, and picks its second-best move about one turn in four
 *   medium  full symmetric evaluation of every distinct resulting position
 *   hard    medium, plus a 1-ply expectimax over all 21 opponent rolls for the
 *           best candidates (the opponent replies with its best move each roll)
 *
 * Candidates come from `distinctTurns` — one per resulting position — so the
 * search never wastes effort on different orderings of the same move.
 */
import { toScratch, type Scratch } from '@/engine/board';
import { applyPly, distinctTurns } from '@/engine/moves';
import { makeRng } from '@/engine/rng';
import { seatOf } from '@/engine/reducer';
import type { GameState, Move, Seat, Step, TurnLine } from '@/engine/types';
import { evaluate, evaluateSimple, flip } from '@/ai/eval';
import type { Difficulty } from '@/ai/difficulty';

interface Tier {
  full: boolean;
  lookahead: boolean;
  topK: number;
  blunder: number;
}

const TIERS: Record<Difficulty, Tier> = {
  easy: { full: false, lookahead: false, topK: 0, blunder: 0.25 },
  medium: { full: true, lookahead: false, topK: 0, blunder: 0 },
  hard: { full: true, lookahead: true, topK: 5, blunder: 0 },
};

/** The 21 distinct rolls with their weight out of 36. */
const ROLLS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) out.push([a, b, a === b ? 1 : 2]);
  return out;
})();

function afterLine(base: Scratch, line: TurnLine): Scratch {
  const b: Scratch = { pts: base.pts.slice(), bar: base.bar, off: base.off, oppBar: base.oppBar };
  for (let i = 0; i < line.steps.length; i++) {
    const st = line.steps[i];
    const hit = st.to !== -1 && b.pts[st.to] === -1;
    applyPly(b, { step: st, die: line.dice[i], hit });
  }
  return b;
}

/** A minimal GameState around a scratch board, so the engine can enumerate moves for it. */
function scratchToState(b: Scratch, dice: number[]): GameState {
  const points = new Array<number>(24);
  for (let i = 0; i < 24; i++) points[i] = b.pts[i];
  let theirs = 0;
  for (let i = 0; i < 24; i++) if (b.pts[i] < 0) theirs -= b.pts[i];
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
    off: { p0: b.off, p1: 15 - theirs - b.oppBar },
    dice,
    opening: null,
    gameResult: null,
    matchResult: null,
    lastMove: null,
  };
}

/**
 * Expected value of `after` (my position once I have moved) when the opponent
 * rolls every possible roll and answers each with its best move.
 */
function expectimax(after: Scratch): number {
  const theirs = flip(after);
  let total = 0;
  for (const [d1, d2, w] of ROLLS) {
    const lines = distinctTurns(scratchToState(theirs, [d1, d2]), 'p0');
    let best = -Infinity;
    // After their reply it is MY roll, so from their side the one on roll is 'them'.
    for (const line of lines) {
      const v = evaluate(afterLine(theirs, line), 'them');
      if (v > best) best = v;
    }
    if (best === -Infinity) best = evaluate(theirs, 'them'); // they cannot move
    total += w * -best;
  }
  return total / 36;
}

function lineKey(steps: Step[]): string {
  return steps.map((s) => `${s.from},${s.to}`).join('|');
}

export function chooseLine(state: GameState, seat: Seat, difficulty: Difficulty): Step[] {
  const tier = TIERS[difficulty];
  const lines = distinctTurns(state, seat);
  if (lines.length === 0) return [];
  if (lines.length === 1) return lines[0].steps;

  const base = toScratch(state, seat);
  const scored = lines.map((line) => {
    const after = afterLine(base, line);
    return { line, after, score: tier.full ? evaluate(after) : evaluateSimple(after) };
  });
  const order = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.score - a.score || (lineKey(a.line.steps) < lineKey(b.line.steps) ? -1 : 1);
  scored.sort(order);

  if (tier.lookahead) {
    const top = scored.slice(0, tier.topK);
    for (const c of top) c.score = expectimax(c.after);
    top.sort(order);
    scored.splice(0, top.length, ...top);
  }

  if (tier.blunder > 0 && scored.length > 1) {
    const rng = makeRng([state.version, state.game, 7]);
    if (rng() < tier.blunder) return scored[1].line.steps;
  }
  return scored[0].line.steps;
}

export function chooseMove(state: GameState, uid: string, difficulty: Difficulty, seed: number[]): Move | null {
  const seat = seatOf(state, uid);
  if (!seat) return null;
  switch (state.phase) {
    case 'opening':
      return state.turn === seat ? { kind: 'openingRoll', seed } : null;
    case 'roll':
      return state.turn === seat ? { kind: 'roll', seed } : null;
    case 'moving':
      return state.turn === seat ? { kind: 'play', steps: chooseLine(state, seat, difficulty) } : null;
    case 'gameOver':
      return { kind: 'nextGame' };
    default:
      return null;
  }
}
