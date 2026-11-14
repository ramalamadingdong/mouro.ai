/**
 * The dice-usage rules, which are the ones players actually argue about:
 * you must play both dice if you can; if only one, it must be the larger; a
 * double gives four; and if nothing can be played the turn is forfeited.
 *
 * All of these fall out of "keep only the maximal lines" plus one tail filter,
 * so these tests pin the behaviour rather than the implementation.
 */
import { OFF, toScratch } from '../board';
import { maxUsableDice, plies, turnLines } from '../moves';
import { linesOf, pos } from './helpers';

const opp = (i: number) => 23 - i;

describe('must use both dice', () => {
  it('requires two steps when two are available', () => {
    const s = pos({ p0: { 10: 1, 5: 14 }, dice: [3, 2] });
    expect(maxUsableDice(s, 'p0')).toBe(2);
    for (const line of turnLines(s, 'p0')) expect(line.steps).toHaveLength(2);
  });

  it('offers both orderings of the two dice', () => {
    const s = pos({ p0: { 10: 1 }, p1: { 10: 1 }, dice: [3, 2] });
    const lines = linesOf(turnLines(s, 'p0'));
    expect(lines).toContain('10/7 7/5');
    expect(lines).toContain('10/8 8/5');
  });
});

describe('must use the larger die when only one is playable', () => {
  /**
   * p0 is on the bar with two entry points open (a 1 enters on own 23, a 6 on
   * own 18) but is stuck immediately after either. Both single-die turns exist,
   * so the rule has to choose — and it must choose the 6.
   */
  const stuck = pos({
    p0: { 23: 14 },
    p1: { 6: 2, 1: 2, 2: 11 },
    bar: { p0: 1 },
    dice: [1, 6],
  });

  it('finds only one playable die', () => {
    expect(maxUsableDice(stuck, 'p0')).toBe(1);
  });

  it('discards the small-die line', () => {
    expect(linesOf(turnLines(stuck, 'p0'))).toEqual(['bar/18']);
  });

  it('records the die actually consumed', () => {
    expect(turnLines(stuck, 'p0')[0].dice).toEqual([6]);
  });

  it('keys the rule on the consumed die, not the distance travelled', () => {
    // An overshoot bear-off spends a 6 while only travelling 4 pips. If the
    // filter used `from - to` it would mistake this for playing a 4.
    const s = pos({ p0: { 3: 2, 1: 2 }, dice: [6, 6] });
    const ply = plies(toScratch(s, 'p0'), 6).find((p) => p.step.to === OFF)!;
    expect(ply.die).toBe(6);
    expect(ply.step.from - ply.step.to).toBe(4);
  });
});

describe('doubles', () => {
  it('give four moves', () => {
    const s = pos({ p0: { 12: 1, 5: 14 }, dice: [3, 3] });
    expect(maxUsableDice(s, 'p0')).toBe(4);
  });

  it('are capped at what the position allows', () => {
    /**
     * Two on the bar entering on own 21 with 3s; afterwards only one more 3 is
     * playable (20/17) and then everything is blocked.
     */
    const s = pos({
      p0: { 20: 1, 5: 12 },
      p1: { 5: 2, 9: 2, 21: 2, 12: 9 },
      bar: { p0: 2 },
      dice: [3, 3],
    });
    expect(maxUsableDice(s, 'p0')).toBe(3);
    expect(linesOf(turnLines(s, 'p0'))).toEqual(['bar/21 bar/21 20/17']);
  });

  it('collapse identical die values into one branch', () => {
    // Four identical pips must not produce 4! orderings of the same line.
    const s = pos({ p0: { 12: 1, 5: 14 }, dice: [2, 2] });
    const lines = turnLines(s, 'p0');
    expect(new Set(linesOf(lines)).size).toBe(lines.length);
  });
});

describe('no legal move', () => {
  it('forfeits the turn when entry is completely blocked', () => {
    const p1: Record<number, number> = { 10: 3 };
    for (let i = 0; i < 6; i++) p1[i] = 2;
    const s = pos({ p0: { 5: 14 }, p1, bar: { p0: 1 }, dice: [5, 4] });
    expect(maxUsableDice(s, 'p0')).toBe(0);
    expect(linesOf(turnLines(s, 'p0'))).toEqual(['']);
  });

  it('forfeits when every destination is made by the opponent', () => {
    const s = pos({
      p0: { 10: 2 },
      p1: { [opp(7)]: 2, [opp(6)]: 2, 5: 11 },
      dice: [3, 4],
    });
    expect(maxUsableDice(s, 'p0')).toBe(0);
  });
});

describe('turnLines guards', () => {
  it('returns nothing outside the moving phase', () => {
    expect(turnLines(pos({ p0: { 10: 1 } }), 'p0')).toEqual([]);
  });
});
