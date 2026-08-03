/**
 * Board representation and the frame algebra everything else is built on.
 *
 * ── The one decision the whole engine falls out of ────────────────────────────
 * The board is stored as ONE absolute signed 24-array in p0's frame, and every
 * rule is written in the acting seat's OWN frame, reached by a single index
 * flip. That means the move generator, the bear-off rules and the CPU are all
 * direction-free: there is no "if p1 then count upwards" anywhere.
 *
 * In own-frame, for BOTH seats:
 *
 *   travel        index DECREASING, 23 -> 0
 *   home board    0..5   (own index 5 is what players call "the 6 point")
 *   their home    18..23 (where you re-enter from the bar)
 *   bar entry     die d lands on index 24 - d
 *   bear off      to === OFF
 *
 * The sentinels BAR = 24 and OFF = -1 are chosen so that
 *
 *     die consumed = from - to
 *
 * holds uniformly: bar entry is 24 - (24 - d) = d, and an exact bear-off from
 * own index 5 is 5 - (-1) = 6. The ONE exception is an overshoot bear-off (a 6
 * played off the 4 point), which is exactly why `Ply` in moves.ts carries the
 * consumed die explicitly instead of re-deriving it from the distance.
 */
import type { GameState, Seat } from './types';

export const POINTS = 24;
export const CHECKERS = 15;
/** `Step.from` sentinel: entering from the bar. */
export const BAR = 24;
/** `Step.to` sentinel: bearing off. */
export const OFF = -1;

/** The other seat. */
export function otherSeat(seat: Seat): Seat {
  return seat === 'p0' ? 'p1' : 'p0';
}

/**
 * Absolute index <-> the seat's own frame. Self-inverse: applying it twice
 * returns the original index, so the same function converts in both directions.
 */
export function toOwn(seat: Seat, i: number): number {
  return seat === 'p0' ? i : 23 - i;
}

/**
 * Signed count at own-frame index `i`; POSITIVE means the seat's own checkers.
 *
 * The `v === 0` guard is not decoration: negating zero yields `-0`, which is
 * `Object.is`-distinct from `0` and would leak into `points` — a needless way
 * for two equal boards to compare unequal.
 */
export function ownAt(points: number[], seat: Seat, i: number): number {
  const v = points[toOwn(seat, i)];
  if (seat === 'p0' || v === 0) return v === 0 ? 0 : v;
  return -v;
}

/**
 * The standard opening position, in p0's absolute frame.
 *
 * p0 travels 23 -> 0, so p0's back checkers sit on absolute 23. p1 is the exact
 * mirror, which is what makes `toOwn` a plain reflection.
 */
export function startingPoints(): number[] {
  const p = new Array<number>(POINTS).fill(0);
  p[23] = 2;   // p0's 24 point (own 23)
  p[12] = 5;   // p0's 13 point (own 12)
  p[7] = 3;    // p0's 8 point  (own 7)
  p[5] = 5;    // p0's 6 point  (own 5)
  p[0] = -2;   // p1's 24 point (own 23 -> absolute 0)
  p[11] = -5;  // p1's 13 point
  p[16] = -3;  // p1's 8 point
  p[18] = -5;  // p1's 6 point
  return p;
}

/**
 * Working copy of the board in one seat's own frame, for the move generator.
 * `pts[i] > 0` is always "mine" and `pts[i] < 0` always "theirs", whichever
 * seat we are generating for.
 */
export interface Scratch {
  pts: Int8Array;
  /** My checkers on the bar. */
  bar: number;
  /** My checkers borne off. */
  off: number;
  /** Their checkers on the bar — grows when I hit a blot. */
  oppBar: number;
}

/** Flip into own-frame ONCE, at the top of enumeration. */
export function toScratch(state: GameState, seat: Seat): Scratch {
  const pts = new Int8Array(POINTS);
  for (let i = 0; i < POINTS; i++) pts[i] = ownAt(state.points, seat, i);
  return {
    pts,
    bar: state.bar[seat],
    off: state.off[seat],
    oppBar: state.bar[otherSeat(seat)],
  };
}

/** Flip an own-frame scratch board back to absolute p0-frame counts. */
export function fromScratch(
  s: Scratch,
  seat: Seat,
): { points: number[]; bar: Record<Seat, number>; off: Record<Seat, number> } {
  const points = new Array<number>(POINTS).fill(0);
  for (let i = 0; i < POINTS; i++) {
    const v = s.pts[i];
    // See `ownAt`: never let a negated zero through.
    points[toOwn(seat, i)] = v === 0 ? 0 : seat === 'p0' ? v : -v;
  }
  const opp = otherSeat(seat);
  const bar = { p0: 0, p1: 0 } as Record<Seat, number>;
  const off = { p0: 0, p1: 0 } as Record<Seat, number>;
  bar[seat] = s.bar;
  bar[opp] = s.oppBar;
  off[seat] = s.off;
  // The opponent's borne-off count is untouched by my turn; the caller
  // reinstates it (see `moves.applySteps`), which is why it is 0 here.
  return { points, bar, off };
}

/** Can this seat bear off — nothing on the bar and nothing outside home? */
export function allHome(s: Scratch): boolean {
  if (s.bar > 0) return false;
  for (let i = 6; i < POINTS; i++) if (s.pts[i] > 0) return false;
  return true;
}

/** Highest own-frame index holding at least one of my checkers, or -1. */
export function highestOwn(s: Scratch): number {
  for (let i = POINTS - 1; i >= 0; i--) if (s.pts[i] > 0) return i;
  return -1;
}

/**
 * Pip count: how many pips this seat still has to travel. A checker at own
 * index `i` is `i + 1` pips from home; one on the bar is 25.
 *
 * The opening position is 167 for both seats — a useful smoke test.
 */
export function pipCount(state: GameState, seat: Seat): number {
  let pips = state.bar[seat] * 25;
  for (let i = 0; i < POINTS; i++) {
    const n = ownAt(state.points, seat, i);
    if (n > 0) pips += n * (i + 1);
  }
  return pips;
}

/** Own-frame indices where this seat has exactly one checker (a hittable blot). */
export function blots(s: Scratch): number[] {
  const out: number[] = [];
  for (let i = 0; i < POINTS; i++) if (s.pts[i] === 1) out.push(i);
  return out;
}

/** Own-frame indices this seat has made (2 or more checkers). */
export function madePoints(s: Scratch): number[] {
  const out: number[] = [];
  for (let i = 0; i < POINTS; i++) if (s.pts[i] >= 2) out.push(i);
  return out;
}

/** Length of the longest run of consecutive made points (a prime). */
export function primeLength(s: Scratch): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < POINTS; i++) {
    if (s.pts[i] >= 2) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/**
 * A compact key for a position, used to dedup candidate turns that reach the
 * same board by different orderings. Only the resulting position matters to the
 * CPU, and dedup here cuts its work by roughly half in the middle game.
 */
export function boardKey(s: Scratch): string {
  // Offset by 16 so every count maps to a single printable char.
  let out = '';
  for (let i = 0; i < POINTS; i++) out += String.fromCharCode(s.pts[i] + 48);
  return `${out}|${s.bar}|${s.off}|${s.oppBar}`;
}
