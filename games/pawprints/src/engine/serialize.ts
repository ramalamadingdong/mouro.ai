/**
 * `normalize(raw)` turns whatever came off the wire or out of localStorage
 * into a GameState, or null if it is not one. ALWAYS run a state through it
 * before use.
 *
 * It is also the only cheat detection there is (the server checks who may
 * write, never what). Because players strictly alternate and nobody ever
 * passes, the board alone says whose turn it is: the paw counts must step
 * down by at most one in turn order from the starter, the seat on turn must
 * be the next in that order, a finished line must belong to whoever played
 * last and pass through the last point played, and nobody may have played
 * after a line was made. A state that breaks any of that is refused.
 */
import { allRuns } from './grid';
import { ANY_PLAYER, EMPTY, RULES, needFor, type GameState, type LastMove, type MoveKind, type Player } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const KINDS: readonly MoveKind[] = ['start', 'paw', 'away', 'rematch'];

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
  const { version, config, cells, phase, starter, gameNo, lastMove } = raw;
  if (!isInt(version) || version < 1 || !isObj(config)) return null;
  const size = config.size;
  if (!isInt(size) || size < RULES.MIN_SIZE || size > RULES.MAX_SIZE) return null;

  const list = asList(raw.players);
  if (!list || list.length < 1 || list.length > RULES.MAX_PLAYERS) return null;
  const players: Player[] = [];
  for (const p of list) {
    const ok = player(p);
    if (!ok) return null;
    players.push(ok);
  }
  const n = players.length;

  if (typeof cells !== 'string' || cells.length !== size * size) return null;
  if (!new RegExp(`^[.0-${n - 1}]*$`).test(cells)) return null;
  if (!isInt(starter) || starter < 0 || starter >= n) return null;
  if (!isInt(gameNo) || gameNo < 1) return null;

  // Turn order: the i-th seat after the starter has had ceil((T - i) / n) turns.
  const counts = players.map(() => 0);
  let total = 0;
  for (const ch of cells) {
    if (ch === EMPTY) continue;
    counts[Number(ch)] += 1;
    total += 1;
  }
  for (let i = 0; i < n; i++) {
    if (counts[(starter + i) % n] !== Math.floor((total - i + n - 1) / n)) return null;
  }

  if (!isObj(lastMove)) return null;
  const kind = lastMove.kind as MoveKind;
  const by = lastMove.by;
  const seat = lastMove.seat;
  if (typeof by !== 'string' || !KINDS.includes(kind) || !isInt(seat) || seat < 0 || seat >= n) return null;
  const cell = isInt(lastMove.cell) && lastMove.cell >= 0 && lastMove.cell < cells.length ? lastMove.cell : null;
  const move: LastMove = { by, kind, seat, cell };

  const runs = allRuns(cells, size, needFor(n));
  const lastSeat = total > 0 ? (starter + total - 1) % n : -1;
  let over: boolean;
  if (runs.length > 0) {
    if (runs.some((r) => r.mark !== String(lastSeat))) return null;
    if (cell === null || !runs.some((r) => r.run.includes(cell))) return null;
    over = true;
  } else {
    over = !cells.includes(EMPTY);
  }
  if (phase !== (over ? 'gameover' : 'playing')) return null;

  const toAct = raw.toAct ?? null;
  if (over) {
    if (toAct !== null) return null;
  } else if (toAct !== (starter + total) % n) {
    return null;
  }

  return {
    version,
    config: { size },
    players,
    cells,
    phase: over ? 'gameover' : 'playing',
    toAct: toAct as number | null,
    turnUid: toAct === null ? ANY_PLAYER : players[toAct as number].uid,
    starter,
    gameNo,
    lastMove: move,
  };
}
