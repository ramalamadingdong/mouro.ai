/**
 * `normalize(raw)` turns whatever came off the wire or out of localStorage
 * into a GameState, or null if it is not one. ALWAYS run a state through it
 * before use.
 *
 * It is also the only cheat detection there is (the server checks who may
 * write, never what). A state is refused if a floor holds a cat that pokes
 * over the wall or overlaps another, if a player has seated more cats than
 * they have had turns, if the door holds the wrong number of cats for this
 * point in the round, or if the phase or turn disagree with the pick count.
 */
import { marketSize, seatOnTurn, totalPicks, turnsTaken } from './reducer';
import { EMPTY_SLOT, TILE_RE, parseFloor } from './tiles';
import { ANY_PLAYER, RULES, type GameState, type LastMove, type MoveKind, type Player } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const KINDS: readonly MoveKind[] = ['start', 'seat', 'pass', 'away', 'rematch'];

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
  const { version, market, picks, phase, starter, gameNo, lastMove } = raw;
  if (!isInt(version) || version < 1) return null;

  const list = asList(raw.players);
  if (!list || list.length < RULES.MIN_PLAYERS || list.length > RULES.MAX_PLAYERS) return null;
  const players: Player[] = [];
  for (const p of list) {
    const ok = player(p);
    if (!ok) return null;
    players.push(ok);
  }
  const n = players.length;

  if (!isInt(starter) || starter < 0 || starter >= n) return null;
  if (!isInt(gameNo) || gameNo < 1) return null;
  if (!isInt(picks) || picks < 0 || picks > totalPicks(n)) return null;
  const over = picks === totalPicks(n);
  if (phase !== (over ? 'gameover' : 'playing')) return null;

  // The door: the right number of slots, each a tile or empty, and exactly as
  // many empty as there have been picks this round (all of a round's picks
  // once the game is over, since nothing refills the last one).
  if (typeof market !== 'string' || market.length !== marketSize(n) * 2) return null;
  let empty = 0;
  for (let i = 0; i < market.length; i += 2) {
    const slot = market.slice(i, i + 2);
    if (slot === EMPTY_SLOT) empty++;
    else if (!TILE_RE.test(slot)) return null;
  }
  if (empty !== (over ? n : picks % n)) return null;

  // Floors. A floor with no cats yet is an empty string, which the database
  // may hand back as a missing entry — read both as empty.
  const rawFloors = Array.isArray(raw.floors) ? raw.floors : isObj(raw.floors) ? raw.floors : {};
  const floors: string[] = [];
  for (let seat = 0; seat < n; seat++) {
    const f = (rawFloors as Record<number, unknown>)[seat] ?? '';
    if (typeof f !== 'string') return null;
    const cats = parseFloor(f);
    if (!cats || cats.length > turnsTaken(picks, n, starter, seat)) return null;
    floors.push(f);
  }

  if (!isObj(lastMove)) return null;
  const kind = lastMove.kind as MoveKind;
  const by = lastMove.by;
  const seat = lastMove.seat;
  if (typeof by !== 'string' || !KINDS.includes(kind) || !isInt(seat) || seat < 0 || seat >= n) return null;
  const move: LastMove = {
    by,
    kind,
    seat,
    tile: typeof lastMove.tile === 'string' && TILE_RE.test(lastMove.tile) ? lastMove.tile : null,
    cat: typeof lastMove.cat === 'string' && lastMove.cat.length === 5 ? lastMove.cat : null,
  };

  const toAct = seatOnTurn(picks, n, starter);
  return {
    version,
    players,
    market,
    floors,
    picks,
    phase: over ? 'gameover' : 'playing',
    toAct,
    turnUid: toAct === null ? ANY_PLAYER : players[toAct].uid,
    starter,
    gameNo,
    lastMove: move,
  };
}
