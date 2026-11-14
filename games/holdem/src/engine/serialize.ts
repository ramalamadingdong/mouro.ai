/**
 * `normalize(raw)`: rebuild a trustworthy GameState from whatever came off the
 * wire (or out of localStorage), or return null.
 *
 * The realtime database does three things to a state in transit, all
 * inherited from the Firebase RTDB data model it mirrors:
 *   - null values are pruned  → `result`, `winner`, `toAct`, `lastAction`
 *     and the empty seats of `result.hands` simply vanish;
 *   - empty collections are pruned → `board: []` and a folded-out `hole: []`
 *     vanish too;
 *   - an array with holes arrives as an integer-keyed OBJECT.
 * So every collection here is read BY EXPLICIT INDEX, never by key order —
 * compacting a sparse seat-indexed node would slide one player's cards onto
 * another's seat.
 *
 * It is also the only cheat DETECTION the product has. The server enforces
 * who may write, not what; a state that conjures chips or duplicates a card
 * is rejected here by every other client.
 */
import {
  ANY_PLAYER,
  RULES,
  type Card,
  type GameState,
  type HandResult,
  type LastAction,
  type LastMove,
  type Phase,
  type PlayerState,
  type PotResult,
  type ShownHand,
} from './types';

const PHASES: readonly Phase[] = ['idle', 'preflop', 'flop', 'turn', 'river', 'showdown', 'gameover'];
const ACTION_KINDS: readonly LastAction['kind'][] = ['sb', 'bb', 'fold', 'check', 'call', 'bet', 'raise', 'allin'];
const MOVE_KINDS: readonly LastMove['kind'][] = ['deal', 'next', 'rematch', 'fold', 'check', 'call', 'raise', 'away'];
const MAX_NAME = 24;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/** Thrown internally to bail out of a deep decode; never escapes `normalize`. */
class Malformed extends Error {}
const bad = (what: string): never => {
  throw new Malformed(what);
};

/** A whole number in [lo, hi]. */
function int(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) bad(what);
  return v as number;
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') bad(what);
  return v as boolean;
}

function str(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) bad(what);
  return v as string;
}

/**
 * Read `length` slots by explicit index from an array or an integer-keyed
 * object. A missing container is an all-missing collection (it was pruned).
 */
function slots(v: unknown, length: number): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < length; i++) out.push(isObj(v) ? ((v as Obj)[i] ?? null) : null);
  return out;
}

/** A dense list: every index 0..n-1 present, nothing beyond. */
function list(v: unknown, max: number, what: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!isObj(v)) bad(what);
  const n = Object.keys(v as Obj).length;
  if (n > max) bad(what);
  const out = slots(v, n);
  if (out.some((x) => x === null)) bad(what);
  return out;
}

const MAX_CHIPS = 10_000_000;
const chips = (v: unknown, what: string): number => int(v, 0, MAX_CHIPS, what);
const cards = (v: unknown, max: number, what: string): Card[] => list(v, max, what).map((c) => int(c, 0, 51, what));

function decodePlayer(v: unknown): PlayerState {
  if (!isObj(v)) return bad('player');
  let lastAction: LastAction | null = null;
  if (isObj(v.lastAction)) {
    const kind = v.lastAction.kind as LastAction['kind'];
    if (!ACTION_KINDS.includes(kind)) bad('lastAction');
    lastAction = { kind, amount: chips(v.lastAction.amount, 'lastAction') };
  }
  return {
    uid: str(v.uid, 128, 'uid'),
    name: str(v.name, MAX_NAME, 'name'),
    isHuman: bool(v.isHuman, 'isHuman'),
    stack: chips(v.stack, 'stack'),
    bet: chips(v.bet, 'bet'),
    committed: chips(v.committed, 'committed'),
    hole: cards(v.hole, 2, 'hole'),
    inHand: bool(v.inHand, 'inHand'),
    folded: bool(v.folded, 'folded'),
    allIn: bool(v.allIn, 'allIn'),
    acted: bool(v.acted, 'acted'),
    sitOut: bool(v.sitOut, 'sitOut'),
    lastAction,
  };
}

function decodeResult(v: unknown, seats: number): HandResult {
  if (!isObj(v)) return bad('result');
  const seat = (x: unknown): number => int(x, 0, seats - 1, 'seat');
  const pots: PotResult[] = list(v.pots, seats, 'pots').map((raw) => {
    if (!isObj(raw)) return bad('pot');
    return {
      amount: chips(raw.amount, 'pot'),
      eligible: list(raw.eligible, seats, 'eligible').map(seat),
      winners: list(raw.winners, seats, 'winners').map(seat),
      payouts: list(raw.payouts, seats, 'payouts').map((p) => {
        if (!isObj(p)) return bad('payout');
        return { seat: seat(p.seat), amount: chips(p.amount, 'payout') };
      }),
    };
  });
  // Seat-indexed and sparse: folded seats are null, which the wire prunes.
  const hands: (ShownHand | null)[] = slots(v.hands, seats).map((raw) => {
    if (!isObj(raw)) return null;
    return {
      category: int(raw.category, 0, 8, 'category'),
      name: str(raw.name, 60, 'hand name'),
      score: int(raw.score, 0, 9 * 13 ** 5, 'score'),
      best5: cards(raw.best5, 5, 'best5'),
    };
  });
  return {
    showdown: bool(v.showdown, 'showdown'),
    pots,
    hands,
    // 0 is a real value here ("won nothing"), never a missing one.
    won: slots(v.won, seats).map((x) => chips(x, 'won')),
  };
}

function decode(raw: unknown): GameState {
  if (!isObj(raw)) return bad('state');

  const seatCount = isObj(raw.players) ? Object.keys(raw.players).length : 0;
  if (seatCount < RULES.MIN_PLAYERS || seatCount > RULES.MAX_PLAYERS) bad('players');
  const players = slots(raw.players, seatCount).map(decodePlayer);
  if (new Set(players.map((p) => p.uid)).size !== seatCount) bad('duplicate uid');

  if (!isObj(raw.config)) bad('config');
  const cfg = raw.config as Obj;
  const config = {
    startingStack: int(cfg.startingStack, 1, MAX_CHIPS / RULES.MAX_PLAYERS, 'startingStack'),
    baseBigBlind: int(cfg.baseBigBlind, 2, MAX_CHIPS, 'baseBigBlind'),
    blindUpEvery: int(cfg.blindUpEvery, 1, 1000, 'blindUpEvery'),
  };

  const phase = raw.phase as Phase;
  if (!PHASES.includes(phase)) bad('phase');

  // `toAct: 0` is seat 0, not "nobody" — hence the explicit null/undefined test.
  const toAct = raw.toAct === undefined || raw.toAct === null ? null : int(raw.toAct, 0, seatCount - 1, 'toAct');
  const turnUid = toAct === null ? ANY_PLAYER : players[toAct].uid;
  if (raw.turnUid !== turnUid) bad('turnUid');

  let lastMove: LastMove | null = null;
  if (isObj(raw.lastMove)) {
    const kind = raw.lastMove.kind as LastMove['kind'];
    if (!MOVE_KINDS.includes(kind)) bad('lastMove');
    lastMove = { by: str(raw.lastMove.by, 128, 'lastMove.by'), kind, seat: int(raw.lastMove.seat, 0, seatCount - 1, 'lastMove.seat') };
  }

  const state: GameState = {
    version: int(raw.version, 0, 1_000_000, 'version'),
    config,
    players,
    phase,
    handNo: int(raw.handNo, 0, 100_000, 'handNo'),
    button: int(raw.button, 0, seatCount - 1, 'button'),
    smallBlind: chips(raw.smallBlind, 'smallBlind'),
    bigBlind: chips(raw.bigBlind, 'bigBlind'),
    deck: cards(raw.deck, 52, 'deck'),
    board: cards(raw.board, 5, 'board'),
    currentBet: chips(raw.currentBet, 'currentBet'),
    minRaise: chips(raw.minRaise, 'minRaise'),
    toAct,
    turnUid,
    result: raw.result === undefined || raw.result === null ? null : decodeResult(raw.result, seatCount),
    winner: raw.winner === undefined || raw.winner === null ? null : int(raw.winner, 0, seatCount - 1, 'winner'),
    lastMove,
  };

  // ── Integrity: what a modified client would have to break to cheat ───────
  // Chips are conserved for the whole game.
  const total = players.reduce((sum, p) => sum + p.stack + p.committed, 0);
  if (total !== seatCount * config.startingStack) bad('chips not conserved');
  // Once a hand has been dealt, the 52 cards are all accounted for, once each.
  if (state.handNo > 0) {
    const seen = [...state.deck, ...state.board, ...players.flatMap((p) => p.hole)];
    if (seen.length !== 52 || new Set(seen).size !== 52) bad('cards');
  }
  if ((phase === 'showdown') !== (state.result !== null) && phase !== 'gameover') bad('result/phase');

  return state;
}

export function normalize(raw: unknown): GameState | null {
  try {
    return decode(raw);
  } catch (err) {
    if (err instanceof Malformed) return null;
    throw err;
  }
}
