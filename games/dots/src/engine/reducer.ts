/**
 * The rules of Dots and Boxes, as one pure reducer.
 *
 * `applyMove(state, move, uid)` never throws and never mutates. The sender's
 * uid is an argument, not part of the move, so a payload cannot lie about who
 * sent it. Every success path ends at `commit`, which bumps `version`,
 * re-derives `turnUid` and stamps `lastMove` — the three things the database
 * rules read.
 *
 * Rules: players take turns drawing one line between two neighbouring dots.
 * Closing the fourth side of a box claims it AND earns another line; a line
 * that closes nothing passes the turn on. When every box is claimed the most
 * boxes wins (ties are shared). There is no randomness anywhere.
 */
import { boxCount, boxEdges, edgeBoxes, edgeCount, type Size } from './board';
import {
  ANY_PLAYER,
  EMPTY,
  RULES,
  type ApplyResult,
  type GameState,
  type LastMove,
  type Move,
  type Player,
} from './types';

export interface NewGame {
  players: { uid: string; name: string; isHuman: boolean }[];
  cols: number;
  rows: number;
  /** uid of whoever starts the game (the host online, the human offline). */
  by: string;
}

function clampSize(n: number): number {
  return Math.min(RULES.MAX_SIZE, Math.max(RULES.MIN_SIZE, Math.round(n)));
}

/** A fresh game, seat 0 to draw first. */
export function createGame(options: NewGame): GameState {
  const config = { cols: clampSize(options.cols), rows: clampSize(options.rows) };
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
    edges: EMPTY.repeat(edgeCount(config)),
    boxes: EMPTY.repeat(boxCount(config)),
    phase: 'playing',
    toAct: 0,
    turnUid: players[0]?.uid ?? ANY_PLAYER,
    starter: 0,
    gameNo: 1,
    lastMove: { by: options.by, kind: 'start', seat: 0, edge: null, closed: 0 },
  };
}

export function scores(state: GameState): number[] {
  const out = state.players.map(() => 0);
  for (const ch of state.boxes) if (ch !== EMPTY) out[Number(ch)] += 1;
  return out;
}

/** Seats with the top score. Several when tied. Meaningful once the game is over. */
export function winners(state: GameState): number[] {
  const s = scores(state);
  const best = Math.max(...s);
  return s.flatMap((n, seat) => (n === best ? [seat] : []));
}

export function isLegalEdge(state: GameState, edge: number): boolean {
  return Number.isInteger(edge) && edge >= 0 && edge < state.edges.length && state.edges[edge] === EMPTY;
}

/** Boxes that drawing `edge` on this edge-string would close. */
export function boxesClosedBy(size: Size, edges: string, edge: number): number[] {
  return edgeBoxes(size, edge).filter((b) => boxEdges(size, b).every((e) => e === edge || edges[e] !== EMPTY));
}

/**
 * The line the table draws for a player who is away. Deterministic, so every
 * client that races to send it would draw the same one: close a box if one
 * can be closed, else the first line that gives nothing away, else the first
 * free line.
 */
export function autoEdge(state: GameState): number {
  const size = state.config;
  let firstSafe = -1;
  let firstAny = -1;
  for (let e = 0; e < state.edges.length; e++) {
    if (state.edges[e] !== EMPTY) continue;
    if (firstAny < 0) firstAny = e;
    if (boxesClosedBy(size, state.edges, e).length > 0) return e;
    if (firstSafe < 0) {
      const givesAway = edgeBoxes(size, e).some(
        (b) => boxEdges(size, b).filter((x) => x !== e && state.edges[x] !== EMPTY).length === 2,
      );
      if (!givesAway) firstSafe = e;
    }
  }
  return firstSafe >= 0 ? firstSafe : firstAny;
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

/** Draw `edge` for the player on turn. Shared by `line` and `away`. */
function draw(state: GameState, edge: number, by: string, kind: 'line' | 'away'): ApplyResult {
  const seat = state.toAct;
  if (state.phase !== 'playing' || seat === null) return { ok: false, error: 'The game is over.' };
  if (!isLegalEdge(state, edge)) return { ok: false, error: 'That line has already been drawn.' };

  const mark = String(seat);
  const closed = boxesClosedBy(state.config, state.edges, edge);
  let boxes = state.boxes;
  for (const b of closed) boxes = replaceAt(boxes, b, mark);
  const edges = replaceAt(state.edges, edge, mark);
  const done = !boxes.includes(EMPTY);

  const players = state.players.map((p, i) =>
    i === seat ? { ...p, sitOut: kind === 'away' ? true : false } : p,
  );
  // Closing a box earns another line; otherwise the turn passes to the left.
  const next = done ? null : closed.length > 0 ? seat : (seat + 1) % state.players.length;

  return {
    ok: true,
    state: commit({ ...state, players, edges, boxes, phase: done ? 'gameover' : 'playing', toAct: next }, by, {
      kind,
      seat,
      edge,
      closed: closed.length,
    }),
  };
}

export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const seatOfSender = state.players.findIndex((p) => p.uid === uid);
  if (seatOfSender < 0) return { ok: false, error: 'You are not playing in this game.' };

  switch (move.kind) {
    case 'line':
      if (state.toAct !== seatOfSender) return { ok: false, error: 'It is not your turn.' };
      return draw(state, move.edge, uid, 'line');

    case 'away':
      // Who may act for an absent player is the database rules' call (they
      // can see presence; the engine cannot). The engine only refuses the
      // nonsensical case of moving "for" yourself.
      if (state.toAct === null) return { ok: false, error: 'The game is over.' };
      if (state.toAct === seatOfSender) return { ok: false, error: 'It is your own turn.' };
      return draw(state, autoEdge(state), uid, 'away');

    case 'rematch': {
      if (state.phase !== 'gameover') return { ok: false, error: 'Finish this game first.' };
      const starter = (state.starter + 1) % state.players.length;
      return {
        ok: true,
        state: commit(
          {
            ...state,
            edges: EMPTY.repeat(state.edges.length),
            boxes: EMPTY.repeat(state.boxes.length),
            phase: 'playing',
            toAct: starter,
            starter,
            gameNo: state.gameNo + 1,
            players: state.players.map((p) => ({ ...p, sitOut: false })),
          },
          uid,
          { kind: 'rematch', seat: starter, edge: null, closed: 0 },
        ),
      };
    }

    default:
      return { ok: false, error: 'Unknown move.' };
  }
}
