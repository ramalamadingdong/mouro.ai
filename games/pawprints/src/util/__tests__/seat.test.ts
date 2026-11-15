import { describe, expect, it } from 'vitest';
import {
  MAX_JOINED_AT_DIGITS,
  MAX_NAME_LENGTH,
  MAX_SEAT_STRING_LENGTH,
  packSeat,
  unpackSeat,
} from '@/util/seat';

/**
 * The `seats/$uid` grant, transcribed from database.rules.json.
 *
 * Every assertion below runs through this rather than through hand-written
 * expectations, so the suite fails loudly the day the packer and the rule drift
 * apart. The failure mode it guards against is silent on the wire: a write the
 * rule refuses comes back as a bare PERMISSION_DENIED with no indication that
 * the name was one byte too long.
 */
function rulePermits(value: unknown): boolean {
  if (typeof value !== 'string') return false; // newData.isString()
  // The rules count length in UTF-8 bytes for non-ASCII; the packer budgets in
  // bytes for the same reason, so the check has to as well.
  const length = new TextEncoder().encode(value).length;
  if (length < 3 || length > MAX_SEAT_STRING_LENGTH) return false;
  return /^[0-9]{1,15}[|]/.test(value);
}

/** A seat the rule accepts and that survives the round trip unchanged. */
function expectWritable(joinedAt: number, name: string): string {
  const packed = packSeat(joinedAt, name);
  expect(rulePermits(packed), `rule rejects ${JSON.stringify(packed)}`).toBe(true);
  expect(unpackSeat(packed)).not.toBeNull();
  return packed;
}

const NOW = 1_784_571_234_567;

describe('packSeat / unpackSeat', () => {
  it('round-trips an ordinary seat', () => {
    expectWritable(NOW, 'Ann');
    expect(unpackSeat(packSeat(NOW, 'Ann'))).toEqual({ name: 'Ann', joinedAt: NOW });
    expect(packSeat(NOW, 'Ann')).toBe(`${NOW}|Ann`);
  });

  it('keeps a name that contains the delimiter', () => {
    // The decoder must split on the FIRST '|' only: `split('|')[1]` would hand
    // back "Ann" and quietly amputate the rest of a legitimate name.
    const name = 'Ann|Bea|Cy';
    expectWritable(NOW, name);
    expect(unpackSeat(packSeat(NOW, name))).toEqual({ name, joinedAt: NOW });
  });

  it('trims whitespace and substitutes an empty name', () => {
    expect(unpackSeat(packSeat(NOW, '  Ann  '))?.name).toBe('Ann');
    // The rule's `length >= 3` would refuse "<stamp>|", so an all-whitespace
    // name has to become something — matching the old cleanName behaviour.
    for (const blank of ['', '   ', '\t\n']) {
      expect(unpackSeat(expectWritable(NOW, blank))?.name).toBe('Player');
    }
  });

  it('accepts a name exactly at the cap', () => {
    const name = 'A'.repeat(MAX_NAME_LENGTH);
    expect(unpackSeat(expectWritable(NOW, name))?.name).toBe(name);
  });

  it('clamps a name over the cap instead of producing a rejected write', () => {
    const packed = expectWritable(NOW, 'A'.repeat(500));
    expect(unpackSeat(packed)?.name).toBe('A'.repeat(MAX_NAME_LENGTH));
  });

  it('keeps unicode and emoji names inside the byte cap', () => {
    for (const name of ['Åsa', 'Ann🎲', '日本語の名前', '🎲'.repeat(40), 'Zoë García']) {
      const packed = expectWritable(NOW, name);
      const back = unpackSeat(packed);
      expect(back).not.toBeNull();
      // Truncation never splits a character. An intact emoji is a surrogate
      // PAIR, so the thing to look for is an UNPAIRED one — that is what a
      // code-unit slice leaves behind, and it survives JSON as U+FFFD.
      expect(back?.name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(name.startsWith(back?.name ?? '#')).toBe(true);
    }
  });

  it('produces a rule-legal string for any timestamp the clock can emit', () => {
    for (const stamp of [0, 1, Date.now(), NOW, 10 ** MAX_JOINED_AT_DIGITS - 1]) {
      expect(unpackSeat(expectWritable(stamp, 'Ann'))?.joinedAt).toBe(stamp);
    }
  });

  it('coerces a timestamp the rule regex could never accept', () => {
    // Digits only: no sign, no fraction, no exponent, at most 15 of them. A
    // garbage stamp degrades to something writable — `seatOrder` merely sorts
    // it first — rather than to a silent PERMISSION_DENIED.
    for (const stamp of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 1e21]) {
      expectWritable(stamp, 'Ann');
    }
    expect(unpackSeat(packSeat(-1, 'Ann'))?.joinedAt).toBe(0);
    expect(unpackSeat(packSeat(Number.NaN, 'Ann'))?.joinedAt).toBe(0);
    expect(unpackSeat(packSeat(1.5, 'Ann'))?.joinedAt).toBe(1);
  });
});

describe('unpackSeat rejects anything that is not a packed seat', () => {
  it('rejects non-strings', () => {
    // The legacy object shape lands here too — decodeSeats falls through to its
    // own branch for those, so this must NOT try to interpret it.
    for (const raw of [0, 1784571234567, true, null, undefined, [], {}, { name: 'Ann', joinedAt: 1 }]) {
      expect(unpackSeat(raw)).toBeNull();
    }
  });

  it('rejects strings with no usable delimiter or prefix', () => {
    for (const raw of [
      '',
      'Ann',
      '|Ann', // empty timestamp
      'Ann|1784571234567', // the halves the wrong way round
      '17845x1234|Ann', // non-numeric prefix
      '-1784571234|Ann', // signed
      '1.5|Ann', // fractional
      ' 1784571234567|Ann', // leading space
      '1784571234567901234|Ann', // more than 15 digits
    ]) {
      expect(unpackSeat(raw), raw).toBeNull();
    }
  });

  it('substitutes a name for a seat that has a prefix and nothing else', () => {
    // Not reachable through packSeat, but reachable through a lying client.
    expect(unpackSeat('1784571234567|')).toEqual({ name: 'Player', joinedAt: NOW });
  });
});
