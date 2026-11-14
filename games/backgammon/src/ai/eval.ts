/**
 * Position evaluation for the computer opponent. Pure TypeScript, engine
 * imports only, and NO `Math.random` — the same position must always score the
 * same, or the tests cannot pin anything down.
 *
 * There is no hidden information in backgammon, so unlike the gin rummy app's
 * CPU there is nothing to model and no way to cheat: the computer sees exactly
 * what you see. All of the difficulty lives in how well it evaluates.
 */
import { POINTS, blots, madePoints, primeLength, type Scratch } from '@/engine/board';

/**
 * Number of the 36 dice combinations that hit a blot `d` pips away.
 *
 * 1..6 are direct shots. 7..12 need two dice, so they are both rarer and
 * blockable — you cannot play 8 as 5+3 if the intermediate point is made
 * against you, which `combosLive` accounts for. 15/16/18/20/24 come only from
 * doubles.
 */
const SHOTS: Record<number, number> = {
  1: 11,
  2: 12,
  3: 14,
  4: 15,
  5: 15,
  6: 17,
  7: 6,
  8: 6,
  9: 5,
  10: 3,
  11: 2,
  12: 3,
  15: 1,
  16: 1,
  18: 1,
  20: 1,
  24: 1,
};

/**
 * Whether an indirect shot of `d` pips is actually available: at least one
 * intermediate landing square must be open to the hitter.
 *
 * `to` is the blot's index in MY own frame; the opponent travels upward through
 * my frame, so an intermediate landing square is `to - k` for a first die `k`.
 */
function combosLive(b: Scratch, to: number, d: number): boolean {
  if (d <= 6) return true;
  for (let k = 1; k <= 6; k++) {
    const rest = d - k;
    if (rest < 1 || rest > 6) continue;
    const mid = to - rest;
    if (mid < 0 || mid >= POINTS) continue;
    // Blocked only by two or more of MY checkers.
    if (b.pts[mid] < 2) return true;
  }
  return false;
}

/**
 * Expected shots against my blots, in units of 36ths.
 *
 * Per blot we take the BEST single threat rather than summing every enemy
 * checker's chance: summing double-counts the same dice roll and badly
 * over-punishes a blot in front of a stack.
 */
export function blotRisk(b: Scratch, useCombos: boolean): number {
  let total = 0;
  const mine = blots(b);
  if (mine.length === 0) return 0;

  // Enemy sources in my frame. A checker on their bar re-enters at my index
  // `die - 1`, so treating it as sitting at -1 gives the right pip distances.
  const sources: number[] = [];
  if (b.oppBar > 0) sources.push(-1);
  for (let i = 0; i < POINTS; i++) if (b.pts[i] < 0) sources.push(i);

  for (const blot of mine) {
    let best = 0;
    for (const j of sources) {
      const d = blot - j;
      if (d < 1) continue;
      if (!useCombos && d > 6) continue;
      const shots = SHOTS[d] ?? 0;
      if (shots === 0) continue;
      if (useCombos && !combosLive(b, blot, d)) continue;
      if (shots > best) best = shots;
    }
    total += best / 36;
  }
  return total;
}

export interface Features {
  /** My own pip count. */
  myPips: number;
  /** Theirs. */
  theirPips: number;
  /** Their pips minus mine — positive means I am ahead in the race. */
  pipDiff: number;
  /** Expected shots against my blots (0..~2). */
  risk: number;
  /** Points I have made in my home board. */
  homePoints: number;
  /** Longest run of consecutive made points. */
  prime: number;
  /** I hold a point in their home board. */
  anchor: number;
  /** Their checkers on the bar, weighted by how closed my home board is. */
  containment: number;
  /** My checkers still stuck in their home board. */
  backCheckers: number;
  /** Checkers piled beyond three deep on a single point. */
  stacking: number;
  /** My borne-off checkers. */
  borneOff: number;
  /** My checkers on the bar. */
  onBar: number;
}

/** Own-frame pip count for a scratch board (bar counts 25). */
export function scratchPips(b: Scratch): number {
  let p = b.bar * 25;
  for (let i = 0; i < POINTS; i++) if (b.pts[i] > 0) p += b.pts[i] * (i + 1);
  return p;
}

/** Opponent pip count in MY frame: their checker at my index i is 24 - i pips out. */
export function oppPips(b: Scratch): number {
  let p = b.oppBar * 25;
  for (let i = 0; i < POINTS; i++) if (b.pts[i] < 0) p += -b.pts[i] * (24 - i);
  return p;
}

export function features(b: Scratch, useCombos: boolean): Features {
  const made = madePoints(b);
  let stacking = 0;
  let backCheckers = 0;
  for (let i = 0; i < POINTS; i++) {
    const n = b.pts[i];
    if (n > 3) stacking += n - 3;
    if (n > 0 && i >= 18) backCheckers += n;
  }
  const homePoints = made.filter((i) => i <= 5).length;
  const myPips = scratchPips(b);
  const theirPips = oppPips(b);
  return {
    myPips,
    theirPips,
    pipDiff: theirPips - myPips,
    risk: blotRisk(b, useCombos),
    homePoints,
    prime: primeLength(b),
    anchor: made.some((i) => i >= 18) ? 1 : 0,
    containment: b.oppBar * homePoints,
    backCheckers,
    stacking,
    borneOff: b.off,
    onBar: b.bar,
  };
}

export interface Weights {
  /** Value of taking a pip OFF my own count. */
  myPips: number;
  /** Value of putting a pip ON theirs. */
  theirPips: number;
  risk: number;
  homePoints: number;
  prime: number;
  anchor: number;
  containment: number;
  backCheckers: number;
  stacking: number;
  borneOff: number;
  onBar: number;
}

/**
 * ⚠ `myPips` and `theirPips` are deliberately ASYMMETRIC, and this is the most
 * important number in the file.
 *
 * With a single symmetric `pipDiff` term, hitting is always worth ~25 pips at
 * the cost of moving one checker, so two evaluators facing each other reach a
 * stable equilibrium where both sit in the other's home board hitting back and
 * forth and NEITHER EVER BRINGS A CHECKER HOME. A self-play match then runs
 * forever with pip counts climbing past 300. Weighting my own progress roughly
 * double the opponent's setback prices a hit at about ten pips of real progress
 * — worth taking, not worth living on.
 */
export const WEIGHTS: Weights = {
  myPips: -0.3,
  theirPips: 0.16,
  risk: -9,
  homePoints: 4,
  prime: 3,
  anchor: 5,
  containment: 2.5,
  backCheckers: -1.4,
  stacking: -0.7,
  borneOff: 3,
  onBar: -7,
};

/**
 * Score a resulting position. Higher is better for the side to move.
 *
 * The one context-sensitive term is the anchor: holding a point in the
 * opponent's home board is worth a lot when you are behind in the race and
 * need a shot, and close to nothing when you are ahead and just want to run.
 *
 * That weighting RAMPS rather than switching at pipDiff === 0. A step function
 * there is not a detail: it made a one-pip-worse position score four points
 * BETTER purely because it crossed the threshold, so the CPU would hand back a
 * pip to buy the bonus.
 */
export function evaluate(b: Scratch, useCombos: boolean, w: Weights = WEIGHTS): number {
  const f = features(b, useCombos);
  const behind = Math.max(0, Math.min(1, -f.pipDiff / 40));
  const anchorValue = w.anchor * (0.2 + 0.8 * behind);
  return (
    w.myPips * f.myPips +
    w.theirPips * f.theirPips +
    w.risk * f.risk +
    w.homePoints * f.homePoints +
    w.prime * f.prime +
    anchorValue * f.anchor +
    w.containment * f.containment +
    w.backCheckers * f.backCheckers +
    w.stacking * f.stacking +
    w.borneOff * f.borneOff +
    w.onBar * f.onBar
  );
}

/**
 * Easy's whole world view: run for home, hit what you can reach, and flinch
 * from the most obvious blots.
 *
 * Two things here are not obvious and are both load-bearing:
 *
 *  - The bar terms are SMALL, because the pip terms already price a hit at a
 *    full 25 pips. A big extra bonus double-counts it badly enough that two
 *    easy opponents hit each other back and forth forever instead of ever
 *    coming home.
 *  - There IS a blot term, small and direct-shots-only. Without any at all,
 *    easy hands over a shot every single turn, gets sent back every single
 *    turn, and a self-play game genuinely never ends — pip counts climb past
 *    300 and stay there. Being a weak opponent is the goal; being one that
 *    cannot finish a game is not.
 */
export function evaluateSimple(b: Scratch): number {
  return (
    -0.4 * scratchPips(b) +
    0.2 * oppPips(b) +
    4 * b.off +
    3 * b.oppBar -
    4 * b.bar -
    4 * blotRisk(b, false)
  );
}
