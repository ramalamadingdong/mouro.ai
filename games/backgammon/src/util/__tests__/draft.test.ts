import { packSteps, unpackSteps } from '../draft';

describe('draft wire format', () => {
  it('round-trips a staged turn, including the bar and bearing off', () => {
    const steps = [
      { from: 24, to: 20 },
      { from: 5, to: -1 },
      { from: 12, to: 9 },
      { from: 9, to: 6 },
    ];
    expect(packSteps(steps)).toBe('24:20,5:-1,12:9,9:6');
    expect(unpackSteps(packSteps(steps))).toEqual(steps);
  });

  it('treats an empty draft as no steps', () => {
    expect(packSteps([])).toBe('');
    expect(unpackSteps('')).toEqual([]);
  });

  it('ignores anything malformed rather than guessing', () => {
    for (const bad of [undefined, null, 7, 'abc', '1:2,', '1:2;3:4', '1:2,3:4,5:6,7:8,9:10', '100:2']) {
      expect(unpackSteps(bad)).toEqual([]);
    }
  });
});
