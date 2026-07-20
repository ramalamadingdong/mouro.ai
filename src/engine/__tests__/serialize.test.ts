import { normalize } from '../serialize';
import { initialMatchState } from '../reducer';

const H = 'H';
const G = 'G';

function fresh() {
  return initialMatchState({
    hostUid: H, guestUid: G, hostName: 'Host', guestName: 'Guest', seed: [1, 2, 3],
  });
}

describe('normalize', () => {
  test('passes through a valid state', () => {
    const s = fresh();
    const n = normalize(JSON.parse(JSON.stringify(s)));
    expect(n).not.toBeNull();
    expect(n).toEqual(s);
  });

  test('restores pruned empty arrays and null fields', () => {
    const s = fresh();
    const raw: any = JSON.parse(JSON.stringify(s));
    // Simulate RTDB pruning empty containers / nulls.
    delete raw.noDiscard; // was null
    delete raw.roundResult; // was null
    delete raw.matchResult; // was null
    delete raw.lastMove; // was null
    // Simulate an empty discard being pruned entirely.
    raw.discard = undefined;
    delete raw.discard;
    const n = normalize(raw)!;
    expect(n).not.toBeNull();
    expect(n.noDiscard).toBeNull();
    expect(n.roundResult).toBeNull();
    expect(n.matchResult).toBeNull();
    expect(n.lastMove).toBeNull();
    expect(n.discard).toEqual([]);
  });

  test('coerces integer-keyed objects back to arrays', () => {
    const s = fresh();
    const raw: any = JSON.parse(JSON.stringify(s));
    const stockArr = raw.stock as number[];
    // RTDB may deliver an array as an integer-keyed object.
    const asObj: Record<string, number> = {};
    stockArr.forEach((v, i) => (asObj[String(i)] = v));
    raw.stock = asObj;
    // hands too
    raw.hands.p0 = raw.hands.p0.reduce((acc: any, v: number, i: number) => {
      acc[String(i)] = v;
      return acc;
    }, {});
    const n = normalize(raw)!;
    expect(Array.isArray(n.stock)).toBe(true);
    expect(n.stock).toEqual(stockArr);
    expect(Array.isArray(n.hands.p0)).toBe(true);
    expect(n.hands.p0).toEqual(s.hands.p0);
  });

  test('normalizes a roundResult with pruned meld/layoff arrays', () => {
    const s = fresh();
    const raw: any = JSON.parse(JSON.stringify(s));
    raw.phase = 'roundOver';
    raw.roundResult = {
      type: 'void',
      // knocker/winner null -> pruned
      deadwood: { p0: 0, p1: 0 },
      points: 0,
      handAtReveal: { p0: {}, p1: {} }, // empty arrays pruned to {}
      // knockerMelds, layoffs etc. all pruned
    };
    const n = normalize(raw)!;
    expect(n.roundResult).not.toBeNull();
    expect(n.roundResult!.knocker).toBeNull();
    expect(n.roundResult!.winner).toBeNull();
    expect(n.roundResult!.knockerMelds).toEqual([]);
    expect(n.roundResult!.layoffs).toEqual([]);
    expect(n.roundResult!.handAtReveal.p0).toEqual([]);
    expect(n.roundResult!.knockCard).toBeNull(); // pruned null -> null (not 0/A♣)
  });

  test('preserves a knockCard of 0 (A♣) across the RTDB round-trip', () => {
    const s = fresh();
    const raw: any = JSON.parse(JSON.stringify(s));
    raw.phase = 'roundOver';
    raw.roundResult = {
      type: 'knock',
      knocker: 'p0',
      deadwood: { p0: 3, p1: 10 },
      winner: 'p0',
      points: 7,
      knockCard: 0, // A♣ — falsy, must not be coerced to null
      handAtReveal: { p0: {}, p1: {} },
    };
    const n = normalize(raw)!;
    expect(n.roundResult!.knockCard).toBe(0);
  });

  test('rejects a roundResult with an invalid type', () => {
    const s = fresh();
    const raw: any = JSON.parse(JSON.stringify(s));
    raw.phase = 'roundOver';
    raw.roundResult = {
      type: 'NONSENSE',
      deadwood: { p0: 0, p1: 0 },
      points: 0,
      handAtReveal: { p0: {}, p1: {} },
    };
    // roundResult drops to null (bad type) -> terminal phase with no result -> reject.
    expect(normalize(raw)).toBeNull();
  });

  test('drops a lastMove with an invalid kind', () => {
    const s = fresh();
    const raw: any = JSON.parse(JSON.stringify(s));
    raw.lastMove = { by: 'H', seat: 'p0', kind: 'BOGUS', at: 123 };
    const n = normalize(raw)!;
    expect(n).not.toBeNull();
    expect(n.lastMove).toBeNull();
  });

  test('keeps a lastMove with a valid kind', () => {
    const s = fresh();
    const raw: any = JSON.parse(JSON.stringify(s));
    raw.lastMove = { by: 'H', seat: 'p0', kind: 'drawStock', at: 123 };
    const n = normalize(raw)!;
    expect(n.lastMove).toMatchObject({ by: 'H', seat: 'p0', kind: 'drawStock' });
  });

  test('rejects a terminal phase whose result object is missing', () => {
    const s = fresh();
    const rawRound: any = JSON.parse(JSON.stringify(s));
    rawRound.phase = 'roundOver'; // roundResult still null
    expect(normalize(rawRound)).toBeNull();

    const rawMatch: any = JSON.parse(JSON.stringify(s));
    rawMatch.phase = 'matchOver';
    rawMatch.matchResult = { winner: 'p0', base: { p0: 1, p1: 0 }, boxes: { p0: 1, p1: 0 } };
    // final omitted -> matchResult normalizes to null -> reject.
    expect(normalize(rawMatch)).toBeNull();
  });

  test('rejects non-objects and structurally invalid states', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(42)).toBeNull();
    expect(normalize('x')).toBeNull();
    expect(normalize({})).toBeNull();
    expect(normalize({ players: { p0: 'a' }, names: { p0: 'x', p1: 'y' } })).toBeNull();
  });
});
