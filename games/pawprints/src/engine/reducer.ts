/**
 * The rules of Pawprints (five in a row, on a quilt), as one pure reducer.
 *
 * `applyMove(state, move, uid)` never throws and never mutates. The sender's
 * uid is an argument, not part of the move, so a payload cannot lie about who
 * sent it. Every success path ends at `commit`, which bumps `version`,
 * re-derives `turnUid` and stamps `lastMove` — the three things the database
 * rules read.
 *
 * Rules: players take turns leaving one paw print on an empty point. The
 * first to make an unbroken line of `needFor(players)` of their own paws —
 * across, down or diagonally — wins; a longer line counts too. If the board
 * fills first, the game is a draw. There is no randomness anywhere.
 */
import { winningRun, allRuns } from './grid';
import { candidates, cellScore, centrality, wins } from './threat';
import {
  ANY_PLAYER,
  EMPTY,
  RULES,
  needFor,
  type ApplyResult,
  type GameState,
  type LastMove,
  type Move,
  type Player,
} from './types';

export interface NewGame {
  players: { uid: string; name: string; isHuman: boolean }[];
  size: number;
  /** uid of whoever starts the game (the host online, the human offline). */
  by: string;
}

function clampSize(n: number): number {
  return Math.min(RULES.MAX_SIZE, Math.max(RULES.MIN_SIZE, Math.round(n)));
}

/** A fresh game, seat 0 to play first. */
export function createGame(options: NewGame): GameState {
  const config = { size: clampSize(options.size) };
  const players: Player[] = options.players.slice(0, RULES.MAX_PLAYERS).map((p) => ({
    uid: p.uid,
    name: Array.from(p.name.trim() || 'Player')
      .slice(0, 24)
      .join(''),
    isHuman: p.isHuman,
    sitOut: false,
  }));
  return {
    version: 1,
    config,
    players,
    cells: EMPTY.repeat(config.size * config.size),
    phase: 'playing',
    toAct: 0,
    turnUid: players[0]?.uid ?? ANY_PLAYER,
    starter: 0,
    gameNo: 1,
    lastMove: { by: options.by, kind: 'start', seat: 0, cell: null },
  };
}

/** The paws in a row this game needs. */
export function need(state: GameState): number {
  return needFor(state.players.length);
}

/** The winning line, or null (still playing, or a draw). */
export function winningLine(state: GameState): number[] | null {
  if (state.phase !== 'gameover') return null;
  const last = state.lastMove.cell;
  if (last !== null && state.cells[last] !== EMPTY) {
    const run = winningRun(state.cells, state.config.size, last, state.cells[last], need(state));
    if (run) return run;
  }
  return allRuns(state.cells, state.config.size, need(state))[0]?.run ?? null;
}

/** The seat that won, or null for a draw / a game still going. */
export function winner(state: GameState): number | null {
  const line = winningLine(state);
  return line ? Number(state.cells[line[0]]) : null;
}

/** Paws each seat has on the board. */
export function pawCounts(state: GameState): number[] {
  const out = state.players.map(() => 0);
  for (const ch of state.cells) if (ch !== EMPTY) out[Number(ch)] += 1;
  return out;
}

export function isLegalCell(state: GameState, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < state.cells.length && state.cells[cell] === EMPTY;
}

/**
 * The point the table plays for a player who is away. Deterministic, so every
 * client that races to send it would play the same one: finish a line if
 * possible, else block the next player's line, else the best-scoring point
 * (nearest the middle, then lowest, on a tie).
 */
export function autoCell(state: GameState): number {
  const seat = state.toAct ?? 0;
  const size = state.config.size;
  const n = state.players.length;
  const k = need(state);
  const list = candidates(state.cells, size);
  const mine = list.find((c) => wins(state.cells, size, c, String(seat), k));
  if (mine !== undefined) return mine;
  for (let step = 1; step < n; step++) {
    const other = String((seat + step) % n);
    const block = list.find((c) => wins(state.cells, size, c, other, k));
    if (block !== undefined) return block;
  }
  let best = list[0];
  let bestScore = -Infinity;
  for (const c of list) {
    const s = cellScore(state.cells, size, c, seat, n, k);
    if (s > bestScore || (s === bestScore && centrality(size, c) < centrality(size, best))) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

function replaceAt(s: string, i: number, ch: string): string {
  return s.slice(0, i) + ch + s.slice(i + 1);
}

function commit(state: GameState, by: string, lastMove: Omit<LastMove, 'by'>): GameState {
  const toAct = state.phase === 'playing' ? state.toAct : null;
  return {
    ...state,
    toAct,
    turnUid: toAct === null ? ANY_PLAYER : state.players[toAct].uid,
    version: state.version + 1,
    lastMove: { by, ...lastMove },
  };
}

/** Play `cell` for the player on turn. Shared by `paw` and `away`. */
function place(state: GameState, cell: number, by: string, kind: 'paw' | 'away'): ApplyResult {
  const seat = state.toAct;
  if (state.phase !== 'playing' || seat === null) return { ok: false, error: 'The game is over.' };
  if (!isLegalCell(state, cell)) return { ok: false, error: 'There is already a paw there.' };

  const mark = String(seat);
  const cells = replaceAt(state.cells, cell, mark);
  const won = winningRun(cells, state.config.size, cell, mark, need(state)) !== null;
  const done = won || !cells.includes(EMPTY);

  const players = state.players.map((p, i) => (i === seat ? { ...p, sitOut: kind === 'away' } : p));
  const next = done ? null : (seat + 1) % state.players.length;

  return {
    ok: true,
    state: commit({ ...state, players, cells, phase: done ? 'gameover' : 'playing', toAct: next }, by, {
      kind,
      seat,
      cell,
    }),
  };
}

export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const seatOfSender = state.players.findIndex((p) => p.uid === uid);
  if (seatOfSender < 0) return { ok: false, error: 'You are not playing in this game.' };

  switch (move.kind) {
    case 'paw':
      if (state.toAct !== seatOfSender) return { ok: false, error: 'It is not your turn.' };
      return place(state, move.cell, uid, 'paw');

    case 'away':
      // Who may act for an absent player is the database rules' call (they
      // can see presence; the engine cannot). The engine only refuses the
      // nonsensical case of moving "for" yourself.
      if (state.toAct === null) return { ok: false, error: 'The game is over.' };
      if (state.toAct === seatOfSender) return { ok: false, error: 'It is your own turn.' };
      return place(state, autoCell(state), uid, 'away');

    case 'rematch': {
      if (state.phase !== 'gameover') return { ok: false, error: 'Finish this game first.' };
      const starter = (state.starter + 1) % state.players.length;
      return {
        ok: true,
        state: commit(
          {
            ...state,
            cells: EMPTY.repeat(state.cells.length),
            phase: 'playing',
            toAct: starter,
            starter,
            gameNo: state.gameNo + 1,
            players: state.players.map((p) => ({ ...p, sitOut: false })),
          },
          uid,
          { kind: 'rematch', seat: starter, cell: null },
        ),
      };
    }

    default:
      return { ok: false, error: 'Unknown move.' };
  }
}
