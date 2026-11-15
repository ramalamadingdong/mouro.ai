import { describe, expect, test } from 'vitest';
import {
  ANY_PLAYER,
  applyMove,
  autoEdge,
  boxEdges,
  createGame,
  edgeBoxes,
  edgeCount,
  hEdge,
  normalize,
  scores,
  vEdge,
  winners,
  type GameState,
  type Move,
} from '@/engine';

const two = (cols = 2, rows = 2) =>
  createGame({
    players: [
      { uid: 'a', name: 'Ann', isHuman: true },
      { uid: 'b', name: 'Bob', isHuman: true },
    ],
    cols,
    rows,
    by: 'a',
  });

function play(state: GameState, move: Move, uid: string): GameState {
  const r = applyMove(state, move, uid);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('geometry', () => {
  test('edge counts and box edges agree with edgeBoxes', () => {
    const size = { cols: 3, rows: 2 };
    expect(edgeCount(size)).toBe(3 * 3 + 2 * 4);
    for (let b = 0; b < 6; b++) {
      for (const e of boxEdges(size, b)) expect(edgeBoxes(size, e)).toContain(b);
    }
    expect(edgeBoxes(size, hEdge(size, 0, 0))).toEqual([0]);
    expect(edgeBoxes(size, hEdge(size, 1, 1))).toEqual([1, 4]);
    expect(edgeBoxes(size, vEdge(size, 1, 3))).toEqual([5]);
  });
});

describe('reducer', () => {
  test('a line that closes nothing passes the turn; closing a box keeps it', () => {
    let s = two(1, 1);
    s = play(s, { kind: 'line', edge: 0 }, 'a');
    expect(s.toAct).toBe(1);
    expect(s.turnUid).toBe('b');
    s = play(s, { kind: 'line', edge: 1 }, 'b');
    s = play(s, { kind: 'line', edge: 2 }, 'a');
    expect(s.toAct).toBe(1);
    s = play(s, { kind: 'line', edge: 3 }, 'b');
    expect(s.boxes).toBe('1');
    expect(s.phase).toBe('gameover');
    expect(s.toAct).toBeNull();
    expect(s.turnUid).toBe(ANY_PLAYER);
    expect(winners(s)).toEqual([1]);
  });

  test('refuses out-of-turn, repeated and unknown lines; never mutates', () => {
    const s = two();
    const before = JSON.stringify(s);
    expect(applyMove(s, { kind: 'line', edge: 0 }, 'b').ok).toBe(false);
    expect(applyMove(s, { kind: 'line', edge: 99 }, 'a').ok).toBe(false);
    expect(applyMove(s, { kind: 'line', edge: 0 }, 'zed').ok).toBe(false);
    const after = play(s, { kind: 'line', edge: 0 }, 'a');
    expect(applyMove(after, { kind: 'line', edge: 0 }, 'b').ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(after.version).toBe(s.version + 1);
  });

  test('one line can close two boxes', () => {
    const size = { cols: 2, rows: 1 };
    let s = two(2, 1);
    const middle = vEdge(size, 0, 1);
    const others = [0, 1, 2, 3, vEdge(size, 0, 0), vEdge(size, 0, 2)];
    let uid = 'a';
    for (const e of others) {
      s = play(s, { kind: 'line', edge: e }, s.turnUid);
      uid = s.turnUid;
    }
    s = play(s, { kind: 'line', edge: middle }, uid);
    expect(s.lastMove.closed).toBe(2);
    expect(scores(s)[Number(s.boxes[0])]).toBe(2);
  });

  test('away draws for the absent player and marks them; their own move clears it', () => {
    let s = two();
    expect(applyMove(s, { kind: 'away' }, 'a').ok).toBe(false); // not for yourself
    s = play(s, { kind: 'away' }, 'b');
    expect(s.players[0].sitOut).toBe(true);
    expect(s.lastMove.by).toBe('b');
    expect(s.lastMove.seat).toBe(0);
    s = play(s, { kind: 'line', edge: autoEdge(s) }, 'b');
    s = play(s, { kind: 'line', edge: autoEdge(s) }, 'a');
    expect(s.players[0].sitOut).toBe(false);
  });

  test('rematch only after the game, and the next seat starts', () => {
    let s = two(1, 1);
    expect(applyMove(s, { kind: 'rematch' }, 'a').ok).toBe(false);
    for (let i = 0; i < 4; i++) s = play(s, { kind: 'line', edge: i }, s.turnUid);
    s = play(s, { kind: 'rematch' }, 'a');
    expect(s.phase).toBe('playing');
    expect(s.toAct).toBe(1);
    expect(s.gameNo).toBe(2);
    expect(s.boxes).toBe('.');
  });
});

describe('normalize', () => {
  test('round-trips through JSON, including pruned nulls', () => {
    let s = two();
    s = play(s, { kind: 'line', edge: 0 }, 'a');
    const wire = JSON.parse(JSON.stringify(s));
    expect(normalize(wire)).toEqual(s);
    const over = (() => {
      let g = two(1, 1);
      for (let i = 0; i < 4; i++) g = play(g, { kind: 'line', edge: i }, g.turnUid);
      return g;
    })();
    const pruned = JSON.parse(JSON.stringify(over));
    delete pruned.toAct;
    expect(normalize(pruned)).toEqual(over);
  });

  test('rejects forged boxes, bad marks and a wrong phase', () => {
    const s = two();
    expect(normalize({ ...s, boxes: '0...' })).toBeNull(); // claimed but open
    expect(normalize({ ...s, edges: '3' + s.edges.slice(1) })).toBeNull(); // no seat 3
    expect(normalize({ ...s, phase: 'gameover' })).toBeNull();
    expect(normalize({ ...s, edges: s.edges.slice(1) })).toBeNull();
    expect(normalize({ ...s, players: { 0: s.players[0], 1: s.players[1] } })).not.toBeNull();
  });
});

describe('fuzz', () => {
  test('random games always end with every box claimed and scores summing up', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let g = 0; g < 200; g++) {
      const n = 2 + (g % 3);
      let s = createGame({
        players: Array.from({ length: n }, (_, i) => ({ uid: `p${i}`, name: `P${i}`, isHuman: true })),
        cols: 2 + (g % 4),
        rows: 2 + ((g >> 2) % 4),
        by: 'p0',
      });
      while (s.phase === 'playing') {
        const free = [...s.edges].flatMap((ch, e) => (ch === '.' ? [e] : []));
        s = play(s, { kind: 'line', edge: free[Math.floor(rng() * free.length)] }, s.turnUid);
        expect(normalize(JSON.parse(JSON.stringify(s)))).toEqual(s);
      }
      expect(scores(s).reduce((x, y) => x + y, 0)).toBe(s.boxes.length);
    }
  });
});
