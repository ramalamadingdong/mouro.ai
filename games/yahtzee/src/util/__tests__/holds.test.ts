import { describe, expect, it } from 'vitest';
import { RULES } from '@/engine';
import { HOLDS_MASK_MAX, holdsToMask, maskToHolds } from '@/util/holds';

describe('holds bitmask codec', () => {
  it('round-trips every reachable set of held dice', () => {
    for (let mask = 0; mask <= HOLDS_MASK_MAX; mask++) {
      const indices = maskToHolds(mask);
      expect(holdsToMask(indices)).toBe(mask);
    }
  });

  it('stays inside the range the rules accept', () => {
    // The rule is `>= 0 && <= 31`; a mask outside it is refused outright, so
    // every input the app can produce must land in it.
    const all = Array.from({ length: RULES.DICE }, (_, i) => i);
    expect(holdsToMask(all)).toBe(HOLDS_MASK_MAX);
    expect(holdsToMask([])).toBe(0);
  });

  it('encodes "nothing held" as a storable 0, not an absent node', () => {
    // The whole point of the mask: the old empty array was pruned to null by
    // RTDB, making "holding nothing" indistinguishable from "never published".
    expect(holdsToMask([])).toBe(0);
    expect(maskToHolds(0)).toEqual([]);
  });

  it('returns indices sorted and deduplicated', () => {
    expect(maskToHolds(holdsToMask([4, 0, 4, 2, 0]))).toEqual([0, 2, 4]);
  });

  it('drops indices the engine has no die for', () => {
    expect(holdsToMask([-1, 5, 99, 1.5, Number.NaN, 2])).toBe(1 << 2);
  });

  it('ignores bits above the die count in a hostile mask', () => {
    // Bit 5 and up cannot be a die. The rules cap the value at 31, but a room
    // written before the cap — or by a client that lies — must not widen `keep`.
    expect(maskToHolds(0xffff)).toEqual([0, 1, 2, 3, 4]);
    expect(maskToHolds(1 << 9)).toEqual([]);
  });

  it('treats non-finite and negative masks as nothing held', () => {
    expect(maskToHolds(Number.NaN)).toEqual([]);
    expect(maskToHolds(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(maskToHolds(Number.NEGATIVE_INFINITY)).toEqual([]);
    // -1 is all-bits-set under `&`; without the guard it decodes to every die.
    expect(maskToHolds(-1)).toEqual([]);
  });

  it('truncates a fractional mask rather than trusting it', () => {
    // `4.5` passes the rules' numeric range test — they have no integer check.
    expect(maskToHolds(3.9)).toEqual([0, 1]);
  });
});
