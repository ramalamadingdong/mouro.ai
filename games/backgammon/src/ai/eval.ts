/**
 * Position evaluation for the computer player.
 *
 * All functions take a `Scratch` board in the evaluating side's OWN frame:
 * `pts[i] > 0` are my checkers, `< 0` the opponent's, I move from index 23
 * toward 0 and bear off below 0; the opponent moves the other way and enters
 * from its bar at my index `die - 1`.
 *
 * The score is SYMMETRIC: `evaluate(b) = side(b) - side(flip(b))`. The old
 * evaluator scored only one side and the lookahead subtracted the opponent's
 * one-sided score from it, mixing two different scales — which is a large part
 * of why the computer made strange choices. With a symmetric score, "good for
 * me" and "bad for them" are the same number, and a 1-ply search is honest.
 *
 * Tawleh scoring is built in: a mars (bearing everything off before the other
 * side takes a single checker off) is worth double, so getting the first
 * checker off matters when the opponent is already bearing off.
 */
import { CHECKERS, POINTS, type Scratch } from '@/engine/board';

/** Number of the 36 rolls that hit a blot `d` pips away (no blocking). */
const SHOTS: Record<number, number> = {
  1: 11, 2: 12, 3: 14, 4: 15, 5: 15, 6: 17, 7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3,
  15: 1, 16: 1, 18: 1, 20: 1, 24: 1,
};

/** The same board seen from the other side, with both borne-off counts right. */
export function flip(b: Scratch): Scratch {
  const pts = new Int8Array(POINTS);
  let theirsOnBoard = 0;
  for (let i = 0; i < POINTS; i++) {
    pts[i] = -b.pts[23 - i];
    if (b.pts[i] < 0) theirsOnBoard += -b.pts[i];
  }
  return {
    pts,
    bar: b.oppBar,
    off: CHECKERS - theirsOnBoard - b.oppBar,
    oppBar: b.bar,
  };
}

export function scratchPips(b: Scratch): number {
  let p = b.bar * 25;
  for (let i = 0; i < POINTS; i++) if (b.pts[i] > 0) p += b.pts[i] * (i + 1);
  return p;
}

export function oppPips(b: Scratch): number {
  let p = b.oppBar * 25;
  for (let i = 0; i < POINTS; i++) if (b.pts[i] < 0) p += -b.pts[i] * (24 - i);
  return p;
}

/** Is any of my checkers still behind one of theirs (so hitting is possible)? */
export function inContact(b: Scratch): boolean {
  let myRear = b.bar > 0 ? 24 : -1;
  if (myRear < 0) for (let i = POINTS - 1; i >= 0; i--) if (b.pts[i] > 0) { myRear = i; break; }
  let theirRear = b.oppBar > 0 ? -1 : 24;
  if (theirRear === 24) for (let i = 0; i < POINTS; i++) if (b.pts[i] < 0) { theirRear = i; break; }
  return myRear > theirRear;
}

/** Can the opponent's checker at my index `j` travel `d` pips to `to`, given my points block? */
function shotLive(b: Scratch, j: number, to: number, d: number): boolean {
  if (d <= 6) return true;
  // Combination shot: some split d = a + c with an open landing point between.
  for (let a = 1; a <= 6; a++) {
    const c = d - a;
    if (c < 1 || c > 6) continue;
    const mid = j + a;
    if (mid < 0 || mid >= POINTS || b.pts[mid] < 2) return true;
  }
  return false;
}

/**
 * Expected pips I lose to being hit next turn: for each blot, the share of
 * rolls that hit it times what it costs (its pips already travelled + a turn
 * on the bar). Blots deep in my own home board cost the most.
 */
export function blotExposure(b: Scratch): number {
  const sources: number[] = [];
  if (b.oppBar > 0) sources.push(-1);
  for (let i = 0; i < POINTS; i++) if (b.pts[i] < 0) sources.push(i);
  if (sources.length === 0) return 0;

  // How strong is their home board (my points 18..23 are their 6..1)? Being
  // hit is worse when re-entering is hard.
  let theirHome = 0;
  for (let i = 18; i < POINTS; i++) if (b.pts[i] <= -2) theirHome++;

  let total = 0;
  for (let blot = 0; blot < POINTS; blot++) {
    if (b.pts[blot] !== 1) continue;
    let shots = 0;
    for (const j of sources) {
      const d = blot - j;
      if (d < 1) continue;
      const s = SHOTS[d] ?? 0;
      if (s && shotLive(b, j, blot, d)) shots += s;
    }
    if (shots === 0) continue;
    const p = Math.min(shots, 30) / 36;
    const cost = 24 - blot + 4 + theirHome * 2;
    total += p * cost;
  }
  return total;
}

function longestPrime(b: Scratch): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < POINTS; i++) {
    if (b.pts[i] >= 2) {
      run++;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}

/**
 * One side's strength, from that side's frame. Contact positions value
 * structure and safety; races value only pips and bearing off.
 */
function side(b: Scratch, contact: boolean, oppOff: number, exposed: boolean): number {
  const pips = scratchPips(b);
  let v = -pips;

  // Mars danger (Tawleh scores it double): if they are already bearing off and
  // I have nothing off, every pip I am short of getting a checker home hurts.
  if (oppOff > 0 && b.off === 0) {
    let outside = 0;
    for (let i = 6; i < POINTS; i++) if (b.pts[i] > 0) outside += b.pts[i] * (i - 5);
    v -= 1.2 * outside + 6;
  }

  if (!contact) {
    // Pure race: pips decide it. Small nudges for bearing off efficiently.
    v += b.off * 2;
    let gaps = 0;
    for (let i = 0; i < 6; i++) if (b.pts[i] <= 0) gaps++;
    let stack = 0;
    for (let i = 0; i < 6; i++) if (b.pts[i] > 3) stack += b.pts[i] - 3;
    return v - gaps * 0.5 - stack * 0.8;
  }

  // Contact. My blots only cost me if the opponent rolls next.
  if (exposed) v -= blotExposure(b);

  // Points made, weighted toward my home board and the points just in front
  // of it, where they block the opponent's back checkers.
  const W = [2.0, 2.5, 3.5, 4.5, 5.5, 6.0, 4.0, 3.0, 1.5, 1.0, 0.8, 0.8];
  for (let i = 0; i < 12; i++) if (b.pts[i] >= 2) v += W[i];
  v += Math.max(0, longestPrime(b) - 2) * 3;

  // Anchors in their home board keep me safe while I am behind.
  for (let i = 18; i < POINTS; i++) if (b.pts[i] >= 2) v += 2;

  // Heavy stacks and checkers buried on the 1-2 points are wasted.
  for (let i = 0; i < POINTS; i++) if (b.pts[i] > 3) v -= (b.pts[i] - 3) * 1.2;
  if (b.pts[0] > 0) v -= b.pts[0] * 1.0;
  if (b.pts[1] > 1) v -= (b.pts[1] - 1) * 0.6;

  // On the bar against a strong board is a disaster.
  if (b.bar > 0) {
    let closed = 0;
    for (let i = 18; i < POINTS; i++) if (b.pts[i] <= -2) closed++;
    v -= b.bar * (6 + closed * closed * 1.5);
  }

  v += b.off * 3;
  return v;
}

/**
 * Symmetric position value for the side to evaluate (positive = good for me).
 *
 * `onRoll` says who moves next, because only the side NOT on roll has blots
 * that can be hit before it moves. The default, 'them', is the usual case:
 * judging a position I have just moved into.
 */
export function evaluate(b: Scratch, onRoll: 'me' | 'them' = 'them'): number {
  const contact = inContact(b);
  const them = flip(b);
  return side(b, contact, them.off, onRoll === 'them') - side(them, contact, b.off, onRoll === 'me');
}

/** The easy tier: race and hit, with a nod to safety. */
export function evaluateSimple(b: Scratch): number {
  return oppPips(b) - scratchPips(b) + 6 * b.oppBar - 0.4 * blotExposure(b);
}
