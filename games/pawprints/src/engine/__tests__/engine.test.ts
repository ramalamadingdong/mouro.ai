import { describe, expect, test } from 'vitest';
import {
  ANY_PLAYER,
  applyMove,
  autoCell,
  allRuns,
  createGame,
  isLegalCell,
  normalize,
  pawCounts,
  winner,
  winningLine,
  type GameState,
  type Move,
} from '@/engine';

const make = (n = 2, size = 11) =>
  createGame({
    players: Array.from({ length: n }, (_, i) => ({ uid: 'abcd'[i], name: `P${i}`, isHuman: true })),
    size,
    by: 'a',
  });

function play(state: GameState, move: Move, uid: string): GameState {
  const r = applyMove(state, move, uid);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Play a list of points, each by whoever is on turn. */
function playAll(state: GameState, cells: number[]): GameState {
  return cells.reduce((s, cell) => play(s, { kind: 'paw', cell }, s.turnUid), state);
}

describe('reducer', () => {
  test('turns alternate; five across wins and ends the game', () => {
    let s = make();
    // a plays 0..4 across row 0; b plays row 1.
    s = playAll(s, [0, 11, 1, 12, 2, 13, 3, 14]);
    expect(s.toAct).toBe(0);
    expect(s.phase).toBe('playing');
    s = playAll(s, [4]);
    expect(s.phase).toBe('gameover');
    expect(s.toAct).toBeNull();
    expect(s.turnUid).toBe(ANY_PLAYER);
    expect(winner(s)).toBe(0);
    expect(winningLine(s)).toEqual([0, 1, 2, 3, 4]);
  });

  test('diagonals count both ways; a longer line counts too', () => {
    let s = make();
    // a: the anti-diagonal from (0,6) down-left; b: scattered along row 10.
    const diag = [6, 16, 26, 36, 46];
    const filler = [110, 112, 114, 116];
    s = playAll(s, [diag[0], filler[0], diag[1], filler[1], diag[2], filler[2], diag[3], filler[3], diag[4]]);
    expect(winner(s)).toBe(0);

    // Six in a row by filling the gap in the middle.
    let t = make();
    t = playAll(t, [0, 110, 1, 112, 2, 114, 4, 116, 5, 118, 3]);
    expect(winningLine(t)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('four in a row is enough with three or four players', () => {
    let s = make(3);
    s = playAll(s, [0, 11, 22, 1, 12, 23, 2, 13, 24]);
    expect(s.phase).toBe('playing');
    s = playAll(s, [3]);
    expect(winner(s)).toBe(0);
  });

  test('refuses out-of-turn, occupied and off-board points; never mutates', () => {
    const s = make();
    const before = JSON.stringify(s);
    expect(applyMove(s, { kind: 'paw', cell: 0 }, 'b').ok).toBe(false);
    expect(applyMove(s, { kind: 'paw', cell: 121 }, 'a').ok).toBe(false);
    expect(applyMove(s, { kind: 'paw', cell: -1 }, 'a').ok).toBe(false);
    expect(applyMove(s, { kind: 'paw', cell: 1.5 }, 'a').ok).toBe(false);
    expect(applyMove(s, { kind: 'paw', cell: 0 }, 'zed').ok).toBe(false);
    const after = play(s, { kind: 'paw', cell: 0 }, 'a');
    expect(applyMove(after, { kind: 'paw', cell: 0 }, 'b').ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(after.version).toBe(s.version + 1);
    expect(isLegalCell(after, 0)).toBe(false);
  });

  test('a full board with no line is a draw', () => {
    // Fill a 7x7 board in a pattern that never makes five of one kind for 2 players.
    let s = make(2, 7);
    const order: number[] = [];
    // Columns in pairs: row r, col c gets seat ((c >> 1) + r) % 2 — runs of at most 2 across,
    // alternate down, and diagonals broken every two steps.
    const want = (c: number) => ((((c % 7) >> 1) + Math.floor(c / 7)) % 2).toString();
    const zeros = [...Array(49).keys()].filter((c) => want(c) === '0');
    const ones = [...Array(49).keys()].filter((c) => want(c) === '1');
    expect(Math.abs(zeros.length - ones.length)).toBeLessThanOrEqual(1);
    const [first, second] = zeros.length >= ones.length ? [zeros, ones] : [ones, zeros];
    for (let i = 0; i < first.length; i++) {
      order.push(first[i]);
      if (i < second.length) order.push(second[i]);
    }
    // Whichever mark goes first is seat 0 in this game.
    s = playAll(s, order);
    expect(allRuns(s.cells, 7, 5)).toEqual([]);
    expect(s.phase).toBe('gameover');
    expect(winner(s)).toBeNull();
  });

  test('away plays for the absent player and marks them; their own move clears it', () => {
    let s = make();
    expect(applyMove(s, { kind: 'away' }, 'a').ok).toBe(false); // not for yourself
    s = play(s, { kind: 'away' }, 'b');
    expect(s.players[0].sitOut).toBe(true);
    expect(s.lastMove.by).toBe('b');
    expect(s.lastMove.seat).toBe(0);
    expect(s.cells[60]).toBe('0'); // the middle of an empty 11x11
    s = play(s, { kind: 'paw', cell: autoCell(s) }, 'b');
    s = play(s, { kind: 'paw', cell: autoCell(s) }, 'a');
    expect(s.players[0].sitOut).toBe(false);
  });

  test('autoCell finishes a line, else blocks one', () => {
    let s = make();
    s = playAll(s, [0, 110, 1, 111, 2, 112, 3]);
    // b to play: a threatens 4; b's own four is not there yet, so block.
    expect(autoCell(s)).toBe(4);
    s = playAll(s, [113]); // b ignores it
    // a to play: win at 4.
    expect(autoCell(s)).toBe(4);
  });

  test('rematch only after the game, and the next seat starts', () => {
    let s = make();
    expect(applyMove(s, { kind: 'rematch' }, 'a').ok).toBe(false);
    s = playAll(s, [0, 11, 1, 12, 2, 13, 3, 14, 4]);
    s = play(s, { kind: 'rematch' }, 'b');
    expect(s.phase).toBe('playing');
    expect(s.toAct).toBe(1);
    expect(s.gameNo).toBe(2);
    expect(s.cells).toBe('.'.repeat(121));
    expect(normalize(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('normalize', () => {
  test('round-trips through JSON, including pruned nulls', () => {
    let s = make();
    s = playAll(s, [5]);
    expect(normalize(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const over = playAll(make(), [0, 11, 1, 12, 2, 13, 3, 14, 4]);
    const pruned = JSON.parse(JSON.stringify(over));
    delete pruned.toAct;
    expect(normalize(pruned)).toEqual(over);
    // A start state has no cell; the wire drops the null.
    const fresh = JSON.parse(JSON.stringify(make()));
    delete fresh.lastMove.cell;
    expect(normalize(fresh)).toEqual(make());
  });

  test('rejects forged boards, bad marks, the wrong seat on turn and play after a win', () => {
    const s = playAll(make(), [5]);
    expect(normalize({ ...s, cells: '00' + s.cells.slice(2) })).toBeNull(); // two paws for a, none for b
    expect(normalize({ ...s, cells: '3' + s.cells.slice(1) })).toBeNull(); // no seat 3
    expect(normalize({ ...s, toAct: 0 })).toBeNull();
    expect(normalize({ ...s, phase: 'gameover' })).toBeNull();
    expect(normalize({ ...s, cells: s.cells.slice(1) })).toBeNull();
    expect(normalize({ ...s, config: { size: 99 } })).toBeNull();
    expect(normalize({ ...s, players: { 0: s.players[0], 1: s.players[1] } })).not.toBeNull();

    const won = playAll(make(), [0, 11, 1, 12, 2, 13, 3, 14, 4]);
    // b kept playing after a's line.
    const cells = won.cells.slice(0, 15) + '1' + won.cells.slice(16);
    expect(normalize({ ...won, cells, toAct: 0 })).toBeNull();
    expect(normalize({ ...won, cells })).toBeNull();
    // The line must run through the point played last.
    expect(normalize({ ...won, lastMove: { ...won.lastMove, cell: 14 } })).toBeNull();
    // ...and belong to whoever played last.
    expect(normalize({ ...won, starter: 1 })).toBeNull();
  });
});

describe('fuzz', () => {
  test('random games end in a win for the last player or a full board, and always normalize', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let g = 0; g < 120; g++) {
      const n = 2 + (g % 3);
      let s = createGame({
        players: Array.from({ length: n }, (_, i) => ({ uid: `p${i}`, name: `P${i}`, isHuman: true })),
        size: 7 + (g % 3) * 2,
        by: 'p0',
      });
      if (g % 2) s = play(s, { kind: 'away' }, s.players[1].uid);
      while (s.phase === 'playing') {
        const free = [...s.cells].flatMap((ch, c) => (ch === '.' ? [c] : []));
        s = play(s, { kind: 'paw', cell: free[Math.floor(rng() * free.length)] }, s.turnUid);
        expect(normalize(JSON.parse(JSON.stringify(s)))).toEqual(s);
      }
      const w = winner(s);
      if (w === null) expect(s.cells.includes('.')).toBe(false);
      else expect(w).toBe(s.lastMove.seat);
      expect(pawCounts(s).reduce((x, y) => x + y, 0)).toBe([...s.cells].filter((c) => c !== '.').length);
    }
  });
});
