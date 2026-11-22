/**
 * `normalize(raw)` turns whatever came off the wire or out of localStorage
 * into a GameState, or null if it is not one. ALWAYS run a state through it
 * before use.
 *
 * The realtime database drops empty strings' parents and nulls, so every
 * optional field defaults here. It is also the only cheat detection there is
 * (the server checks who may write, never what): a state is refused unless
 * all 144 tiles are present exactly once, hand sizes add up, and the scores
 * sum to zero.
 */
import { handSize, parseMelds } from './hand';
import { fullSet, sortTiles, tileOf } from './tiles';
import {
  ANY_PLAYER,
  MIN_FAAN_CHOICES,
  RULES,
  ROUND_CHOICES,
  type Claim,
  type Event,
  type GameState,
  type LastMove,
  type MoveKind,
  type Phase,
  type Player,
  type Result,
} from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const TILES = /^[a-zA-P]*$/;
const MELDS = /^([cp][a-zA-P]{3}|[kh][a-zA-P]{4})?(,([cp][a-zA-P]{3}|[kh][a-zA-P]{4}))*$/;
const KINDS: readonly MoveKind[] = ['start', 'discard', 'kong', 'win', 'claim', 'away', 'next', 'rematch'];
const EVENTS: readonly Event[] = ['', 'discard', 'pung', 'chow', 'kong', 'win', 'draw', 'pass'];
const PHASES: readonly Phase[] = ['turn', 'claim', 'scored', 'gameover'];

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
  const { uid, name, isHuman, score } = v;
  if (typeof uid !== 'string' || uid.length === 0 || typeof name !== 'string' || typeof isHuman !== 'boolean') return null;
  if (!isInt(score)) return null;
  const hand = str(v.hand);
  const melds = str(v.melds);
  const flowers = str(v.flowers);
  const discards = str(v.discards);
  if (!TILES.test(hand) || !TILES.test(flowers) || !TILES.test(discards) || !MELDS.test(melds)) return null;
  for (const m of parseMelds(melds)) {
    const t = m.tiles;
    if (m.type === 'chow') {
      if (t !== sortTiles(t) || m.kind >= 27 || m.kind % 9 > 6) return null;
      const k = m.kind;
      if (t !== [k, k + 1, k + 2].map(tileOf).join('')) return null;
    } else if (new Set(t).size !== 1 || m.kind >= 34) return null;
  }
  return { uid, name, isHuman, sitOut: v.sitOut === true, score, hand: sortTiles(hand), melds, flowers, discards };
}

export function normalize(raw: unknown): GameState | null {
  if (!isObj(raw)) return null;
  const { version, config, phase, dealer, wind, handNo, gameNo, lastMove } = raw;
  if (!isInt(version) || version < 1 || !isObj(config)) return null;
  const { minFaan, rounds } = config;
  if (!(MIN_FAAN_CHOICES as readonly unknown[]).includes(minFaan)) return null;
  if (!(ROUND_CHOICES as readonly unknown[]).includes(rounds)) return null;

  const list = asList(raw.players);
  if (!list || list.length !== RULES.PLAYERS) return null;
  const players: Player[] = [];
  for (const p of list) {
    const ok = player(p);
    if (!ok) return null;
    players.push(ok);
  }
  if (players.reduce((n, p) => n + p.score, 0) !== 0) return null;

  if (!PHASES.includes(phase as Phase)) return null;
  if (!isInt(dealer) || dealer < 0 || dealer > 3) return null;
  if (!isInt(wind) || wind < 0 || wind > 3) return null;
  if (!isInt(handNo) || handNo < 1 || !isInt(gameNo) || gameNo < 1) return null;
  const wall = str(raw.wall);
  const drawn = str(raw.drawn);
  if (!TILES.test(wall) || drawn.length > 1 || !TILES.test(drawn)) return null;
  const via = raw.via === 'kong' || raw.via === 'claim' ? raw.via : 'draw';

  const toAct = phase === 'turn' ? (raw.toAct ?? null) : null;
  if (phase === 'turn' && (!isInt(toAct) || toAct < 0 || toAct > 3)) return null;

  let claim: Claim | null = null;
  if (phase === 'claim') {
    const c = raw.claim;
    if (!isObj(c)) return null;
    const tile = str(c.tile);
    const asks = str(c.asks);
    if (tile.length !== 1 || !TILES.test(tile) || !isInt(c.from) || c.from < 0 || c.from > 3) return null;
    if (!/^[.?xwkplmh]{4}$/.test(asks) || asks[c.from] !== '.' || !asks.includes('?')) return null;
    claim = { tile, from: c.from, rob: c.rob === true, asks };
  }

  let result: Result | null = null;
  if (phase === 'scored' || phase === 'gameover') {
    const r = raw.result;
    if (!isObj(r)) return null;
    const { winner, from, faan } = r;
    const pay = str(r.pay);
    if (!isInt(winner) || winner < -1 || winner > 3 || !isInt(from) || from < -1 || from > 3 || !isInt(faan) || faan < 0) {
      return null;
    }
    if (!/^-?[0-9]+(,-?[0-9]+){3}$/.test(pay)) return null;
    result = { winner, from, faan, lines: str(r.lines), pay };
  }

  // Every tile exactly once.
  let all = wall + (claim?.rob ? claim.tile : '');
  for (const p of players) all += p.hand + parseMelds(p.melds).map((m) => m.tiles).join('') + p.flowers + p.discards;
  if (sortTiles(all) !== fullSet()) return null;

  // Hand sizes: 14 for whoever is on turn or has just won, 13 for everyone else.
  for (let seat = 0; seat < players.length; seat++) {
    const full = (phase === 'turn' && seat === toAct) || (result !== null && result.winner === seat);
    if (handSize(players[seat].hand, players[seat].melds) !== (full ? 14 : 13)) return null;
  }

  if (!isObj(lastMove)) return null;
  const kind = lastMove.kind as MoveKind;
  const event = (lastMove.event ?? '') as Event;
  if (typeof lastMove.by !== 'string' || !KINDS.includes(kind) || !EVENTS.includes(event)) return null;
  if (!isInt(lastMove.seat) || !isInt(lastMove.eventSeat ?? 0)) return null;
  const move: LastMove = {
    by: lastMove.by,
    kind,
    seat: lastMove.seat,
    event,
    eventSeat: (lastMove.eventSeat as number | undefined) ?? 0,
    tile: str(lastMove.tile),
  };

  return {
    version,
    config: { minFaan: minFaan as number, rounds: rounds as number },
    players,
    wall,
    phase: phase as Phase,
    toAct: toAct as number | null,
    turnUid: toAct === null ? ANY_PLAYER : players[toAct as number].uid,
    drawn,
    via,
    claim,
    result,
    dealer,
    wind,
    handNo,
    gameNo,
    lastMove: move,
  };
}
