/**
 * Cube decisions for the computer opponent.
 *
 * Real cube handling is match-equity work; this is a race-based heuristic with
 * a positional nudge, which is roughly how a decent club player without a table
 * memorised actually plays. It is deliberately not "correct" — the point is an
 * opponent who doubles when it is winning and takes when the take is not
 * hopeless, not one that plays a cube better than the human ever will.
 */
import { pipCount, toScratch } from '@/engine/board';
import { CUBE_MAX, canDouble } from '@/engine/cube';
import type { GameState, Seat } from '@/engine/types';
import { features } from '@/ai/eval';
import type { Difficulty } from '@/ai/difficulty';

interface CubeTier {
  /** Never turn the cube at all. */
  never?: boolean;
  /** Lead needed to double, as `frac * myPips + flat`. */
  doubleFrac: number;
  doubleFlat: number;
  /** Largest deficit still worth taking, as `frac * myPips + flat`. */
  takeFrac: number;
  takeFlat: number;
  /** Weigh position, not just the race. */
  positional: boolean;
}

const TIERS: Record<Difficulty, CubeTier> = {
  easy: { never: true, doubleFrac: 0, doubleFlat: 0, takeFrac: 0.25, takeFlat: 0, positional: false },
  medium: { doubleFrac: 0.15, doubleFlat: 4, takeFrac: 0.15, takeFlat: 4, positional: false },
  hard: { doubleFrac: 0.1, doubleFlat: 2, takeFrac: 0.12, takeFlat: 3, positional: true },
};

/** A positional bonus in pip-equivalents: a closed board and a checker on the
 * bar is worth far more than the raw race says. */
function positionalEdge(state: GameState, seat: Seat): number {
  const b = toScratch(state, seat);
  const f = features(b, true);
  return f.containment * 2 + f.homePoints * 1.5 + f.prime * 1.5 - f.onBar * 6 - f.risk * 8;
}

/** Should the computer turn the cube right now? */
export function shouldDouble(state: GameState, seat: Seat, difficulty: Difficulty): boolean {
  const tier = TIERS[difficulty];
  if (tier.never) return false;
  if (!canDouble(state, seat)) return false;

  const mine = pipCount(state, seat);
  const theirs = pipCount(state, seat === 'p0' ? 'p1' : 'p0');
  const lead = theirs - mine + (tier.positional ? positionalEdge(state, seat) : 0);
  const threshold = tier.doubleFrac * mine + tier.doubleFlat;

  if (lead < threshold) return false;

  // Too far ahead is its own reason not to double: a hopeless position gets
  // dropped, and one point now is worse than the gammon that was coming.
  if (lead > mine * 0.55 + 20) return false;

  // Doubling out of a match you cannot win faster is pointless.
  if (state.cube.value >= CUBE_MAX) return false;
  return true;
}

/** Take or drop an offered double. */
export function shouldTake(state: GameState, seat: Seat, difficulty: Difficulty): boolean {
  const tier = TIERS[difficulty];
  const mine = pipCount(state, seat);
  const theirs = pipCount(state, seat === 'p0' ? 'p1' : 'p0');
  const deficit = mine - theirs - (tier.positional ? positionalEdge(state, seat) : 0);
  const tolerance = tier.takeFrac * mine + tier.takeFlat;

  if (deficit <= tolerance) return true;

  /*
   * Post-Crawford free drop: when taking cannot change the match — the
   * opponent already wins with the points they have on the table — there is
   * nothing to gain by taking, and a drop keeps the match alive.
   */
  if (tier.positional) {
    const offered = state.offer?.value ?? state.cube.value * 2;
    const opp = seat === 'p0' ? 'p1' : 'p0';
    const theyWinAnyway = state.scores[opp] + state.cube.value >= state.target;
    if (theyWinAnyway) return false;
    if (state.scores[opp] + offered > state.target && deficit > tolerance * 0.6) return false;
  }

  return false;
}
