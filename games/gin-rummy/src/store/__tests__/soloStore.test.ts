// Deterministic, side-effect-free seed so newGame deals without touching native crypto.
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n),
}));

import type { CardId, GameState, Move } from '@/engine';
import { nextOpp, useSoloStore, CPU_UID } from '@/store/soloStore';

const emptyOpp = { wanted: [] as CardId[], discarded: [] as CardId[] };

function stateWith(over: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    players: { p0: 'p0-local', p1: CPU_UID },
    names: { p0: 'You', p1: 'Computer' },
    target: 100,
    scores: { p0: 0, p1: 0 },
    boxes: { p0: 0, p1: 0 },
    round: 1,
    dealer: 'p1',
    phase: 'draw',
    turn: 'p0',
    turnUid: 'p0-local',
    noDiscard: null,
    stock: [],
    discard: [16],
    hands: { p0: [], p1: [] },
    roundResult: null,
    matchResult: null,
    lastMove: null,
    ...over,
  };
}

describe('nextOpp (pure observation log)', () => {
  test('taking the upcard / drawing the discard records what the human wanted', () => {
    const prev = stateWith({ discard: [3, 7] }); // top = 7
    expect(nextOpp(emptyOpp, prev, { kind: 'drawDiscard' }).wanted).toEqual([7]);
    expect(nextOpp(emptyOpp, prev, { kind: 'takeUpcard' }).wanted).toEqual([7]);
  });

  test('discarding / knocking records what the human threw', () => {
    const prev = stateWith();
    expect(nextOpp(emptyOpp, prev, { kind: 'discard', card: 40 }).discarded).toEqual([40]);
    expect(nextOpp(emptyOpp, prev, { kind: 'knock', discard: 41 }).discarded).toEqual([41]);
  });

  test('a new deal clears the model', () => {
    const seeded = { wanted: [1, 2], discarded: [3] };
    const prev = stateWith();
    const seed: Move = { kind: 'nextRound', seed: [1] };
    expect(nextOpp(seeded, prev, seed)).toEqual(emptyOpp);
    expect(nextOpp(seeded, prev, { kind: 'rematch', seed: [1] })).toEqual(emptyOpp);
  });

  test('drawing from stock leaves the model unchanged', () => {
    const seeded = { wanted: [1], discarded: [] };
    expect(nextOpp(seeded, stateWith(), { kind: 'drawStock' })).toBe(seeded);
  });
});

describe('useSoloStore observation log integration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    useSoloStore.getState().reset();
    jest.useRealTimers();
  });

  test('a human take then discard updates opp; reset clears it', () => {
    const store = useSoloStore.getState();
    store.newGame('You', 'hard');

    let s = useSoloStore.getState().state!;
    expect(s.phase).toBe('upcard1');
    expect(useSoloStore.getState().opp).toEqual(emptyOpp);

    const upcard = s.discard[s.discard.length - 1];
    store.send({ kind: 'takeUpcard' });
    expect(useSoloStore.getState().opp.wanted).toContain(upcard);

    s = useSoloStore.getState().state!;
    const toThrow = s.hands.p0.find((c) => c !== upcard)!;
    store.send({ kind: 'discard', card: toThrow });
    expect(useSoloStore.getState().opp.discarded).toContain(toThrow);
    // Turn has passed to the CPU; a move is scheduled (fake timers hold it).
    expect(useSoloStore.getState().state!.turnUid).toBe(CPU_UID);

    useSoloStore.getState().reset();
    expect(useSoloStore.getState().state).toBeNull();
    expect(useSoloStore.getState().opp).toEqual(emptyOpp);
  });
});
