/**
 * `normalize(raw)`: rebuild a trustworthy GameState from whatever came off the
 * wire (or out of localStorage), or return null.
 *
 * The realtime database does three things to a state in transit, all
 * inherited from the Firebase RTDB data model it mirrors:
 *   - null values are pruned  → `result`, `winner`, `toAct`, `lastAction`
 *     and a hand's `outcome` simply vanish;
 *   - empty collections are pruned → `hands: []`, `dealer: []` and a fresh
 *     bet's `cards: []` vanish too;
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
  SHOE_SIZE,
  type Card,
  type GameState,
  type Hand,
  type LastAction,
  type LastMove,
  type Outcome,
  type Phase,
  type PlayerState,
  type RoundResult,
} from './types';

const PHASES: readonly Phase[] = ['idle', 'betting', 'playing', 'dealer', 'settled', 'gameover'];
const ACTION_KINDS: readonly LastAction['kind'][] = [
  'bet',
  'sitout',
  'tip',
  'hit',
  'stand',
  'double',
  'split',
  'surrender',
  'blackjack',
  'bust',
];
const MOVE_KINDS: readonly LastMove['kind'][] = [
  'deal',
  'next',
  'rematch',
  'bet',
  'tip',
  'hit',
  'stand',
  'double',
  'split',
  'surrender',
  'away',
];
const OUTCOMES: readonly Outcome[] = ['blackjack', 'win', 'push', 'lose', 'bust', 'surrender'];
const MAX_NAME = 24;
/** Most cards one hand can hold without busting (four Aces, four Twos, three Threes). */
const MAX_HAND_CARDS = 11;

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
const cards = (v: unknown, max: number, what: string): Card[] =>
  list(v, max, what).map((c) => int(c, 0, SHOE_SIZE - 1, what));

function decodeHand(v: unknown): Hand {
  if (!isObj(v)) return bad('hand');
  let outcome: Outcome | null = null;
  if (v.outcome !== undefined && v.outcome !== null) {
    outcome = v.outcome as Outcome;
    if (!OUTCOMES.includes(outcome)) bad('outcome');
  }
  return {
    cards: cards(v.cards, MAX_HAND_CARDS, 'cards'),
    bet: chips(v.bet, 'hand bet'),
    done: bool(v.done, 'done'),
    doubled: bool(v.doubled, 'doubled'),
    split: bool(v.split, 'split'),
    outcome,
    paid: chips(v.paid, 'paid'),
  };
}

function decodePlayer(v: unknown): PlayerState {
  if (!isObj(v)) return bad('player');
  let lastAction: LastAction | null = null;
  if (isObj(v.lastAction)) {
    const kind = v.lastAction.kind as LastAction['kind'];
    if (!ACTION_KINDS.includes(kind)) bad('lastAction');
    lastAction = { kind, amount: chips(v.lastAction.amount, 'lastAction') };
  }
  const hands = list(v.hands, RULES.MAX_HANDS, 'hands').map(decodeHand);
  const active = int(v.active, 0, RULES.MAX_HANDS - 1, 'active');
  if (hands.length > 0 && active >= hands.length) bad('active');
  return {
    uid: str(v.uid, 128, 'uid'),
    name: str(v.name, MAX_NAME, 'name'),
    isHuman: bool(v.isHuman, 'isHuman'),
    stack: chips(v.stack, 'stack'),
    hands,
    active,
    // Absent in states written before tipping existed.
    tipped: v.tipped === undefined ? 0 : chips(v.tipped, 'tipped'),
    sitOut: bool(v.sitOut, 'sitOut'),
    lastAction,
  };
}

function decodeResult(v: unknown, seats: number): RoundResult {
  if (!isObj(v)) return bad('result');
  return {
    dealerTotal: int(v.dealerTotal, 0, 31, 'dealerTotal'),
    dealerBlackjack: bool(v.dealerBlackjack, 'dealerBlackjack'),
    // 0 is a real value here ("broke even"), never a missing one.
    net: slots(v.net, seats).map((x) => int(x, -MAX_CHIPS, MAX_CHIPS, 'net')),
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
    minBet: int(cfg.minBet, RULES.BET_STEP, MAX_CHIPS, 'minBet'),
    maxBet: int(cfg.maxBet, RULES.BET_STEP, MAX_CHIPS, 'maxBet'),
    rounds: int(cfg.rounds, 1, 1000, 'rounds'),
    // Absent in games started before dealers could be chosen: Duchess.
    dealer: typeof cfg.dealer === 'string' && /^[a-z0-9]{1,20}$/.test(cfg.dealer) ? cfg.dealer : 'duchess',
  };
  if (config.minBet % RULES.BET_STEP !== 0 || config.maxBet % RULES.BET_STEP !== 0) bad('bet step');

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
    shoe: cards(raw.shoe, SHOE_SIZE, 'shoe'),
    dealer: cards(raw.dealer, MAX_HAND_CARDS, 'dealer'),
    house: int(raw.house, -MAX_CHIPS, MAX_CHIPS, 'house'),
    toAct,
    turnUid,
    result: raw.result === undefined || raw.result === null ? null : decodeResult(raw.result, seatCount),
    winner: raw.winner === undefined || raw.winner === null ? null : int(raw.winner, 0, seatCount - 1, 'winner'),
    lastMove,
  };

  // ── Integrity: what a modified client would have to break to cheat ───────
  // Chips are conserved for the whole game, the house's bank included.
  const inPlay = state.result === null ? players.reduce((s, p) => s + p.hands.reduce((t, h) => t + h.bet, 0), 0) : 0;
  const total = players.reduce((sum, p) => sum + p.stack, 0) + inPlay + state.house;
  if (total !== seatCount * config.startingStack) bad('chips not conserved');
  // No physical card is in two places at once.
  const seen = [...state.shoe, ...state.dealer, ...players.flatMap((p) => p.hands.flatMap((h) => h.cards))];
  if (new Set(seen).size !== seen.length) bad('cards');
  if (state.handNo > 0 && phase !== 'gameover' && state.shoe.length === 0 && seen.length === 0) bad('shoe');
  if ((phase === 'settled') !== (state.result !== null) && phase !== 'gameover') bad('result/phase');

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
