/**
 * The rules of Hong Kong mahjong, as one pure reducer.
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
 * The flow of a hand:
 *   deal → dealer on `turn` with 14 tiles
 *   `turn`: discard | kong | win
 *   discard → `claim` (only seats with something to call are asked) →
 *     everyone answered → Mahjong beats pung/kong beats chow → else the next
 *     seat draws and is on `turn`
 *   win, or the wall runs out → `scored` (or `gameover` after the last hand)
 *   `next` deals the next hand.
 */
import { addMeld, parseMelds, type Meld } from './hand';
import { shuffle } from './rng';
import { formatLines, pointsFor, scoreHand, type Score } from './scoring';
import { countOf, fullSet, isBonus, isSuited, kindOf, rankOf, removeTiles, sortTiles, tileOf, isTile } from './tiles';
import {
  ANY_PLAYER,
  MIN_FAAN_CHOICES,
  RULES,
  ROUND_CHOICES,
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
} from './types';

export interface NewGame {
  players: { uid: string; name: string; isHuman: boolean }[];
  minFaan: number;
  rounds: number;
  seed: number;
  /** uid of whoever starts the game (the host online, the human offline). */
  by: string;
}

const N = RULES.PLAYERS;
const next = (seat: number, by = 1) => (seat + by) % N;

export function seatWind(state: Pick<GameState, 'dealer'>, seat: number): number {
  return (seat - state.dealer + N) % N;
}

// ─── dealing and drawing ─────────────────────────────────────────────────────

/**
 * Draw for `seat`, off the front (ordinary) or the back (replacement).
 * Flowers and seasons are set aside and replaced from the back at once.
 * Returns null when the wall runs out first.
 */
function drawFor(state: GameState, seat: number, fromBack: boolean): GameState | null {
  let wall = state.wall;
  let back = fromBack;
  const p = state.players[seat];
  let flowers = p.flowers;
  for (;;) {
    if (wall.length === 0) return null;
    const tile = back ? wall[wall.length - 1] : wall[0];
    wall = back ? wall.slice(0, -1) : wall.slice(1);
    if (isBonus(kindOf(tile))) {
      flowers += tile;
      back = true;
      continue;
    }
    const players = state.players.map((q, i) =>
      i === seat ? { ...q, hand: sortTiles(q.hand + tile), flowers: sortTiles(flowers) } : q,
    );
    return { ...state, wall, players, drawn: tile };
  }
}

/** Shuffle, deal 13 each, set flowers aside, and give the dealer their 14th tile. */
function deal(state: GameState, seed: number): GameState {
  let wall = shuffle(fullSet(), seed);
  const hands = state.players.map(() => '');
  for (let i = 0; i < 13 * N; i++) {
    const seat = next(state.dealer, i % N);
    hands[seat] += wall[0];
    wall = wall.slice(1);
  }
  const players: Player[] = state.players.map((p, seat) => ({
    ...p,
    melds: '',
    discards: '',
    ...splitBonus(hands[seat]),
  }));
  let s: GameState = { ...state, wall, players, claim: null, result: null, drawn: '', via: 'draw' };
  // Replace flowers in turn order, dealer first, each from the back.
  for (let i = 0; i < N; i++) {
    const seat = next(state.dealer, i);
    let missing = 13 - s.players[seat].hand.length;
    while (missing > 0) {
      const drawn = drawFor(s, seat, true);
      if (!drawn) break; // cannot happen with 144 tiles
      s = drawn;
      missing -= 1;
    }
  }
  const dealt = drawFor(s, state.dealer, false) ?? s;
  return { ...dealt, phase: 'turn', toAct: state.dealer, via: 'draw' };
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

export function createGame(options: NewGame): GameState {
  const players: Player[] = options.players.slice(0, N).map((p) => ({
    uid: p.uid,
    name: Array.from(p.name.trim() || 'Player')
      .slice(0, 24)
      .join(''),
    isHuman: p.isHuman,
    sitOut: false,
    score: 0,
    hand: '',
    melds: '',
    flowers: '',
    discards: '',
  }));
  const minFaan = (MIN_FAAN_CHOICES as readonly number[]).includes(options.minFaan) ? options.minFaan : 1;
  const rounds = (ROUND_CHOICES as readonly number[]).includes(options.rounds) ? options.rounds : 1;
  const base: GameState = {
    version: 0,
    config: { minFaan, rounds },
    players,
    wall: '',
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

// ─── what a player may do ────────────────────────────────────────────────────

/** The hand with `drawn` moved to the end, so the scorer knows the winning tile. */
function concealedWithLast(hand: string, last: string): string {
  if (!last) return hand;
  const rest = removeTiles(hand, last);
  return rest === null ? hand : rest + last;
}

function winScore(
  state: GameState,
  seat: number,
  concealed: string,
  flags: { selfDrawn: boolean; afterKong?: boolean; robbed?: boolean },
): Score | null {
  const p = state.players[seat];
  const score = scoreHand({
    concealed,
    melds: parseMelds(p.melds),
    flowers: p.flowers,
    seatWind: seatWind(state, seat),
    wind: state.wind,
    selfDrawn: flags.selfDrawn,
    afterKong: flags.afterKong === true,
    robbed: flags.robbed === true,
    lastTile: state.wall.length === 0,
  });
  return score && score.faan >= state.config.minFaan ? score : null;
}

/** The score `toAct` would get by declaring Mahjong now, or null if they cannot. */
export function selfWin(state: GameState): Score | null {
  if (state.phase !== 'turn' || state.toAct === null || state.via === 'claim') return null;
  const seat = state.toAct;
  return winScore(state, seat, concealedWithLast(state.players[seat].hand, state.drawn), {
    selfDrawn: true,
    afterKong: state.via === 'kong',
  });
}

/** Tiles `toAct` may declare a kong with: four in hand, or the fourth for an exposed pung. */
export function kongOptions(state: GameState): string[] {
  if (state.phase !== 'turn' || state.toAct === null || state.wall.length === 0) return [];
  const p = state.players[state.toAct];
  const out: string[] = [];
  for (const t of new Set(p.hand)) if (countOf(p.hand, t) === 4) out.push(t);
  for (const m of parseMelds(p.melds)) {
    if (m.type === 'pung' && p.hand.includes(m.tiles[0])) out.push(m.tiles[0]);
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
  const hand = state.players[seat].hand;
  const out: ClaimMark[] = [];
  if (winScore(state, seat, hand + claim.tile, { selfDrawn: false, robbed: claim.rob })) out.push('w');
  if (claim.rob) return out;
  const have = countOf(hand, claim.tile);
  if (have === 3 && state.wall.length > 0) out.push('k');
  if (have >= 2) out.push('p');
  if (seat === next(claim.from)) {
    for (const pos of ['l', 'm', 'h'] as const) if (chowTiles(hand, claim.tile, pos)) out.push(pos);
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

// ─── ending a hand ───────────────────────────────────────────────────────────

/** After a hand: does the dealer stay, and is the game over? */
function afterHand(state: GameState, winner: number): { dealer: number; wind: number; over: boolean } {
  if (winner === -1 || winner === state.dealer) return { dealer: state.dealer, wind: state.wind, over: false };
  const dealer = next(state.dealer);
  const wind = dealer === 0 ? state.wind + 1 : state.wind;
  return { dealer, wind, over: wind >= state.config.rounds };
}

function drawnHand(state: GameState): GameState {
  return {
    ...state,
    phase: 'scored',
    toAct: null,
    claim: null,
    result: { winner: -1, from: -1, faan: 0, lines: '', pay: '0,0,0,0' },
  };
}

function finishWin(state: GameState, winner: number, from: number, score: Score): GameState {
  const base = pointsFor(score.faan);
  const pay = state.players.map(() => 0);
  for (let seat = 0; seat < N; seat++) {
    if (seat === winner) continue;
    const owed = from === -1 || seat === from ? base * 2 : base;
    pay[seat] -= owed;
    pay[winner] += owed;
  }
  const players = state.players.map((p, seat) => ({ ...p, score: p.score + pay[seat] }));
  const { over } = afterHand(state, winner);
  return {
    ...state,
    players,
    phase: over ? 'gameover' : 'scored',
    toAct: null,
    claim: null,
    result: { winner, from, faan: score.faan, lines: formatLines(score.lines), pay: pay.join(',') },
  };
}

// ─── turn moves ──────────────────────────────────────────────────────────────

/** Put `tile` out from `seat` and ask whoever can call it. */
function discard(state: GameState, seat: number, tile: string, by: string, kind: 'discard' | 'away'): ApplyResult {
  const p = state.players[seat];
  const hand = removeTiles(p.hand, tile);
  if (hand === null) return { ok: false, error: 'That tile is not in your hand.' };
  let s = withPlayer(state, seat, { hand, discards: p.discards + tile, sitOut: kind === 'away' });
  s = { ...s, drawn: '' };
  const claim = { tile, from: seat, rob: false };
  const asks = s.players.map((_, i) => (claimOptions(s, i, claim).length > 0 ? '?' : '.')).join('');
  const lastMove = { kind, seat, event: 'discard' as Event, eventSeat: seat, tile };
  if (asks.includes('?')) {
    return { ok: true, state: commit({ ...s, phase: 'claim', toAct: null, claim: { ...claim, asks } }, by, lastMove) };
  }
  return { ok: true, state: commit(passOn(s, seat), by, lastMove) };
}

/** Nobody took the discard from `from`: the next seat draws. */
function passOn(state: GameState, from: number): GameState {
  const seat = next(from);
  const drawn = drawFor({ ...state, claim: null }, seat, false);
  if (!drawn) return drawnHand(state);
  return { ...drawn, phase: 'turn', toAct: seat, via: 'draw', claim: null };
}

/** Draw a replacement after a kong, or end the hand if the wall is out. */
function replacement(state: GameState, seat: number): GameState {
  const drawn = drawFor(state, seat, true);
  if (!drawn) return drawnHand(state);
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
  const s = withPlayer(state, seat, { hand: removeTiles(p.hand, tile) ?? p.hand, sitOut: false });
  const claim = { tile, from: seat, rob: true };
  const asks = s.players.map((_, i) => (claimOptions(s, i, claim).length > 0 ? '?' : '.')).join('');
  if (asks.includes('?')) {
    return { ok: true, state: commit({ ...s, drawn: '', phase: 'claim', toAct: null, claim: { ...claim, asks } }, by, lastMove) };
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
  if (mark !== 'x' && !claimOptions(state, seat, claim).includes(mark)) {
    return { ok: false, error: 'You cannot make that call with your hand.' };
  }
  const asks = claim.asks.slice(0, seat) + mark + claim.asks.slice(seat + 1);
  let s = withPlayer({ ...state, claim: { ...claim, asks } }, seat, { sitOut: kind === 'away' });
  const lastMove = { kind, seat, event: 'pass' as Event, eventSeat: seat, tile: claim.tile };
  if (asks.includes('?')) return { ok: true, state: commit(s, by, lastMove) };
  const resolved = resolveClaim(s);
  return { ok: true, state: commit(resolved.state, by, { ...lastMove, event: resolved.event, eventSeat: resolved.seat }) };
}

/** Everyone has answered: Mahjong (nearest seat first) beats pung/kong, which beats chow. */
function resolveClaim(state: GameState): { state: GameState; event: Event; seat: number } {
  const claim = state.claim as Claim;
  const { tile, from, rob, asks } = claim;
  const order = [1, 2, 3].map((d) => next(from, d));

  const winner = order.find((seat) => asks[seat] === 'w');
  if (winner !== undefined) {
    const p = state.players[winner];
    const score = winScore(state, winner, p.hand + tile, { selfDrawn: false, robbed: rob });
    let s = withPlayer(state, winner, { hand: sortTiles(p.hand + tile) });
    if (!rob) s = withPlayer(s, from, { discards: s.players[from].discards.slice(0, -1) });
    // winScore was checked when the call was made; the hand has not changed since.
    return { state: finishWin({ ...s, drawn: tile }, winner, from, score ?? { faan: 0, lines: [] }), event: 'win', seat: winner };
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
  s = { ...s, claim: null };
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
  return { state: { ...s, phase: 'turn', toAct: taker, via: 'claim', drawn: '' }, event: mark === 'p' ? 'pung' : 'chow', seat: taker };
}

/** The tile an absent player on turn throws: the one they just drew, else their last. */
export function autoDiscard(state: GameState): string {
  const hand = state.toAct === null ? '' : state.players[state.toAct].hand;
  return state.drawn && hand.includes(state.drawn) ? state.drawn : hand[hand.length - 1] ?? '';
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
        return discard(state, move.seat, move.tile, uid, 'discard');
      }
      if (move.kind === 'kong') return declareKong(state, move.seat, move.tile, uid);
      const score = selfWin(state);
      if (!score) return { ok: false, error: 'That hand is not a winning hand.' };
      const s = withPlayer(state, move.seat, { sitOut: false });
      return {
        ok: true,
        state: commit(finishWin(s, move.seat, -1, score), uid, {
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
      if (!Number.isInteger(move.seat) || move.seat < 0 || move.seat >= N) return { ok: false, error: 'No such seat.' };
      if (state.players[move.seat].uid === uid) return { ok: false, error: 'That is your own seat.' };
      if (state.phase === 'turn' && state.toAct === move.seat) {
        return discard(state, move.seat, autoDiscard(state), uid, 'away');
      }
      if (state.phase === 'claim' && state.claim?.asks[move.seat] === '?') return answer(state, move.seat, 'x', uid, 'away');
      return { ok: false, error: 'That player is not holding anything up.' };
    }

    case 'next': {
      if (state.phase !== 'scored' || !state.result) return { ok: false, error: 'Finish this hand first.' };
      const { dealer, wind } = afterHand(state, state.result.winner);
      const s = deal({ ...state, dealer, wind, handNo: state.handNo + 1 }, move.seed >>> 0);
      return { ok: true, state: commit(s, uid, { kind: 'next', seat: dealer, event: '', eventSeat: dealer, tile: '' }) };
    }

    case 'rematch': {
      if (state.phase !== 'gameover') return { ok: false, error: 'Finish this game first.' };
      const fresh: GameState = {
        ...state,
        players: state.players.map((p) => ({ ...p, score: 0, sitOut: false })),
        dealer: 0,
        wind: 0,
        handNo: 1,
        gameNo: state.gameNo + 1,
      };
      return { ok: true, state: commit(deal(fresh, move.seed >>> 0), uid, { kind: 'rematch', seat: 0, event: '', eventSeat: 0, tile: '' }) };
    }

    default:
      return { ok: false, error: 'Unknown move.' };
  }
}

export type { Meld };
