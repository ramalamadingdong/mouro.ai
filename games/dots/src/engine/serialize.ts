/**
 * `normalize(raw)` turns whatever came off the wire or out of localStorage
 * into a GameState, or null if it is not one. ALWAYS run a state through it
 * before use.
 *
 * It is also the only cheat detection there is (the server checks who may
 * write, never what): a state is refused if a box is claimed without all four
 * sides drawn, or a closed box is unclaimed, or a mark names a seat that does
 * not exist, or the phase disagrees with the board.
 */
import { boxCount, boxEdges, edgeCount } from './board';
import { ANY_PLAYER, EMPTY, RULES, type GameState, type LastMove, type MoveKind, type Player } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const KINDS: readonly MoveKind[] = ['start', 'line', 'away', 'rematch'];

/** Array, or the integer-keyed object a holed array becomes on the wire. */
function asList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!isObj(v)) return null;
  const out: unknown[] = [];
  for (let i = 0; i in v; i++) out.push(v[i]);
  return out.length === Object.keys(v).length ? out : null;
}

function player(v: unknown): Player | null {
  if (!isObj(v)) return null;
  const { uid, name, isHuman, sitOut } = v;
  if (typeof uid !== 'string' || uid.length === 0 || typeof name !== 'string' || typeof isHuman !== 'boolean') {
    return null;
  }
  return { uid, name, isHuman, sitOut: sitOut === true };
}

export function normalize(raw: unknown): GameState | null {
  if (!isObj(raw)) return null;
  const { version, config, edges, boxes, phase, starter, gameNo, lastMove } = raw;
  if (!isInt(version) || version < 1 || !isObj(config)) return null;
  const cols = config.cols;
  const rows = config.rows;
  if (!isInt(cols) || !isInt(rows)) return null;
  if (cols < RULES.MIN_SIZE || cols > RULES.MAX_SIZE || rows < RULES.MIN_SIZE || rows > RULES.MAX_SIZE) return null;
  const size = { cols, rows };

  const list = asList(raw.players);
  if (!list || list.length < 1 || list.length > RULES.MAX_PLAYERS) return null;
  const players: Player[] = [];
  for (const p of list) {
    const ok = player(p);
    if (!ok) return null;
    players.push(ok);
  }

  if (typeof edges !== 'string' || edges.length !== edgeCount(size)) return null;
  if (typeof boxes !== 'string' || boxes.length !== boxCount(size)) return null;
  const marks = new RegExp(`^[.0-${players.length - 1}]*$`);
  if (!marks.test(edges) || !marks.test(boxes)) return null;
  for (let b = 0; b < boxes.length; b++) {
    const closed = boxEdges(size, b).every((e) => edges[e] !== EMPTY);
    if (closed !== (boxes[b] !== EMPTY)) return null;
  }

  const full = !boxes.includes(EMPTY);
  if (phase !== (full ? 'gameover' : 'playing')) return null;
  const toAct = raw.toAct ?? null;
  if (full) {
    if (toAct !== null) return null;
  } else if (!isInt(toAct) || toAct < 0 || toAct >= players.length) {
    return null;
  }

  if (!isInt(starter) || starter < 0 || starter >= players.length) return null;
  if (!isInt(gameNo) || gameNo < 1) return null;
  if (!isObj(lastMove)) return null;
  const kind = lastMove.kind as MoveKind;
  const by = lastMove.by;
  const seat = lastMove.seat;
  if (typeof by !== 'string' || !KINDS.includes(kind) || !isInt(seat)) return null;
  const edge = isInt(lastMove.edge) ? lastMove.edge : null;
  const closed = isInt(lastMove.closed) ? lastMove.closed : 0;
  const move: LastMove = { by, kind, seat, edge, closed };

  return {
    version,
    config: size,
    players,
    edges,
    boxes,
    phase: full ? 'gameover' : 'playing',
    toAct: toAct as number | null,
    turnUid: toAct === null ? ANY_PLAYER : players[toAct as number].uid,
    starter,
    gameNo,
    lastMove: move,
  };
}
