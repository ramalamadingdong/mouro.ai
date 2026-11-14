import { BAR, OFF, toScratch } from '../board';
import { applySteps, isCompleteTurn, nextSteps, plies, previewDraft, turnLines } from '../moves';
import { notate, pos } from './helpers';

/**
 * p1's own-frame index for a point p0 calls `i`. `toOwn` is a reflection, so
 * placing an enemy checker "in front of p0" always means mirroring the index.
 */
const opp = (i: number) => 23 - i;

const P = (state: ReturnType<typeof pos>, die: number) => plies(toScratch(state, 'p0'), die);

describe('plies — bar first', () => {
  it('offers nothing but entry while a checker is on the bar', () => {
    const s = pos({ p0: { 12: 5, 5: 9 }, bar: { p0: 1 }, dice: [4, 4] });
    const out = P(s, 4);
    expect(out).toHaveLength(1);
    expect(out[0].step).toEqual({ from: BAR, to: 20 }); // 24 - 4
  });

  it('cannot enter onto a point the opponent has made', () => {
    const s = pos({ p0: { 5: 14 }, p1: { [opp(20)]: 2 }, bar: { p0: 1 }, dice: [4, 4] });
    expect(P(s, 4)).toHaveLength(0);
  });

  it('hits a lone enemy checker on the entry point', () => {
    const s = pos({ p0: { 5: 14 }, p1: { [opp(20)]: 1 }, bar: { p0: 1 }, dice: [4, 4] });
    const out = P(s, 4);
    expect(out).toHaveLength(1);
    expect(out[0].hit).toBe(true);
  });

  it('spends exactly the die it entered with', () => {
    const s = pos({ p0: { 5: 14 }, bar: { p0: 1 }, dice: [6, 6] });
    expect(P(s, 6)[0].die).toBe(6);
    expect(P(s, 6)[0].step).toEqual({ from: BAR, to: 18 });
  });
});

describe('plies — ordinary moves', () => {
  it('may land on an empty point, its own point, or a lone blot', () => {
    const s = pos({
      p0: { 10: 1, 12: 2 },
      p1: { [opp(7)]: 1, [opp(9)]: 2 },
      dice: [3, 3],
    });
    const from10 = P(s, 3).filter((p) => p.step.from === 10);
    expect(from10).toHaveLength(1);
    expect(from10[0].step.to).toBe(7);
    expect(from10[0].hit).toBe(true); // a lone enemy on 7
  });

  it('is blocked by two or more enemy checkers', () => {
    const s = pos({ p0: { 10: 1 }, p1: { [opp(7)]: 2 }, dice: [3, 3] });
    expect(P(s, 3).filter((p) => p.step.from === 10)).toHaveLength(0);
  });
});

describe('plies — bearing off', () => {
  it('bears off exactly with the matching die', () => {
    const s = pos({ p0: { 5: 2, 2: 3 }, dice: [6, 6] });
    const off = P(s, 6).filter((p) => p.step.to === OFF);
    expect(off).toHaveLength(1);
    expect(off[0].step.from).toBe(5); // the 6 point
  });

  it('allows an overshoot only from the highest occupied point', () => {
    const s = pos({ p0: { 3: 2, 1: 2 }, dice: [6, 6] });
    const off = P(s, 6).filter((p) => p.step.to === OFF);
    expect(off.map((p) => p.step.from)).toEqual([3]);
  });

  it('forbids an overshoot when a higher point is still occupied', () => {
    // A 5 cannot come off the 4 point (own index 3) while the 5 point is manned.
    const s = pos({ p0: { 4: 1, 3: 2 }, dice: [5, 5] });
    const off = P(s, 5).filter((p) => p.step.to === OFF);
    expect(off.map((p) => p.step.from)).toEqual([4]);
  });

  it('refuses to bear off with a checker on the bar', () => {
    const s = pos({ p0: { 3: 2 }, bar: { p0: 1 }, dice: [4, 4] });
    expect(P(s, 4).some((p) => p.step.to === OFF)).toBe(false);
  });

  it('refuses to bear off with a checker outside the home board', () => {
    const s = pos({ p0: { 8: 1, 3: 2 }, dice: [4, 4] });
    expect(P(s, 4).some((p) => p.step.to === OFF)).toBe(false);
  });
});

describe('applySteps', () => {
  it('sends a hit checker to the bar', () => {
    const s = pos({ p0: { 10: 1 }, p1: { [opp(7)]: 1 }, dice: [3, 3] });
    const out = applySteps(s, 'p0', [{ from: 10, to: 7 }]);
    expect(out).not.toBeNull();
    expect(out!.bar.p1).toBe(1);
    expect(out!.hits).toEqual([opp(7)]);
  });

  it('leaves the opponent borne-off count alone', () => {
    const s = pos({ p0: { 10: 1 }, p1: { 5: 3 }, dice: [3, 3] });
    const before = s.off.p1;
    const out = applySteps(s, 'p0', [{ from: 10, to: 7 }]);
    expect(out!.off.p1).toBe(before);
  });

  it('rejects moving a checker that is not there', () => {
    const s = pos({ p0: { 10: 1 }, dice: [3, 3] });
    expect(applySteps(s, 'p0', [{ from: 9, to: 6 }])).toBeNull();
  });

  it('rejects moving anything else while on the bar', () => {
    const s = pos({ p0: { 10: 1 }, bar: { p0: 1 }, dice: [3, 3] });
    expect(applySteps(s, 'p0', [{ from: 10, to: 7 }])).toBeNull();
  });
});

describe('previewDraft', () => {
  it('moves checkers without touching version, turn or phase', () => {
    const s = pos({ p0: { 10: 1, 5: 14 }, dice: [3, 2] });
    const p = previewDraft(s, 'p0', [{ from: 10, to: 7 }]);
    expect(p.version).toBe(s.version);
    expect(p.turn).toBe(s.turn);
    expect(p.phase).toBe(s.phase);
    expect(p.points).not.toEqual(s.points);
  });

  it('is a no-op for an empty draft', () => {
    const s = pos({ p0: { 10: 1 }, dice: [3, 2] });
    expect(previewDraft(s, 'p0', [])).toBe(s);
  });

  it('replays the opponent turn through the same code path', () => {
    const s = pos({ p0: { 10: 2 }, p1: { 10: 2 }, dice: [3, 2], turn: 'p1' });
    const half = previewDraft(s, 'p1', [{ from: 10, to: 7 }]);
    const full = previewDraft(half, 'p1', [{ from: 10, to: 8 }]);
    const direct = previewDraft(s, 'p1', [
      { from: 10, to: 7 },
      { from: 10, to: 8 },
    ]);
    expect(full.points).toEqual(direct.points);
  });
});

describe('nextSteps / isCompleteTurn', () => {
  it('only offers continuations that keep a maximal turn reachable', () => {
    const s = pos({ p0: { 10: 1, 5: 14 }, dice: [3, 2] });
    const first = nextSteps(s, 'p0', []);
    expect(first.length).toBeGreaterThan(0);
    // Every offered first step must extend to a complete turn.
    for (const step of first) {
      expect(nextSteps(s, 'p0', [step]).length).toBeGreaterThan(0);
    }
  });

  it('rejects a short turn when both dice are playable', () => {
    const s = pos({ p0: { 10: 1, 5: 14 }, dice: [3, 2] });
    expect(isCompleteTurn(s, 'p0', [{ from: 10, to: 7 }])).toBe(false);
    expect(
      isCompleteTurn(s, 'p0', [
        { from: 10, to: 7 },
        { from: 7, to: 5 },
      ]),
    ).toBe(true);
  });

  it('treats the empty turn as complete when nothing can be played', () => {
    // Fully blocked entry: every point in the opponent's home board is made.
    const p1: Record<number, number> = {};
    for (let i = 0; i < 6; i++) p1[i] = 2;
    p1[10] = 3;
    const s = pos({ p0: { 5: 14 }, p1, bar: { p0: 1 }, dice: [3, 2] });
    expect(turnLines(s, 'p0').map((l) => notate(l.steps))).toEqual(['']);
    expect(isCompleteTurn(s, 'p0', [])).toBe(true);
  });
});
