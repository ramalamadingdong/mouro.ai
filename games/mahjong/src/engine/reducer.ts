/**
 * The rules of mahjong — Japanese (Riichi) and Hong Kong — as one pure
 * reducer, for two or four players.
 *
 * `applyMove(state, move, uid)` never throws and never mutates. The sender's
 * uid is an argument; a move names the seat it is for, and the reducer checks
 * that seat belongs to the sender (online, the host's uid owns the cats'
 * seats, which is how the host's device plays for them). Every success path
 * ends at `commit`, which bumps `version`, re-derives `turnUid` and stamps
 * `lastMove` — the three things the database rules read.
 *
 * All randomness is a seed carried by the move that deals (`createGame`,
 * `next`, `rematch`); nothing here calls Math.random().
 *
 * The flow of a hand (both rulesets):
 *   deal → dealer on `turn` with 14 tiles
 *   `turn`: discard (Riichi: optionally declaring riichi) | kong | win
 *   discard → `claim` (only seats with something to call are asked) →
 *     everyone answered → a win (nearest seat first) beats pung/kong beats
 *     chow → else the next seat draws and is on `turn`
 *   win, or the wall runs out → `scored` (or `gameover` after the last hand)
 *   `next` deals the next hand.
 *
 * What differs is behind `riichi(state)`: Hong Kong has flowers, faan and a
 * running total from zero; Riichi has a dead wall with dora, riichi,
 * furiten, no win without a yaku, han/fu points from 25,000, honba and sticks.
 */
import { addMeld, isComplete, parseMelds, waits, type Meld } from './hand';
import { riichiPayments, scoreRiichi } from './riichi';
import { shuffle } from './rng';
import { formatLines, LIMIT_FAAN, pointsFor, scoreHand } from './scoring';
import { countOf, fullSet, isBonus, isSuited, isTile, kindOf, rankOf, removeTiles, sortTiles, tileOf } from './tiles';
import {
  ANY_PLAYER,
  MIN_FAAN_CHOICES,
  RIICHI_STICK,
  START_SCORE,
  type ApplyResult,
  type Call,
  type ChowPos,
  type Claim,
  type ClaimMark,
  type Event,
  type GameState,
  type LastMove,
  type Move,
  type Player,
  type Result,
  type Ruleset,
} from './types';

export interface NewGame {
  /** Two or four players. */
  players: { uid: string; name: string; isHuman: boolean }[];
  ruleset: Ruleset;
  minFaan: number;
  rounds: number;
  seed: number;
  /** uid of whoever starts the game (the host online, the human offline). */
  by: string;
}

/** A winning hand's value, the same shape for both rulesets. */
export interface Win {
  /** Faan (Hong Kong) or han (Riichi). */
  faan: number;
  fu: number;
  limit: string;
  lines: [string, number][];
  /** Basic points the payments are multiples of. */
  base: number;
}

/** Rounds each ruleset offers (see ROUND_CHOICES). */
export const ROUNDS_FOR: Record<Ruleset, readonly number[]> = { riichi: [1, 2], hk: [1, 4] };

const isRiichi = (s: Pick<GameState, 'config'>) => s.config.ruleset === 'riichi';
const seats = (s: Pick<GameState, 'players'>) => s.players.length;
const next = (s: Pick<GameState, 'players'>, seat: number, by = 1) => (seat + by) % seats(s);

export function seatWind(state: Pick<GameState, 'dealer' | 'players'>, seat: number): number {
  return (seat - state.dealer + seats(state)) % seats(state);
}

/** True while nobody has called anything and `seat` has not yet thrown a tile. */
function firstGo(state: GameState, seat: number): boolean {
  return state.players.every((p) => p.melds === '') && state.players[seat].discards === '';
}

// ─── dealing and drawing ─────────────────────────────────────────────────────

/**
 * Draw for `seat`: off the front of the wall, or a replacement after a kong
 * (Hong Kong: off the back; Riichi: from the dead wall, which is topped back
 * up from the back of the live wall). Hong Kong flowers are set aside and
 * replaced at once. Returns null when the wall runs out first.
 */
function drawFor(state: GameState, seat: number, replacement: boolean): GameState | null {
  let wall = state.wall;
  let rinshan = state.rinshan;
  let back = replacement;
  const p = state.players[seat];
  let flowers = p.flowers;
  for (;;) {
    let tile: string;
    if (back && isRiichi(state)) {
      if (rinshan.length === 0 || wall.length === 0) return null;
      tile = rinshan[0];
      rinshan = rinshan.slice(1) + wall[wall.length - 1];
      wall = wall.slice(0, -1);
    } else {
      if (wall.length === 0) return null;
      tile = back ? wall[wall.length - 1] : wall[0];
      wall = back ? wall.slice(0, -1) : wall.slice(1);
    }
    if (isBonus(kindOf(tile))) {
      flowers += tile;
      back = true;
      continue;
    }
    const players = state.players.map((q, i) =>
      i === seat ? { ...q, hand: sortTiles(q.hand + tile), flowers: sortTiles(flowers) } : q,
    );
    return { ...state, wall, rinshan, players, drawn: tile };
  }
}

function splitBonus(tiles: string): { hand: string; flowers: string } {
  let hand = '';
  let flowers = '';
  for (const t of tiles) {
    if (isBonus(kindOf(t))) flowers += t;
    else hand += t;
  }
  return { hand: sortTiles(hand), flowers: sortTiles(flowers) };
}

/** The tiles a ruleset plays with: 144 with flowers (Hong Kong) or 136 (Riichi). */
export function tileSet(ruleset: Ruleset): string {
  const all = fullSet();
  return ruleset === 'riichi' ? Array.from(all).filter((t) => !isBonus(kindOf(t))).join('') : all;
}

/** Shuffle, set aside Riichi's dead wall, deal 13 each, replace flowers, and give the dealer their 14th tile. */
function deal(state: GameState, seed: number): GameState {
  const n = seats(state);
  let wall = shuffle(tileSet(state.config.ruleset), seed);
  let rinshan = '';
  let dora = '';
  let ura = '';
  if (isRiichi(state)) {
    const dead = wall.slice(-14);
    wall = wall.slice(0, -14);
    rinshan = dead.slice(0, 4);
    dora = dead.slice(4, 9);
    ura = dead.slice(9, 14);
  }
  const hands = state.players.map(() => '');
  for (let i = 0; i < 13 * n; i++) {
    hands[next(state, state.dealer, i % n)] += wall[0];
    wall = wall.slice(1);
  }
  const players: Player[] = state.players.map((p, seat) => ({
    ...p,
    melds: '',
    discards: '',
    riichi: false,
    riichiAt: -1,
    ippatsu: false,
    furiten: false,
    ...splitBonus(hands[seat]),
  }));
  let s: GameState = {
    ...state,
    wall,
    rinshan,
    dora,
    ura,
    doraShown: isRiichi(state) ? 1 : 0,
    players,
    claim: null,
    result: null,
    drawn: '',
    via: 'draw',
  };
  for (let i = 0; i < n; i++) {
    const seat = next(state, state.dealer, i);
    let missing = 13 - s.players[seat].hand.length;
    while (missing > 0) {
      const drawn = drawFor(s, seat, true);
      if (!drawn) break; // cannot happen with a full wall
      s = drawn;
      missing -= 1;
    }
  }
  const dealt = drawFor(s, state.dealer, false) ?? s;
  return { ...dealt, phase: 'turn', toAct: state.dealer, via: 'draw' };
}

export function createGame(options: NewGame): GameState {
  const ruleset: Ruleset = options.ruleset === 'hk' ? 'hk' : 'riichi';
  const start = START_SCORE[ruleset];
  const count = options.players.length === 2 ? 2 : 4;
  const players: Player[] = options.players.slice(0, count).map((p) => ({
    uid: p.uid,
    name: Array.from(p.name.trim() || 'Player')
      .slice(0, 24)
      .join(''),
    isHuman: p.isHuman,
    sitOut: false,
    score: start,
    hand: '',
    melds: '',
    flowers: '',
    discards: '',
    riichi: false,
    riichiAt: -1,
    ippatsu: false,
    furiten: false,
  }));
  const minFaan =
    ruleset === 'hk' && (MIN_FAAN_CHOICES as readonly number[]).includes(options.minFaan) ? options.minFaan : ruleset === 'hk' ? 1 : 0;
  const rounds = ROUNDS_FOR[ruleset].includes(options.rounds) ? options.rounds : 1;
  const base: GameState = {
    version: 0,
    config: { ruleset, minFaan, rounds },
    players,
    wall: '',
    rinshan: '',
    dora: '',
    ura: '',
    doraShown: 0,
    honba: 0,
    sticks: 0,
    phase: 'turn',
    toAct: 0,
    turnUid: ANY_PLAYER,
    drawn: '',
    via: 'draw',
    claim: null,
    result: null,
    dealer: 0,
    wind: 0,
    handNo: 1,
    gameNo: 1,
    lastMove: { by: options.by, kind: 'start', seat: 0, event: '', eventSeat: 0, tile: '' },
  };
  return commit(deal(base, options.seed), options.by, { kind: 'start', seat: 0, event: '', eventSeat: 0, tile: '' });
}

// ─── winning ─────────────────────────────────────────────────────────────────

/** The hand with `last` moved to the end, so the scorers know the winning tile. */
function concealedWithLast(hand: string, last: string): string {
  if (!last) return hand;
  const rest = removeTiles(hand, last);
  return rest === null ? hand : rest + last;
}

export interface WinFlags {
  tsumo: boolean;
  /** Won on a kong replacement. */
  afterKong?: boolean;
  /** Won by robbing a kong. */
  robbed?: boolean;
}

/** What `seat` would score winning with `concealed` (winning tile last), or null if it is not a legal win. */
export function winValue(state: GameState, seat: number, concealed: string, flags: WinFlags): Win | null {
  const p = state.players[seat];
  const melds = parseMelds(p.melds);
  const lastTile = state.wall.length === 0;
  if (!isRiichi(state)) {
    const score = scoreHand({
      concealed,
      melds,
      flowers: p.flowers,
      seatWind: seatWind(state, seat),
      wind: state.wind,
      selfDrawn: flags.tsumo,
      afterKong: flags.afterKong === true,
      robbed: flags.robbed === true,
      lastTile,
    });
    if (!score || score.faan < state.config.minFaan) return null;
    return { faan: score.faan, fu: 0, limit: score.faan >= LIMIT_FAAN ? 'Limit' : '', lines: score.lines, base: pointsFor(score.faan) };
  }
  const score = scoreRiichi({
    concealed,
    winTile: concealed[concealed.length - 1] ?? '',
    melds,
    tsumo: flags.tsumo,
    riichi: p.riichi,
    // Riichi on your very first throw. (A call before that throw is not tracked: rare, and in your favour.)
    doubleRiichi: p.riichi && p.riichiAt === 0,
    ippatsu: p.ippatsu,
    seatWind: seatWind(state, seat),
    roundWind: state.wind,
    doraIndicators: state.dora.slice(0, state.doraShown),
    uraIndicators: state.ura.slice(0, state.doraShown),
    lastTile,
    rinshan: flags.afterKong === true,
    chankan: flags.robbed === true,
    firstDraw: flags.tsumo && firstGo(state, seat),
    dealer: seat === state.dealer,
  });
  if (!score) return null;
  return { faan: score.han, fu: score.fu, limit: score.limit, lines: score.lines, base: score.base };
}

/** Riichi: the tiles `seat` is waiting on are in their own discards — no ron. */
function permanentFuriten(state: GameState, seat: number): boolean {
  const p = state.players[seat];
  return waits(p.hand).some((t) => p.discards.includes(t));
}

/** Riichi: may not win on another player's tile right now. */
export function inFuriten(state: GameState, seat: number): boolean {
  return isRiichi(state) && (state.players[seat].furiten || permanentFuriten(state, seat));
}

/** The value `toAct` would get by declaring a win on their own draw now, or null if they cannot. */
export function selfWin(state: GameState): Win | null {
  if (state.phase !== 'turn' || state.toAct === null || state.via === 'claim') return null;
  const seat = state.toAct;
  return winValue(state, seat, concealedWithLast(state.players[seat].hand, state.drawn), {
    tsumo: true,
    afterKong: state.via === 'kong',
  });
}

// ─── what a player may do ────────────────────────────────────────────────────

/** Tiles `toAct` may declare a kong with: four in hand, or the fourth for an exposed pung. */
export function kongOptions(state: GameState): string[] {
  if (state.phase !== 'turn' || state.toAct === null || state.wall.length === 0) return [];
  const p = state.players[state.toAct];
  if (isRiichi(state) && (p.riichi || state.doraShown >= 5)) return [];
  const out: string[] = [];
  for (const t of new Set(p.hand)) if (countOf(p.hand, t) === 4) out.push(t);
  for (const m of parseMelds(p.melds)) {
    if (m.type === 'pung' && p.hand.includes(m.tiles[0])) out.push(m.tiles[0]);
  }
  return out;
}

/**
 * Riichi: the tiles `toAct` may throw to declare riichi — a closed hand, not
 * already in riichi, 1,000 points to put down, enough wall left, and ready
 * after the throw.
 */
export function riichiOptions(state: GameState): string[] {
  if (!isRiichi(state) || state.phase !== 'turn' || state.toAct === null) return [];
  const p = state.players[state.toAct];
  if (p.riichi || p.score < RIICHI_STICK || state.wall.length < seats(state)) return [];
  if (!parseMelds(p.melds).every((m) => m.type === 'hidden-kong')) return [];
  const out: string[] = [];
  for (const t of new Set(p.hand)) {
    const rest = removeTiles(p.hand, t);
    if (rest && waits(rest).length > 0) out.push(t);
  }
  return out;
}

/** Tiles of the chow `pos` would make with `tile`, or null if the hand lacks them. */
export function chowTiles(hand: string, tile: string, pos: ChowPos): string | null {
  const k = kindOf(tile);
  if (!isSuited(k)) return null;
  const r = rankOf(k);
  const need =
    pos === 'l' ? (r <= 7 ? [k + 1, k + 2] : null) : pos === 'm' ? (r >= 2 && r <= 8 ? [k - 1, k + 1] : null) : r >= 3 ? [k - 2, k - 1] : null;
  if (!need) return null;
  const tiles = need.map(tileOf).join('');
  return removeTiles(hand, tiles) === null ? null : tiles;
}

/** Every call `seat` could make on the tile in `claim`. Empty means they are not asked. */
export function claimOptions(state: GameState, seat: number, claim: Pick<Claim, 'tile' | 'from' | 'rob'>): ClaimMark[] {
  if (seat === claim.from) return [];
  const p = state.players[seat];
  const out: ClaimMark[] = [];
  if (!inFuriten(state, seat) && winValue(state, seat, p.hand + claim.tile, { tsumo: false, robbed: claim.rob })) out.push('w');
  // Nothing but a win off a robbed kong, off the last tile, or into a riichi hand.
  if (claim.rob || state.wall.length === 0 || p.riichi) return out;
  const have = countOf(p.hand, claim.tile);
  if (have === 3 && !(isRiichi(state) && state.doraShown >= 5)) out.push('k');
  if (have >= 2) out.push('p');
  if (seat === next(state, claim.from)) {
    for (const pos of ['l', 'm', 'h'] as const) if (chowTiles(p.hand, claim.tile, pos)) out.push(pos);
  }
  return out;
}

// ─── commit ──────────────────────────────────────────────────────────────────

function commit(state: GameState, by: string, lastMove: Omit<LastMove, 'by'>): GameState {
  const toAct = state.phase === 'turn' ? state.toAct : null;
  return {
    ...state,
    toAct,
    claim: state.phase === 'claim' ? state.claim : null,
    turnUid: toAct === null ? ANY_PLAYER : state.players[toAct].uid,
    version: state.version + 1,
    lastMove: { by, ...lastMove },
  };
}

function withPlayer(state: GameState, seat: number, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p, i) => (i === seat ? { ...p, ...patch } : p)) };
}

/** Any call (or kan) breaks every ippatsu. */
function breakIppatsu(state: GameState): GameState {
  if (!state.players.some((p) => p.ippatsu)) return state;
  return { ...state, players: state.players.map((p) => ({ ...p, ippatsu: false })) };
}

function revealKanDora(state: GameState): GameState {
  return isRiichi(state) ? { ...state, doraShown: Math.min(5, state.doraShown + 1) } : state;
}

// ─── ending a hand ───────────────────────────────────────────────────────────

/** After a hand: who deals next, the round wind, the repeat counter, and whether the game is over. */
function afterHand(state: GameState, result: Result): { dealer: number; wind: number; honba: number; over: boolean } {
  const dealerStays = isRiichi(state)
    ? result.winner === state.dealer || (result.winner === -1 && result.tenpai.includes(String(state.dealer)))
    : result.winner === -1 || result.winner === state.dealer;
  const honba = isRiichi(state) ? (dealerStays || result.winner === -1 ? state.honba + 1 : 0) : 0;
  const busted = isRiichi(state) && state.players.some((p) => p.score < 0);
  if (dealerStays) return { dealer: state.dealer, wind: state.wind, honba, over: busted };
  const dealer = next(state, state.dealer);
  const wind = dealer === 0 ? state.wind + 1 : state.wind;
  return { dealer, wind, honba, over: busted || wind >= state.config.rounds };
}

/** Apply payments (and any riichi sticks), and move to `scored` or `gameover`. */
function settle(state: GameState, result: Result, owed: number[]): GameState {
  let pay = owed.slice();
  let sticks = state.sticks;
  if (result.winner >= 0 && sticks > 0) {
    pay = pay.map((n, seat) => (seat === result.winner ? n + sticks * RIICHI_STICK : n));
    sticks = 0;
  }
  const players = state.players.map((p, seat) => ({ ...p, score: p.score + pay[seat] }));
  let s: GameState = { ...state, players, sticks, toAct: null, claim: null, result: { ...result, pay: pay.join(',') } };
  const { over } = afterHand(s, s.result as Result);
  if (over && s.sticks > 0) {
    // Sticks nobody won go to whoever finishes on top.
    const top = s.players.reduce((best, p, i) => (p.score > s.players[best].score ? i : best), 0);
    s = { ...withPlayer(s, top, { score: s.players[top].score + s.sticks * RIICHI_STICK }), sticks: 0 };
  }
  return { ...s, phase: over ? 'gameover' : 'scored' };
}

/** The wall ran out. Riichi: whoever is not ready pays whoever is. */
function drawnHand(state: GameState): GameState {
  const n = seats(state);
  const result: Result = { winner: -1, from: -1, faan: 0, fu: 0, limit: '', tenpai: '', lines: '', pay: '' };
  const pay = new Array<number>(n).fill(0);
  if (isRiichi(state)) {
    const ready = state.players.flatMap((p, seat) => (waits(p.hand).length > 0 ? [seat] : []));
    result.tenpai = ready.join('');
    if (ready.length > 0 && ready.length < n) {
      const pool = n === 2 ? 1500 : 3000;
      for (let seat = 0; seat < n; seat++) {
        pay[seat] = ready.includes(seat) ? pool / ready.length : -pool / (n - ready.length);
      }
    }
  }
  return settle({ ...state, drawn: '' }, result, pay);
}

function finishWin(state: GameState, winner: number, from: number, win: Win): GameState {
  const n = seats(state);
  const pay = new Array<number>(n).fill(0);
  if (isRiichi(state)) {
    const owed = riichiPayments(win.base, winner, from, state.dealer, n);
    const payers = owed.filter((x) => x > 0).length;
    for (let seat = 0; seat < n; seat++) if (owed[seat] > 0) pay[seat] = -(owed[seat] + (state.honba * 300) / payers);
  } else {
    for (let seat = 0; seat < n; seat++) {
      if (seat !== winner) pay[seat] = -(from === -1 || seat === from ? win.base * 2 : win.base);
    }
  }
  pay[winner] = -pay.reduce((a, b) => a + b, 0);
  const result: Result = {
    winner,
    from,
    faan: win.faan,
    fu: win.fu,
    limit: win.limit,
    tenpai: '',
    lines: formatLines(win.lines),
    pay: '',
  };
  return settle(state, result, pay);
}

// ─── turn moves ──────────────────────────────────────────────────────────────

/** A tile is on offer: who is asked, and (Riichi) who goes into furiten for letting a winning tile by. */
function offer(state: GameState, claim: Pick<Claim, 'tile' | 'from' | 'rob'>): { state: GameState; asks: string } {
  const asks = state.players.map((_, i) => (claimOptions(state, i, claim).length > 0 ? '?' : '.')).join('');
  if (!isRiichi(state)) return { state, asks };
  // Unable to take a tile you were waiting on (no yaku, or already furiten) is furiten until your next throw.
  const players = state.players.map((p, i) =>
    i !== claim.from && asks[i] !== '?' && isComplete(p.hand + claim.tile) ? { ...p, furiten: true } : p,
  );
  return { state: { ...state, players }, asks };
}

/** Put `tile` out from `seat` and ask whoever can call it. */
function discard(state: GameState, seat: number, tile: string, by: string, kind: 'discard' | 'away', declare: boolean): ApplyResult {
  const p = state.players[seat];
  if (p.riichi && state.drawn && tile !== state.drawn) return { ok: false, error: 'After riichi you must throw the tile you drew.' };
  if (declare && !riichiOptions(state).includes(tile)) return { ok: false, error: 'You cannot declare riichi with that tile.' };
  const hand = removeTiles(p.hand, tile);
  if (hand === null) return { ok: false, error: 'That tile is not in your hand.' };
  let s = withPlayer(state, seat, {
    hand,
    discards: p.discards + tile,
    sitOut: kind === 'away',
    // Your own throw ends furiten (unless you are in riichi) and spends ippatsu.
    furiten: p.riichi ? p.furiten : false,
    ippatsu: false,
  });
  if (declare) {
    s = withPlayer(s, seat, { riichi: true, riichiAt: p.discards.length, ippatsu: true, score: p.score - RIICHI_STICK });
    s = { ...s, sticks: s.sticks + 1 };
  }
  s = { ...s, drawn: '' };
  const claim = { tile, from: seat, rob: false };
  const offered = offer(s, claim);
  s = offered.state;
  const lastMove = { kind, seat, event: (declare ? 'riichi' : 'discard') as Event, eventSeat: seat, tile };
  if (offered.asks.includes('?')) {
    return { ok: true, state: commit({ ...s, phase: 'claim', toAct: null, claim: { ...claim, asks: offered.asks } }, by, lastMove) };
  }
  return { ok: true, state: commit(passOn(s, seat), by, lastMove) };
}

/** Nobody took the discard from `from`: the next seat draws. */
function passOn(state: GameState, from: number): GameState {
  const seat = next(state, from);
  const drawn = drawFor({ ...state, claim: null }, seat, false);
  if (!drawn) return drawnHand(state);
  return { ...drawn, phase: 'turn', toAct: seat, via: 'draw', claim: null };
}

/** Draw a replacement after a kong (Riichi: turning over a new dora), or end the hand if the wall is out. */
function replacement(state: GameState, seat: number): GameState {
  const s = revealKanDora(breakIppatsu(state));
  const drawn = drawFor(s, seat, true);
  if (!drawn) return drawnHand(s);
  return { ...drawn, phase: 'turn', toAct: seat, via: 'kong', claim: null };
}

function declareKong(state: GameState, seat: number, tile: string, by: string): ApplyResult {
  if (!kongOptions(state).includes(tile)) return { ok: false, error: 'You cannot declare a kong with that tile.' };
  const p = state.players[seat];
  const lastMove = { kind: 'kong' as const, seat, event: 'kong' as Event, eventSeat: seat, tile };
  if (countOf(p.hand, tile) === 4) {
    const s = withPlayer(state, seat, {
      hand: removeTiles(p.hand, tile.repeat(4)) ?? p.hand,
      melds: addMeld(p.melds, 'hidden-kong', tile.repeat(4)),
      sitOut: false,
    });
    return { ok: true, state: commit(replacement({ ...s, drawn: '' }, seat), by, lastMove) };
  }
  // Adding to a pung: anyone who could win on that tile may rob it first.
  let s = withPlayer(state, seat, { hand: removeTiles(p.hand, tile) ?? p.hand, sitOut: false });
  const claim = { tile, from: seat, rob: true };
  const offered = offer(s, claim);
  s = offered.state;
  if (offered.asks.includes('?')) {
    return { ok: true, state: commit({ ...s, drawn: '', phase: 'claim', toAct: null, claim: { ...claim, asks: offered.asks } }, by, lastMove) };
  }
  return { ok: true, state: commit(completeAddedKong(s, seat, tile), by, lastMove) };
}

function completeAddedKong(state: GameState, seat: number, tile: string): GameState {
  const p = state.players[seat];
  const melds = p.melds
    .split(',')
    .map((m) => (m === `p${tile.repeat(3)}` ? `k${tile.repeat(4)}` : m))
    .join(',');
  return replacement({ ...withPlayer(state, seat, { melds }), drawn: '' }, seat);
}

// ─── claims ──────────────────────────────────────────────────────────────────

const CALL_MARK: Record<Exclude<Call, 'chow'>, ClaimMark> = { pass: 'x', win: 'w', pung: 'p', kong: 'k' };

function answer(state: GameState, seat: number, mark: ClaimMark, by: string, kind: 'claim' | 'away'): ApplyResult {
  const claim = state.claim;
  if (state.phase !== 'claim' || !claim) return { ok: false, error: 'There is nothing to claim.' };
  if (claim.asks[seat] !== '?') return { ok: false, error: 'You have already answered.' };
  const options = claimOptions(state, seat, claim);
  if (mark !== 'x' && !options.includes(mark)) return { ok: false, error: 'You cannot make that call with your hand.' };
  const asks = claim.asks.slice(0, seat) + mark + claim.asks.slice(seat + 1);
  // Passing up a win is furiten (Riichi).
  const passedWin = mark === 'x' && options.includes('w') && isRiichi(state);
  let s = withPlayer({ ...state, claim: { ...claim, asks } }, seat, {
    sitOut: kind === 'away',
    ...(passedWin ? { furiten: true } : {}),
  });
  const lastMove = { kind, seat, event: 'pass' as Event, eventSeat: seat, tile: claim.tile };
  if (asks.includes('?')) return { ok: true, state: commit(s, by, lastMove) };
  const resolved = resolveClaim(s);
  s = resolved.state;
  return { ok: true, state: commit(s, by, { ...lastMove, event: resolved.event, eventSeat: resolved.seat }) };
}

/** Everyone has answered: a win (nearest seat first) beats pung/kong, which beats chow. */
function resolveClaim(state: GameState): { state: GameState; event: Event; seat: number } {
  const claim = state.claim as Claim;
  const { tile, from, rob, asks } = claim;
  const order = Array.from({ length: seats(state) - 1 }, (_, d) => next(state, from, d + 1));

  const winner = order.find((seat) => asks[seat] === 'w');
  if (winner !== undefined) {
    const p = state.players[winner];
    const value = winValue(state, winner, p.hand + tile, { tsumo: false, robbed: rob });
    let s = withPlayer(state, winner, { hand: sortTiles(p.hand + tile) });
    if (!rob) {
      const q = s.players[from];
      const riichiTile = q.riichi && q.riichiAt === q.discards.length - 1;
      s = withPlayer(s, from, {
        discards: q.discards.slice(0, -1),
        // A riichi whose own tile is won on never stood: the stick comes back.
        ...(riichiTile ? { riichi: false, riichiAt: -1, ippatsu: false, score: q.score + RIICHI_STICK } : {}),
      });
      if (riichiTile) s = { ...s, sticks: s.sticks - 1 };
    }
    // winValue was checked when the call was made; the hand has not changed since.
    const win = value ?? { faan: 0, fu: 0, limit: '', lines: [], base: 0 };
    return { state: finishWin({ ...s, drawn: tile }, winner, from, win), event: 'win', seat: winner };
  }

  if (rob) {
    return { state: completeAddedKong({ ...state, claim: null }, from, tile), event: 'kong', seat: from };
  }

  const taker =
    order.find((seat) => asks[seat] === 'k' || asks[seat] === 'p') ??
    order.find((seat) => asks[seat] === 'l' || asks[seat] === 'm' || asks[seat] === 'h');
  if (taker === undefined) {
    return { state: passOn({ ...state, claim: null }, from), event: 'pass', seat: from };
  }

  const mark = asks[taker];
  const p = state.players[taker];
  let s = withPlayer(state, from, { discards: state.players[from].discards.slice(0, -1) });
  s = breakIppatsu({ ...s, claim: null });
  if (mark === 'k') {
    s = withPlayer(s, taker, {
      hand: removeTiles(p.hand, tile.repeat(3)) ?? p.hand,
      melds: addMeld(p.melds, 'kong', tile.repeat(4)),
    });
    return { state: replacement({ ...s, drawn: '' }, taker), event: 'kong', seat: taker };
  }
  if (mark === 'p') {
    s = withPlayer(s, taker, {
      hand: removeTiles(p.hand, tile.repeat(2)) ?? p.hand,
      melds: addMeld(p.melds, 'pung', tile.repeat(3)),
    });
  } else {
    const pair = chowTiles(p.hand, tile, mark as ChowPos) ?? '';
    s = withPlayer(s, taker, {
      hand: removeTiles(p.hand, pair) ?? p.hand,
      melds: addMeld(p.melds, 'chow', sortTiles(pair + tile)),
    });
  }
  return {
    state: { ...s, phase: 'turn', toAct: taker, via: 'claim', drawn: '' },
    event: mark === 'p' ? 'pung' : 'chow',
    seat: taker,
  };
}

/** The tile an absent player on turn throws: the one they just drew, else their last. */
export function autoDiscard(state: GameState): string {
  const hand = state.toAct === null ? '' : state.players[state.toAct].hand;
  return state.drawn && hand.includes(state.drawn) ? state.drawn : (hand[hand.length - 1] ?? '');
}

// ─── the reducer ─────────────────────────────────────────────────────────────

function owns(state: GameState, seat: number, uid: string): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < state.players.length && state.players[seat].uid === uid;
}

export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  if (!state.players.some((p) => p.uid === uid)) return { ok: false, error: 'You are not playing in this game.' };

  switch (move.kind) {
    case 'discard':
    case 'kong':
    case 'win': {
      if (!owns(state, move.seat, uid)) return { ok: false, error: 'That is not your seat.' };
      if (state.phase !== 'turn' || state.toAct !== move.seat) return { ok: false, error: 'It is not your turn.' };
      if (move.kind === 'discard') {
        if (!isTile(move.tile)) return { ok: false, error: 'That is not a tile.' };
        return discard(state, move.seat, move.tile, uid, 'discard', move.riichi === true);
      }
      if (move.kind === 'kong') return declareKong(state, move.seat, move.tile, uid);
      const win = selfWin(state);
      if (!win) {
        return { ok: false, error: isRiichi(state) ? 'That hand has no yaku, so it cannot win.' : 'That hand is not a winning hand.' };
      }
      const s = withPlayer(state, move.seat, { sitOut: false });
      return {
        ok: true,
        state: commit(finishWin(s, move.seat, -1, win), uid, {
          kind: 'win',
          seat: move.seat,
          event: 'win',
          eventSeat: move.seat,
          tile: state.drawn,
        }),
      };
    }

    case 'claim': {
      if (!owns(state, move.seat, uid)) return { ok: false, error: 'That is not your seat.' };
      const mark: ClaimMark | undefined =
        move.call === 'chow' ? (move.chow === 'l' || move.chow === 'm' || move.chow === 'h' ? move.chow : undefined) : CALL_MARK[move.call];
      if (!mark) return { ok: false, error: 'Unknown call.' };
      return answer(state, move.seat, mark, uid, 'claim');
    }

    case 'away': {
      // Who may act for an absent player is the database rules' call (they
      // can see presence; the engine cannot).
      if (!Number.isInteger(move.seat) || move.seat < 0 || move.seat >= seats(state)) return { ok: false, error: 'No such seat.' };
      if (state.players[move.seat].uid === uid) return { ok: false, error: 'That is your own seat.' };
      if (state.phase === 'turn' && state.toAct === move.seat) {
        return discard(state, move.seat, autoDiscard(state), uid, 'away', false);
      }
      if (state.phase === 'claim' && state.claim?.asks[move.seat] === '?') return answer(state, move.seat, 'x', uid, 'away');
      return { ok: false, error: 'That player is not holding anything up.' };
    }

    case 'next': {
      if (state.phase !== 'scored' || !state.result) return { ok: false, error: 'Finish this hand first.' };
      const { dealer, wind, honba } = afterHand(state, state.result);
      const s = deal({ ...state, dealer, wind, honba, handNo: state.handNo + 1 }, move.seed >>> 0);
      return { ok: true, state: commit(s, uid, { kind: 'next', seat: dealer, event: '', eventSeat: dealer, tile: '' }) };
    }

    case 'rematch': {
      if (state.phase !== 'gameover') return { ok: false, error: 'Finish this game first.' };
      const start = START_SCORE[state.config.ruleset];
      const fresh: GameState = {
        ...state,
        players: state.players.map((p) => ({ ...p, score: start, sitOut: false })),
        dealer: 0,
        wind: 0,
        honba: 0,
        sticks: 0,
        handNo: 1,
        gameNo: state.gameNo + 1,
      };
      return {
        ok: true,
        state: commit(deal(fresh, move.seed >>> 0), uid, { kind: 'rematch', seat: 0, event: '', eventSeat: 0, tile: '' }),
      };
    }

    default:
      return { ok: false, error: 'Unknown move.' };
  }
}

export type { Meld };
