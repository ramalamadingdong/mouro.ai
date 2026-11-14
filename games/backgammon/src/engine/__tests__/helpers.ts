/**
 * Shared test fixtures. Not a test file itself (jest only picks up `*.test.ts`).
 *
 * Positions are written in OWN-FRAME indices for each seat — the same frame the
 * engine reasons in — so a test reads the way a player would describe it:
 * `{ 5: 2 }` is "two checkers on my 6 point".
 *
 * Any checkers not placed are assumed borne off, which keeps every fixture
 * conserving 15 per side without the test having to say so.
 */
import { CHECKERS, toOwn } from '../board';
import { initialMatchState } from '../reducer';
import type { GameState, Phase, Seat } from '../types';

export const HOST = 'H';
export const GUEST = 'G';

export interface PosSpec {
  /** own-frame index -> checker count, for p0. */
  p0?: Record<number, number>;
  /** own-frame index -> checker count, for p1. */
  p1?: Record<number, number>;
  bar?: Partial<Record<Seat, number>>;
  /** Override the derived borne-off counts (defaults to "everything else"). */
  off?: Partial<Record<Seat, number>>;
  dice?: number[];
  phase?: Phase;
  turn?: Seat;
  target?: number;
  scores?: Partial<Record<Seat, number>>;
  game?: number;
  version?: number;
}

/** Build a state from an own-frame position spec. */
export function pos(spec: PosSpec = {}): GameState {
  const s = initialMatchState({
    hostUid: HOST,
    guestUid: GUEST,
    hostName: 'Host',
    guestName: 'Guest',
    target: spec.target ?? 5,
  });

  const points = new Array<number>(24).fill(0);
  let onBoard: Record<Seat, number> = { p0: 0, p1: 0 };

  for (const [k, v] of Object.entries(spec.p0 ?? {})) {
    points[toOwn('p0', Number(k))] += v;
    onBoard.p0 += v;
  }
  for (const [k, v] of Object.entries(spec.p1 ?? {})) {
    points[toOwn('p1', Number(k))] -= v;
    onBoard.p1 += v;
  }

  const bar: Record<Seat, number> = { p0: spec.bar?.p0 ?? 0, p1: spec.bar?.p1 ?? 0 };
  const off: Record<Seat, number> = {
    p0: spec.off?.p0 ?? CHECKERS - onBoard.p0 - bar.p0,
    p1: spec.off?.p1 ?? CHECKERS - onBoard.p1 - bar.p1,
  };

  s.points = points;
  s.bar = bar;
  s.off = off;
  s.dice = spec.dice ?? [];
  s.phase = spec.phase ?? (spec.dice ? 'moving' : 'roll');
  s.turn = spec.turn ?? 'p0';
  s.turnUid = s.players[s.turn];
  s.opening = s.phase === 'opening' ? { p0: null, p1: null } : null;
  if (spec.scores) s.scores = { p0: spec.scores.p0 ?? 0, p1: spec.scores.p1 ?? 0 };
  if (spec.game !== undefined) s.game = spec.game;
  if (spec.version !== undefined) s.version = spec.version;
  return s;
}

/** uid of a seat in a fixture built by `pos`. */
export function uidOf(seat: Seat): string {
  return seat === 'p0' ? HOST : GUEST;
}

/** Unwrap a successful `applyMove`, or fail loudly with the rejection reason. */
export function ok(r: { ok: true; state: GameState } | { ok: false; error: string }): GameState {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.state;
}

/**
 * Simulate what the Realtime Database gives back for a value you wrote: `null`,
 * empty arrays and empty objects are DELETED rather than stored, and the
 * deletion propagates upward when it empties the parent.
 *
 * Lives here rather than in a test file so both `serialize.test.ts` and
 * `fuzz.test.ts` can use it without one importing the other's `describe`s.
 */
export function prune(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const out = v.map(prune).filter((x) => x !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const pv = prune(val);
      if (pv !== undefined) {
        out[k] = pv;
        n += 1;
      }
    }
    return n ? out : undefined;
  }
  return v;
}

/** Render a set of steps as `from/to` notation, sorted, for stable comparison. */
export function notate(steps: { from: number; to: number }[]): string {
  return steps.map((s) => `${s.from === 24 ? 'bar' : s.from}/${s.to === -1 ? 'off' : s.to}`).join(' ');
}

/** All distinct turns, as sorted notation strings. */
export function linesOf(lines: { steps: { from: number; to: number }[] }[]): string[] {
  return lines.map((l) => notate(l.steps)).sort();
}
