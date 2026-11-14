/**
 * `normalize()` is the layer that stands between the Realtime Database's lossy
 * tree and the reducer's preconditions, so these tests are written against a
 * simulation of what RTDB actually does to a document.
 */
import { initialMatchState } from '../reducer';
import { normalize } from '../serialize';
import type { GameState } from '../types';
import { GUEST, HOST, pos, prune } from './helpers';

/** The other RTDB surprise: an array can come back integer-keyed. */
function intKeyed(arr: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  arr.forEach((v, i) => {
    out[String(i)] = v;
  });
  return out;
}

const fresh = () =>
  initialMatchState({ hostUid: HOST, guestUid: GUEST, hostName: 'Host', guestName: 'Guest', target: 5 });

describe('round-tripping through RTDB', () => {
  it('survives a fresh match, whose opening node vanishes entirely', () => {
    const s = fresh();
    const wire = prune(s) as Record<string, unknown>;
    // Both children of `opening` are null, so the whole node is gone — a
    // failure mode with no analogue in the gin rummy app.
    expect(wire.opening).toBeUndefined();
    expect(wire.dice).toBeUndefined();
    expect(wire.offer).toBeUndefined();
    expect(normalize(wire)).toEqual(s);
  });

  it('survives a mid-game state', () => {
    const s = pos({ p0: { 10: 2, 5: 13 }, p1: { 8: 3, 5: 12 }, dice: [6, 3], turn: 'p1' });
    s.cube = { value: 4, owner: 'p0' };
    s.lastMove = { by: HOST, seat: 'p0', kind: 'play', dice: [2, 1], steps: [{ from: 12, to: 10 }], at: 1 };
    expect(normalize(prune(s))).toEqual(s);
  });

  it('restores a pruned empty steps array on a forced no-play', () => {
    const s = pos({ p0: { 5: 15 }, phase: 'roll' });
    s.lastMove = { by: HOST, seat: 'p0', kind: 'play', dice: [6, 5], steps: [], at: 1 };
    const back = normalize(prune(s));
    expect(back?.lastMove?.steps).toEqual([]);
  });

  it('accepts an integer-keyed points object', () => {
    const s = pos({ p0: { 10: 2, 5: 13 }, p1: { 8: 3, 5: 12 } });
    const wire = prune(s) as Record<string, unknown>;
    wire.points = intKeyed(s.points);
    expect(normalize(wire)?.points).toEqual(s.points);
  });

  it('keeps a zero-valued cube owner distinction', () => {
    const s = fresh();
    expect(normalize(prune(s))?.cube).toEqual({ value: 1, owner: null });
    s.cube = { value: 2, owner: 'p1' };
    expect(normalize(prune(s))?.cube).toEqual({ value: 2, owner: 'p1' });
  });

  it('does not mistake a legitimate 0 or -1 for a missing value', () => {
    // `from: 0` and `to: -1` are a real bear-off. `x || null` would eat both.
    const s = pos({ p0: { 0: 1 }, phase: 'roll' });
    s.lastMove = { by: HOST, seat: 'p0', kind: 'play', steps: [{ from: 0, to: -1 }], at: 0 };
    expect(normalize(prune(s))?.lastMove?.steps).toEqual([{ from: 0, to: -1 }]);
  });
});

describe('rejecting snapshots that cannot exist', () => {
  const bad = (mutate: (s: GameState) => void) => {
    const s = pos({ p0: { 10: 2, 5: 13 }, p1: { 8: 3, 5: 12 }, dice: [6, 3] });
    mutate(s);
    return normalize(prune(s));
  };

  it('rejects a lost checker', () => {
    expect(bad((s) => (s.points[10] = 1))).toBeNull();
  });

  it('rejects an extra checker', () => {
    expect(bad((s) => (s.points[10] = 3))).toBeNull();
  });

  it('rejects a turnUid that disagrees with the seat map', () => {
    expect(bad((s) => (s.turnUid = GUEST))).toBeNull();
  });

  it('rejects a single die', () => {
    expect(bad((s) => (s.dice = [4]))).toBeNull();
  });

  it('rejects an impossible die face', () => {
    expect(bad((s) => (s.dice = [0, 7]))).toBeNull();
  });

  it('rejects a cube value that is not a power of two up to 64', () => {
    expect(bad((s) => (s.cube = { value: 3, owner: null }))).toBeNull();
    expect(bad((s) => (s.cube = { value: 128, owner: null }))).toBeNull();
  });

  it('rejects the moving phase without dice', () => {
    expect(bad((s) => (s.dice = []))).toBeNull();
  });

  it('rejects the doubled phase without an offer', () => {
    expect(bad((s) => (s.phase = 'doubled'))).toBeNull();
  });

  it('rejects an offer outside the doubled phase', () => {
    expect(bad((s) => (s.offer = { by: 'p0', value: 2 }))).toBeNull();
  });

  it('rejects a finished phase with no result attached', () => {
    expect(bad((s) => (s.phase = 'gameOver'))).toBeNull();
    expect(bad((s) => (s.phase = 'matchOver'))).toBeNull();
  });

  it('rejects a reached target that is not matchOver, and vice versa', () => {
    expect(bad((s) => (s.scores = { p0: 5, p1: 0 }))).toBeNull();
  });

  it('rejects a game that is both Crawford and post-Crawford', () => {
    expect(
      bad((s) => {
        s.crawford = true;
        s.crawfordDone = true;
      }),
    ).toBeNull();
  });

  it('rejects garbage outright', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(undefined)).toBeNull();
    expect(normalize(42)).toBeNull();
    expect(normalize('nope')).toBeNull();
    expect(normalize({})).toBeNull();
    expect(normalize({ version: 1 })).toBeNull();
  });

  it('rejects a points array of the wrong length', () => {
    const s = pos({ p0: { 10: 2, 5: 13 }, p1: { 8: 3, 5: 12 } });
    const wire = prune(s) as Record<string, unknown>;
    wire.points = s.points.slice(0, 10);
    expect(normalize(wire)).toBeNull();
    wire.points = [...s.points, 0];
    expect(normalize(wire)).toBeNull();
  });
});
