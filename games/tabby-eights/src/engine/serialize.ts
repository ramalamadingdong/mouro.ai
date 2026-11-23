/**
 * `normalize(raw)` turns whatever came off the wire or out of localStorage
 * into a GameState, or null if it is not one. ALWAYS run a state through it
 * before use.
 *
 * It is also the only cheat detection there is (the server checks who may
 * write, never what): all 52 cards must be present exactly once across the
 * hands, the stock and the pile; the suit to follow must be the top card's
 * unless that card is an eight; a round being played must have nobody out,
 * a finished one must have somebody out or be blocked; scores must agree
 * with the phase and the target. A state that breaks any of that is refused.
 *
 * Realtime storage may drop an empty string (an empty hand, an empty stock)
 * entirely, so a missing one reads as ''.
 */
import { CARDS_RE, isSuit, isWild, split, suitOf } from './cards';
import { ANY_PLAYER, RULES, type GameState, type LastMove, type MoveKind, type Phase, type Player } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const KINDS: readonly MoveKind[] = ['start', 'play', 'draw', 'pass', 'away', 'deal', 'rematch'];
const PHASES: readonly Phase[] = ['playing', 'roundover', 'gameover'];

/** Array, or the integer-keyed object a holed array becomes on the wire. */
function asList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!isObj(v)) return null;
  const out: unknown[] = [];
  for (let i = 0; i in v; i++) out.push(v[i]);
  return out.length === Object.keys(v).length ? out : null;
}

const cards = (v: unknown): string | null => {
  const s = v === undefined || v === null ? '' : v;
  return typeof s === 'string' && s.length <= 104 && CARDS_RE.test(s) ? s : null;
};

function player(v: unknown): Player | null {
  if (!isObj(v)) return null;
  const { uid, name, isHuman, sitOut, score } = v;
  if (typeof uid !== 'string' || uid.length === 0 || typeof name !== 'string' || typeof isHuman !== 'boolean') {
    return null;
  }
  const hand = cards(v.hand);
  if (hand === null || !isInt(score) || score < 0 || score > 100_000) return null;
  return { uid, name, isHuman, sitOut: sitOut === true, hand, score };
}

export function normalize(raw: unknown): GameState | null {
  if (!isObj(raw)) return null;
  const { version, config, phase, starter, round, gameNo, lastMove, suit, drew, passes } = raw;
  if (!isInt(version) || version < 1 || !isObj(config)) return null;
  const target = config.target;
  if (!isInt(target) || target < RULES.MIN_TARGET || target > RULES.MAX_TARGET) return null;

  const list = asList(raw.players);
  if (!list || list.length < 1 || list.length > RULES.MAX_PLAYERS) return null;
  const players: Player[] = [];
  for (const p of list) {
    const ok = player(p);
    if (!ok) return null;
    players.push(ok);
  }
  const n = players.length;

  const stock = cards(raw.stock);
  const pile = cards(raw.pile);
  if (stock === null || pile === null || pile.length < 2) return null;

  // Every card exactly once.
  const seen = new Set<string>();
  for (const c of [...players.flatMap((p) => split(p.hand)), ...split(stock), ...split(pile)]) {
    if (seen.has(c)) return null;
    seen.add(c);
  }
  if (seen.size !== 52) return null;

  if (!isSuit(suit)) return null;
  const top = pile.slice(-2);
  if (!isWild(top) && suit !== suitOf(top)) return null;

  if (!PHASES.includes(phase as Phase)) return null;
  if (!isInt(starter) || starter < 0 || starter >= n) return null;
  if (!isInt(round) || round < 1 || !isInt(gameNo) || gameNo < 1) return null;
  if (typeof drew !== 'boolean' && drew !== undefined) return null;
  const passCount = passes ?? 0;
  if (!isInt(passCount) || passCount < 0 || passCount > n) return null;

  const someoneOut = players.some((p) => p.hand.length === 0);
  const reached = players.some((p) => p.score >= target);
  const toAct = raw.toAct ?? null;
  if (phase === 'playing') {
    if (someoneOut || reached) return null;
    if (!isInt(toAct) || toAct < 0 || toAct >= n) return null;
  } else {
    if (toAct !== null) return null;
    if (!someoneOut && drawableCount(stock, pile) > 0) return null;
    if ((phase === 'gameover') !== reached) return null;
  }

  if (!isObj(lastMove)) return null;
  const kind = lastMove.kind as MoveKind;
  const by = lastMove.by;
  const seat = lastMove.seat;
  if (typeof by !== 'string' || !KINDS.includes(kind) || !isInt(seat) || seat < 0 || seat >= n) return null;
  const card = typeof lastMove.card === 'string' && /^[fymb][A2-9TJQK]$/.test(lastMove.card) ? lastMove.card : null;
  const named = isSuit(lastMove.suit) ? lastMove.suit : null;
  const move: LastMove = { by, kind, seat, card, suit: named };

  return {
    version,
    config: { target },
    players,
    stock,
    pile,
    suit,
    phase: phase as Phase,
    toAct: toAct as number | null,
    turnUid: toAct === null ? ANY_PLAYER : players[toAct as number].uid,
    drew: phase === 'playing' && drew === true,
    passes: passCount,
    starter,
    round,
    gameNo,
    lastMove: move,
  };
}

function drawableCount(stock: string, pile: string): number {
  return (stock.length + pile.length - 2) / 2;
}
