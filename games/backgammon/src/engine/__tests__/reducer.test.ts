import { applyMove, initialMatchState, isFinished, legalMoves, seatOf } from '../reducer';
import { rollDice, rollDie } from '../rng';
import type { Move } from '../types';
import { GUEST, HOST, ok, pos } from './helpers';

/** Find a seed whose single die is `d`. Cheap: the search space is tiny. */
function seedForDie(d: number): number[] {
  for (let i = 0; i < 100000; i++) if (rollDie([i]) === d) return [i];
  throw new Error(`no seed produces a ${d}`);
}

/** Find a seed whose pair of dice is exactly `[a, b]`. */
function seedForDice(a: number, b: number): number[] {
  for (let i = 0; i < 500000; i++) {
    const [x, y] = rollDice([i]);
    if (x === a && y === b) return [i];
  }
  throw new Error(`no seed produces ${a},${b}`);
}

const play = (steps: { from: number; to: number }[]): Move => ({ kind: 'play', steps });

describe('initialMatchState', () => {
  const s = initialMatchState({
    hostUid: HOST,
    guestUid: GUEST,
    hostName: 'Host',
    guestName: 'Guest',
    target: 5,
  });

  it('starts at version 0 in the opening phase', () => {
    expect(s.version).toBe(0);
    expect(s.phase).toBe('opening');
    expect(s.opening).toEqual({ p0: null, p1: null });
    expect(s.dice).toEqual([]);
  });

  it('seats the host as p0 and keeps turnUid in step', () => {
    expect(s.players.p0).toBe(HOST);
    expect(s.turnUid).toBe(s.players[s.turn]);
    expect(seatOf(s, HOST)).toBe('p0');
    expect(seatOf(s, GUEST)).toBe('p1');
    expect(seatOf(s, 'nobody')).toBeNull();
  });

  it('has no doubling at all, even in a 1-point match (Tawleh)', () => {
    const one = initialMatchState({ hostUid: HOST, guestUid: GUEST, hostName: 'H', guestName: 'G', target: 1 });
    expect(legalMoves({ ...one, phase: 'roll' }, HOST)).toEqual(['roll']);
    expect('cube' in one).toBe(false);
  });
});

describe('the opening roll', () => {
  const base = initialMatchState({
    hostUid: HOST,
    guestUid: GUEST,
    hostName: 'Host',
    guestName: 'Guest',
    target: 5,
  });

  it('passes the turn to the other player after the first die', () => {
    const s = ok(applyMove(base, { kind: 'openingRoll', seed: seedForDie(4) }, HOST));
    expect(s.opening).toEqual({ p0: 4, p1: null });
    expect(s.turn).toBe('p1');
    expect(s.turnUid).toBe(GUEST);
    expect(s.phase).toBe('opening');
  });

  it('re-rolls on a tie', () => {
    const a = ok(applyMove(base, { kind: 'openingRoll', seed: seedForDie(3) }, HOST));
    const b = ok(applyMove(a, { kind: 'openingRoll', seed: seedForDie(3) }, GUEST));
    expect(b.phase).toBe('opening');
    expect(b.opening).toEqual({ p0: null, p1: null });
    expect(b.turn).toBe('p0');
  });

  it('lets the winner roll again for their first turn (Tawleh)', () => {
    const a = ok(applyMove(base, { kind: 'openingRoll', seed: seedForDie(2) }, HOST));
    const b = ok(applyMove(a, { kind: 'openingRoll', seed: seedForDie(5) }, GUEST));
    expect(b.turn).toBe('p1');
    expect(b.turnUid).toBe(GUEST);
    expect(b.phase).toBe('roll');
    expect(b.dice).toEqual([]);
    expect(b.opening).toBeNull();
    const c = ok(applyMove(b, { kind: 'roll', seed: [1, 2, 3] }, GUEST));
    expect(c.phase).toBe('moving');
    expect(c.dice).toHaveLength(2);
  });

  it('refuses a second die from the same player', () => {
    const a = ok(applyMove(base, { kind: 'openingRoll', seed: seedForDie(2) }, HOST));
    expect(applyMove(a, { kind: 'openingRoll', seed: seedForDie(3) }, HOST).ok).toBe(false);
  });
});

describe('turn ownership', () => {
  it('rejects a move from the player not on roll', () => {
    const s = pos({ p0: { 10: 1 }, phase: 'roll', turn: 'p0' });
    const r = applyMove(s, { kind: 'roll', seed: [1] }, GUEST);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/not your turn/i);
  });

  it('rejects a move from someone who is not in the match', () => {
    const s = pos({ p0: { 10: 1 }, phase: 'gameOver' });
    expect(applyMove(s, { kind: 'nextGame' }, 'stranger').ok).toBe(false);
  });
});

describe('rolling', () => {
  it('puts two dice on the table and moves to the moving phase', () => {
    const before = pos({ p0: { 10: 1 }, phase: 'roll' });
    const s = ok(applyMove(before, { kind: 'roll', seed: seedForDice(6, 4) }, HOST));
    expect(s.dice).toEqual([6, 4]);
    expect(s.phase).toBe('moving');
    expect(s.version).toBe(before.version + 1);
  });

  it('cannot roll twice', () => {
    const s = ok(applyMove(pos({ p0: { 10: 1 }, phase: 'roll' }), { kind: 'roll', seed: [7] }, HOST));
    expect(applyMove(s, { kind: 'roll', seed: [8] }, HOST).ok).toBe(false);
  });

  it('rejects an empty seed rather than silently rolling a constant', () => {
    expect(applyMove(pos({ p0: { 10: 1 }, phase: 'roll' }), { kind: 'roll', seed: [] }, HOST).ok).toBe(false);
  });
});

describe('playing a turn', () => {
  const s = pos({ p0: { 10: 1, 5: 14 }, dice: [3, 2] });

  it('accepts a complete turn and hands over', () => {
    const after = ok(
      applyMove(
        s,
        play([
          { from: 10, to: 7 },
          { from: 7, to: 5 },
        ]),
        HOST,
      ),
    );
    expect(after.turn).toBe('p1');
    expect(after.turnUid).toBe(GUEST);
    expect(after.phase).toBe('roll');
    expect(after.dice).toEqual([]);
    expect(after.version).toBe(s.version + 1);
    expect(after.lastMove).toMatchObject({ by: HOST, seat: 'p0', kind: 'play', dice: [3, 2] });
  });

  it('rejects a turn that plays fewer dice than it could', () => {
    const r = applyMove(s, play([{ from: 10, to: 7 }]), HOST);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/must play 2 dice/i);
  });

  it('rejects steps that do not match the dice', () => {
    expect(applyMove(s, play([{ from: 10, to: 6 }]), HOST).ok).toBe(false);
  });

  it('rejects a play when there are no dice on the table', () => {
    expect(applyMove(pos({ p0: { 10: 1 }, phase: 'roll' }), play([]), HOST).ok).toBe(false);
  });

  it('accepts the empty turn when nothing can be played', () => {
    const p1: Record<number, number> = { 10: 3 };
    for (let i = 0; i < 6; i++) p1[i] = 2;
    const blocked = pos({ p0: { 5: 14 }, p1, bar: { p0: 1 }, dice: [5, 4] });
    const after = ok(applyMove(blocked, play([]), HOST));
    expect(after.turn).toBe('p1');
    expect(after.lastMove?.steps).toEqual([]);
  });

  it('records hits for the animation layer', () => {
    const hit = pos({ p0: { 10: 1, 5: 14 }, p1: { [23 - 7]: 1, 5: 14 }, dice: [3, 2] });
    const after = ok(
      applyMove(
        hit,
        play([
          { from: 10, to: 7 },
          { from: 7, to: 5 },
        ]),
        HOST,
      ),
    );
    expect(after.bar.p1).toBe(1);
    expect(after.lastMove?.hits).toEqual([23 - 7]);
  });
});

describe('finishing a game', () => {
  it('ends the game when the last checker comes off', () => {
    const s = pos({ p0: { 0: 1 }, p1: { 5: 5 }, dice: [1, 1] });
    expect(s.off.p0).toBe(14);
    const after = ok(applyMove(s, play([{ from: 0, to: -1 }]), HOST));
    expect(isFinished(after, 'p0')).toBe(true);
    expect(after.phase).toBe('gameOver');
    expect(after.gameResult).toMatchObject({ winner: 'p0', how: 'single', points: 1 });
    expect(after.scores.p0).toBe(1);
  });

  it('ends the match when the target is reached', () => {
    const s = pos({ p0: { 0: 1 }, p1: { 5: 5 }, dice: [1, 1], target: 1 });
    const after = ok(applyMove(s, play([{ from: 0, to: -1 }]), HOST));
    expect(after.phase).toBe('matchOver');
    expect(after.matchResult).toMatchObject({ winner: 'p0', target: 1, shutout: true });
  });
});

describe('nextGame and rematch', () => {
  const over = pos({ p0: { 5: 5 }, p1: { 5: 5 }, phase: 'gameOver', scores: { p0: 2 } });
  over.gameResult = {
    winner: 'p0',
    multiplier: 1,
    points: 1,
    how: 'single',
    scores: { p0: 2, p1: 0 },
  };

  it('lets EITHER player start the next game', () => {
    expect(applyMove(over, { kind: 'nextGame' }, HOST).ok).toBe(true);
    expect(applyMove(over, { kind: 'nextGame' }, GUEST).ok).toBe(true);
  });

  it('resets the board but keeps the score', () => {
    const s = ok(applyMove(over, { kind: 'nextGame' }, GUEST));
    expect(s.phase).toBe('opening');
    expect(s.turn).toBe('p0');
    expect(s.scores).toEqual({ p0: 2, p1: 0 });
    expect(s.game).toBe(2);
    expect(s.gameResult).toBeNull();
    expect(s.off).toEqual({ p0: 0, p1: 0 });
  });

  it('refuses nextGame while the game is still running', () => {
    expect(applyMove(pos({ p0: { 10: 1 }, phase: 'roll' }), { kind: 'nextGame' }, HOST).ok).toBe(false);
  });

  it('clears the score on a rematch', () => {
    const matchOver = { ...over, phase: 'matchOver' as const, scores: { p0: 5, p1: 3 } };
    matchOver.matchResult = { winner: 'p0', scores: { p0: 5, p1: 3 }, target: 5, games: 4, shutout: false };
    const s = ok(applyMove(matchOver, { kind: 'rematch' }, GUEST));
    expect(s.scores).toEqual({ p0: 0, p1: 0 });
    expect(s.game).toBe(1);
    expect(s.matchResult).toBeNull();
  });
});

describe('legalMoves', () => {
  it('offers only a roll to the player on roll — no doubling in Tawleh', () => {
    const s = pos({ p0: { 10: 1 }, phase: 'roll', turn: 'p0' });
    expect(legalMoves(s, HOST)).toEqual(['roll']);
    expect(legalMoves(s, GUEST)).toEqual([]);
    expect(applyMove(s, { kind: 'double' } as never, HOST).ok).toBe(false);
  });

  it('still offers play when the turn is forfeited — the empty turn must be submitted', () => {
    const p1: Record<number, number> = { 10: 3 };
    for (let i = 0; i < 6; i++) p1[i] = 2;
    const s = pos({ p0: { 5: 14 }, p1, bar: { p0: 1 }, dice: [5, 4] });
    // A forced no-play is still a write: it is what hands the turn over.
    expect(legalMoves(s, HOST)).toEqual(['play']);
    expect(applyMove(s, { kind: 'play', steps: [] }, HOST).ok).toBe(true);
  });

  it('offers nothing at all in the moving phase without dice', () => {
    const broken = { ...pos({ p0: { 10: 1 }, dice: [3, 2] }), dice: [] };
    expect(legalMoves(broken, HOST)).toEqual([]);
  });

  it('offers terminal moves to both players', () => {
    const s = pos({ p0: { 5: 5 }, phase: 'matchOver' });
    expect(legalMoves(s, HOST)).toEqual(['rematch']);
    expect(legalMoves(s, GUEST)).toEqual(['rematch']);
  });
});
