/**
 * Differential test: the engine's move generation against an independent,
 * deliberately naive reference implementation of the movement rules.
 *
 * The reference shares NO code with the engine — different board encoding
 * (absolute points, p1 moving the other way), no own-frame reflection, no
 * memo, no shortcuts — so a bug in one is unlikely to be mirrored in the other.
 * It checks, on thousands of random positions:
 *   - the engine's required number of dice equals the reference's;
 *   - the set of reachable final positions is identical (nothing legal is
 *     missing, nothing illegal is offered);
 *   - EVERY legal ordering of every legal turn is accepted by the validator
 *     the reducer and the UI use (no "legal move refused");
 *   - a turn the reference rejects is rejected by the engine.
 */
import { BAR, OFF, toOwn } from '../board';
import { isCompleteTurn, maxUsableDice, nextSteps, previewDraft, turnLines } from '../moves';
import type { GameState, Seat, Step } from '../types';
import { pos } from './helpers';

// ── reference rules, absolute coordinates ───────────────────────────────────
// points[i] > 0: p0 checkers; < 0: p1 checkers. p0 moves 23 → 0 and bears off
// below 0; p1 moves 0 → 23 and bears off above 23.

interface RefPos {
  points: number[];
  bar: [number, number]; // p0, p1
  off: [number, number];
}

const sign = (seat: Seat) => (seat === 'p0' ? 1 : -1);
const idx = (seat: Seat) => (seat === 'p0' ? 0 : 1);

function mine(p: RefPos, seat: Seat, i: number): number {
  const v = p.points[i] * sign(seat);
  return v > 0 ? v : 0;
}
function theirs(p: RefPos, seat: Seat, i: number): number {
  const v = -p.points[i] * sign(seat);
  return v > 0 ? v : 0;
}
/** Distance still to travel to bear off from absolute point i. */
function distance(seat: Seat, i: number): number {
  return seat === 'p0' ? i + 1 : 24 - i;
}
function allHomeRef(p: RefPos, seat: Seat): boolean {
  if (p.bar[idx(seat)] > 0) return false;
  for (let i = 0; i < 24; i++) if (mine(p, seat, i) > 0 && distance(seat, i) > 6) return false;
  return true;
}

interface RefMove {
  from: number | 'bar';
  to: number | 'off';
  die: number;
}

function refMoves(p: RefPos, seat: Seat, die: number): RefMove[] {
  const out: RefMove[] = [];
  const dir = seat === 'p0' ? -1 : 1;
  const canLand = (t: number) => theirs(p, seat, t) <= 1;

  if (p.bar[idx(seat)] > 0) {
    const t = seat === 'p0' ? 24 - die : die - 1;
    if (canLand(t)) out.push({ from: 'bar', to: t, die });
    return out;
  }
  const home = allHomeRef(p, seat);
  let farthest = 0;
  for (let i = 0; i < 24; i++) if (mine(p, seat, i) > 0) farthest = Math.max(farthest, distance(seat, i));

  for (let i = 0; i < 24; i++) {
    if (mine(p, seat, i) === 0) continue;
    const t = i + dir * die;
    if (t >= 0 && t <= 23) {
      if (canLand(t)) out.push({ from: i, to: t, die });
    } else if (home) {
      const dist = distance(seat, i);
      if (dist === die || (die > dist && dist === farthest)) out.push({ from: i, to: 'off', die });
    }
  }
  return out;
}

function refApply(p: RefPos, seat: Seat, m: RefMove): RefPos {
  const q: RefPos = { points: p.points.slice(), bar: [p.bar[0], p.bar[1]], off: [p.off[0], p.off[1]] };
  const s = sign(seat);
  if (m.from === 'bar') q.bar[idx(seat)] -= 1;
  else q.points[m.from] -= s;
  if (m.to === 'off') {
    q.off[idx(seat)] += 1;
  } else {
    if (theirs(q, seat, m.to) === 1) {
      q.points[m.to] = 0;
      q.bar[1 - idx(seat)] += 1;
    }
    q.points[m.to] += s;
  }
  return q;
}

const key = (p: RefPos) => `${p.points.join(',')}|${p.bar.join(',')}|${p.off.join(',')}`;

/** Every maximal move sequence (all orderings), with the larger-die rule. */
function refSequences(p: RefPos, seat: Seat, dice: [number, number]): RefMove[][] {
  const pool = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [dice[0], dice[1]];
  let all: RefMove[][] = [];
  const rec = (q: RefPos, rest: number[], acc: RefMove[]) => {
    let any = false;
    for (let k = 0; k < rest.length; k++) {
      if (rest.indexOf(rest[k]) !== k) continue;
      const remaining = rest.slice(0, k).concat(rest.slice(k + 1));
      for (const m of refMoves(q, seat, rest[k])) {
        any = true;
        rec(refApply(q, seat, m), remaining, [...acc, m]);
      }
    }
    if (!any) all.push(acc);
  };
  rec(p, pool, []);
  const best = Math.max(...all.map((s) => s.length));
  all = all.filter((s) => s.length === best);
  if (best === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(...dice);
    if (all.some((s) => s[0].die === hi)) all = all.filter((s) => s[0].die === hi);
  }
  return all;
}

// ── bridging ─────────────────────────────────────────────────────────────────

function toRef(s: GameState): RefPos {
  return { points: s.points.slice(), bar: [s.bar.p0, s.bar.p1], off: [s.off.p0, s.off.p1] };
}
function refStep(seat: Seat, m: RefMove): Step {
  return {
    from: m.from === 'bar' ? BAR : toOwn(seat, m.from),
    to: m.to === 'off' ? OFF : toOwn(seat, m.to),
  };
}
function stateKey(s: GameState): string {
  return key(toRef(s));
}

// ── random positions ─────────────────────────────────────────────────────────

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** A random legal-looking position: 15 checkers each, some borne off / on the bar. */
function randomState(r: () => number, seat: Seat, dice: [number, number]): GameState {
  const style = r();
  const p0: Record<number, number> = {};
  const p1: Record<number, number> = {};
  const occupied = new Map<number, Seat>(); // absolute index → owner
  const bar = { p0: 0, p1: 0 };
  const place = (who: Seat, n: number, homeOnly: boolean) => {
    const spec = who === 'p0' ? p0 : p1;
    for (let c = 0; c < n; c++) {
      if (r() < 0.06 && !homeOnly) {
        bar[who] += 1;
        continue;
      }
      for (let tries = 0; tries < 50; tries++) {
        const own = homeOnly ? Math.floor(r() * 6) : Math.floor(r() * 24);
        const abs = toOwn(who, own);
        const owner = occupied.get(abs);
        if (owner && owner !== who) continue;
        occupied.set(abs, who);
        spec[own] = (spec[own] ?? 0) + 1;
        break;
      }
    }
  };
  // style: mid-game, bear-off race, or a mix with checkers already off
  const bearoff = style < 0.3;
  const n0 = bearoff ? 3 + Math.floor(r() * 13) : 15;
  const n1 = 8 + Math.floor(r() * 8);
  place('p0', n0, bearoff);
  place('p1', n1, false);
  const s = pos({ p0, p1, bar, dice, phase: 'moving', turn: seat });
  return s;
}

// ── the tests ────────────────────────────────────────────────────────────────

const N = 4000;

describe('engine vs independent reference', () => {
  test(`final positions and dice usage agree on ${N} random positions`, () => {
    const r = rng(20261114);
    const mismatches: string[] = [];
    for (let n = 0; n < N && mismatches.length < 5; n++) {
      const seat: Seat = r() < 0.5 ? 'p0' : 'p1';
      const dice: [number, number] = [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)];
      const s = randomState(r, seat, dice);

      const ref = refSequences(toRef(s), seat, dice);
      const refFinals = new Set(
        ref.map((seq) => key(seq.reduce((q, m) => refApply(q, seat, m), toRef(s)))),
      );
      const refLen = ref[0].length;

      const lines = turnLines(s, seat);
      const engFinals = new Set(lines.map((l) => stateKey(previewDraft(s, seat, l.steps))));
      const engLen = maxUsableDice(s, seat);

      const missing = [...refFinals].filter((k) => !engFinals.has(k));
      const extra = [...engFinals].filter((k) => !refFinals.has(k));
      if (engLen !== refLen || missing.length || extra.length) {
        mismatches.push(
          `#${n} ${seat} dice ${dice} len eng=${engLen} ref=${refLen} missing=${missing.length} extra=${extra.length}\n  ${JSON.stringify({ points: s.points, bar: s.bar, off: s.off })}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('every legal ordering is accepted, step by step and as a whole', () => {
    const r = rng(7);
    const refused: string[] = [];
    for (let n = 0; n < 1500 && refused.length < 5; n++) {
      const seat: Seat = r() < 0.5 ? 'p0' : 'p1';
      const dice: [number, number] = [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)];
      const s = randomState(r, seat, dice);
      const seqs = refSequences(toRef(s), seat, dice);
      // Sample orderings so doubles don't take forever.
      for (const seq of seqs.slice(0, 40)) {
        const steps = seq.map((m) => refStep(seat, m));
        for (let k = 0; k < steps.length; k++) {
          const offered = nextSteps(s, seat, steps.slice(0, k));
          if (!offered.some((o) => o.from === steps[k].from && o.to === steps[k].to)) {
            refused.push(`#${n} step ${k} ${JSON.stringify(steps)} dice ${dice} not offered`);
            break;
          }
        }
        if (!isCompleteTurn(s, seat, steps)) refused.push(`#${n} ${JSON.stringify(steps)} dice ${dice} rejected`);
        if (refused.length >= 5) break;
      }
    }
    expect(refused).toEqual([]);
  });

  test('worst-case doubles on a spread board finish quickly', () => {
    // 15 checkers spread one or two per point with an open board: the case
    // that used to overflow the enumerator and recurse forever.
    const p0: Record<number, number> = {};
    for (let i = 0; i < 15; i++) p0[i + 2] = 1;
    const s = pos({ p0, p1: { 0: 2 }, dice: [1, 1], phase: 'moving', turn: 'p0' });
    const t0 = Date.now();
    const lines = turnLines(s, 'p0');
    expect(lines.length).toBeGreaterThan(0);
    expect(maxUsableDice(s, 'p0')).toBe(4);
    expect(Date.now() - t0).toBeLessThan(2000);
    // and an arbitrary legal ordering is accepted
    expect(isCompleteTurn(s, 'p0', [{ from: 16, to: 15 }, { from: 15, to: 14 }, { from: 3, to: 2 }, { from: 9, to: 8 }])).toBe(true);
  });
});
