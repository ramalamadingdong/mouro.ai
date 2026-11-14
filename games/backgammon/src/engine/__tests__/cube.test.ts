import { CUBE_MAX, canDouble, isCrawfordGame, nextCubeValue } from '../cube';
import { applyMove } from '../reducer';
import type { Seat } from '../types';
import { GUEST, HOST, ok, pos } from './helpers';

describe('canDouble', () => {
  const at = (over: Parameters<typeof pos>[0]) => pos({ p0: { 10: 1 }, phase: 'roll', ...over });

  it('is allowed on roll with a centred cube', () => {
    expect(canDouble(at({ turn: 'p0' }), 'p0')).toBe(true);
  });

  it('is not allowed to the player who is not on roll', () => {
    expect(canDouble(at({ turn: 'p0' }), 'p1')).toBe(false);
  });

  it('is not allowed after rolling', () => {
    expect(canDouble(at({ dice: [3, 2], phase: 'moving' }), 'p0')).toBe(false);
  });

  it('is not allowed during the opening roll', () => {
    expect(canDouble(at({ phase: 'opening' }), 'p0')).toBe(false);
  });

  it('is allowed only to the cube owner once it has been turned', () => {
    expect(canDouble(at({ cube: { value: 2, owner: 'p0' } }), 'p0')).toBe(true);
    const opponentOwns = at({ cube: { value: 2, owner: 'p1' } });
    expect(canDouble(opponentOwns, 'p0')).toBe(false);
  });

  it('is never allowed in the Crawford game', () => {
    expect(canDouble(at({ crawford: true }), 'p0')).toBe(false);
  });

  it('stops at 64', () => {
    expect(canDouble(at({ cube: { value: CUBE_MAX, owner: 'p0' } }), 'p0')).toBe(false);
    expect(nextCubeValue(32)).toBe(64);
    expect(nextCubeValue(64)).toBe(64);
  });
});

describe('offering, taking and dropping', () => {
  const before = pos({ p0: { 10: 1 }, p1: { 10: 1 }, phase: 'roll', turn: 'p0' });

  it('hands the decision to the responder by flipping the turn', () => {
    const s = ok(applyMove(before, { kind: 'double' }, HOST));
    expect(s.phase).toBe('doubled');
    expect(s.offer).toEqual({ by: 'p0', value: 2 });
    // The turn flip is load-bearing: it is what makes the security rule's
    // `turnUid === auth.uid` grant exactly the responder the right to answer.
    expect(s.turn).toBe('p1');
    expect(s.turnUid).toBe(GUEST);
    // The cube itself does not move until the double is taken.
    expect(s.cube).toEqual({ value: 1, owner: null });
  });

  it('lets only the responder answer', () => {
    const s = ok(applyMove(before, { kind: 'double' }, HOST));
    expect(applyMove(s, { kind: 'take' }, HOST).ok).toBe(false);
    expect(applyMove(s, { kind: 'take' }, GUEST).ok).toBe(true);
  });

  it('gives the cube to the taker and returns the roll to the doubler', () => {
    const offered = ok(applyMove(before, { kind: 'double' }, HOST));
    const taken = ok(applyMove(offered, { kind: 'take' }, GUEST));
    expect(taken.cube).toEqual({ value: 2, owner: 'p1' });
    expect(taken.offer).toBeNull();
    expect(taken.phase).toBe('roll');
    expect(taken.turn).toBe('p0');
    expect(canDouble(taken, 'p0')).toBe(false);
    expect(canDouble(taken, 'p1')).toBe(false); // p1 is not on roll
  });

  it('scores a drop at the value BEFORE the double', () => {
    const offered = ok(applyMove(before, { kind: 'double' }, HOST));
    const dropped = ok(applyMove(offered, { kind: 'pass' }, GUEST));
    expect(dropped.phase).toBe('gameOver');
    expect(dropped.gameResult).toMatchObject({ winner: 'p0', how: 'pass', points: 1, multiplier: 1 });
    expect(dropped.scores).toEqual({ p0: 1, p1: 0 });
  });

  it('scores a drop of a redouble at the standing value', () => {
    const owned = pos({
      p0: { 10: 1 },
      p1: { 10: 1 },
      phase: 'roll',
      turn: 'p0',
      cube: { value: 4, owner: 'p0' },
    });
    const offered = ok(applyMove(owned, { kind: 'double' }, HOST));
    expect(offered.offer).toEqual({ by: 'p0', value: 8 });
    const dropped = ok(applyMove(offered, { kind: 'pass' }, GUEST));
    expect(dropped.gameResult?.points).toBe(4);
  });

  it('rejects a double in the Crawford game with a readable reason', () => {
    const crawford = pos({ p0: { 10: 1 }, phase: 'roll', crawford: true });
    const r = applyMove(crawford, { kind: 'double' }, HOST);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/crawford/i);
  });

  it('rejects take/pass when nothing is on offer', () => {
    expect(applyMove(before, { kind: 'take' }, HOST).ok).toBe(false);
    expect(applyMove(before, { kind: 'pass' }, HOST).ok).toBe(false);
  });
});

describe('the Crawford rule', () => {
  const scores = (p0: number, p1: number): Record<Seat, number> => ({ p0, p1 });

  it('triggers the first time either player reaches one short of the match', () => {
    expect(isCrawfordGame(scores(4, 0), 5, false)).toBe(true);
    expect(isCrawfordGame(scores(0, 4), 5, false)).toBe(true);
    expect(isCrawfordGame(scores(3, 3), 5, false)).toBe(false);
  });

  it('never fires twice in a match', () => {
    expect(isCrawfordGame(scores(4, 4), 5, true)).toBe(false);
  });

  it('makes a 1-point match Crawford from the start', () => {
    expect(isCrawfordGame(scores(0, 0), 1, false)).toBe(true);
  });

  it('latches through nextGame and re-enables doubling afterwards', () => {
    // A game ends with p0 on 4 of 5 — the NEXT game is Crawford.
    const over = pos({ p0: { 5: 5 }, p1: { 5: 5 }, phase: 'gameOver', scores: { p0: 4 }, target: 5 });
    over.gameResult = {
      winner: 'p0',
      multiplier: 1,
      cube: 1,
      points: 1,
      how: 'single',
      scores: { p0: 4, p1: 0 },
      crawford: false,
    };

    const crawfordGame = ok(applyMove(over, { kind: 'nextGame' }, HOST));
    expect(crawfordGame.crawford).toBe(true);
    expect(crawfordGame.crawfordDone).toBe(false);
    expect(canDouble({ ...crawfordGame, phase: 'roll' }, 'p0')).toBe(false);

    // …and the game after THAT is post-Crawford: doubling is back on.
    const stillFour = { ...crawfordGame, phase: 'gameOver' as const, gameResult: over.gameResult };
    const post = ok(applyMove(stillFour, { kind: 'nextGame' }, HOST));
    expect(post.crawford).toBe(false);
    expect(post.crawfordDone).toBe(true);
    expect(canDouble({ ...post, phase: 'roll' }, 'p0')).toBe(true);
  });
});
