/**
 * The rules of Cat Café, as one pure reducer.
 *
 * `applyMove(state, move, uid, rnd)` never throws and never mutates. The
 * sender's uid is an argument, not part of the move, so a payload cannot lie
 * about who sent it. Every success path ends at `commit`, which bumps
 * `version`, re-derives the turn and stamps `lastMove` — the things the
 * database rules read.
 *
 * Rules: each round one more cat than there are players, plus one, waits at
 * the door. In turn, every player takes one and seats it on their own floor
 * (or sends it away). The first pick moves one seat to the left every round.
 * After twelve rounds the best-scoring café wins (ties are shared).
 *
 * The only randomness is which cats come to the door. Whoever makes the pick
 * that ends a round draws the next round's cats, with the `rnd` they pass in;
 * there is no hidden deck in the state for anyone to peek at.
 */
import { tally } from './score';
import {
  COAT_KEYS,
  EMPTY_SLOT,
  SHAPES,
  cellsAt,
  encodeCat,
  fits,
  gridOf,
  parseFloor,
  parseMarket,
  placements,
  type PlacedCat,
  type Tile,
} from './tiles';
import { ANY_PLAYER, RULES, type ApplyResult, type GameState, type LastMove, type Move, type Player, type Rnd } from './types';

export interface NewGame {
  players: { uid: string; name: string; isHuman: boolean }[];
  /** uid of whoever starts the game (the host online, the human offline). */
  by: string;
  rnd: Rnd;
}

export const marketSize = (players: number): number => players + RULES.MARKET_EXTRA;
export const totalPicks = (players: number): number => RULES.ROUNDS * players;

/** Round on the clock, 1 … ROUNDS (stays at ROUNDS once the game is over). */
export function roundOf(state: Pick<GameState, 'picks' | 'players'>): number {
  return Math.min(RULES.ROUNDS, Math.floor(state.picks / state.players.length) + 1);
}

/** Who picks next after `picks` picks, or null when the game is over. */
export function seatOnTurn(picks: number, players: number, starter: number): number | null {
  if (picks >= totalPicks(players)) return null;
  return (starter + Math.floor(picks / players) + (picks % players)) % players;
}

/** How many turns `seat` has had after `picks` picks. */
export function turnsTaken(picks: number, players: number, starter: number, seat: number): number {
  const round = Math.floor(picks / players);
  if (round >= RULES.ROUNDS) return RULES.ROUNDS;
  const place = (((seat - starter - round) % players) + players) % players;
  return round + (place < picks % players ? 1 : 0);
}

/** Fill every empty slot with a random cat that is not already at the door. */
function refill(market: string, rnd: Rnd): string {
  const slots: string[] = [];
  for (let i = 0; i < market.length; i += 2) slots.push(market.slice(i, i + 2));
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== EMPTY_SLOT) continue;
    let tile = '';
    for (let tries = 0; tries < 50; tries++) {
      tile = `${COAT_KEYS[Math.floor(rnd() * COAT_KEYS.length)]}${Math.floor(rnd() * SHAPES.length)}`;
      if (!slots.includes(tile)) break;
    }
    slots[i] = tile;
  }
  return slots.join('');
}

function cleanName(name: string): string {
  return Array.from(name.trim() || 'Player')
    .slice(0, 24)
    .join('');
}

/** A fresh game, seat 0 to pick first. */
export function createGame(options: NewGame): GameState {
  const players: Player[] = options.players.slice(0, RULES.MAX_PLAYERS).map((p) => ({
    uid: p.uid,
    name: cleanName(p.name),
    isHuman: p.isHuman,
    sitOut: false,
  }));
  return {
    version: 1,
    players,
    market: refill(EMPTY_SLOT.repeat(marketSize(players.length)), options.rnd),
    floors: players.map(() => ''),
    picks: 0,
    phase: 'playing',
    toAct: 0,
    turnUid: players[0]?.uid ?? ANY_PLAYER,
    starter: 0,
    gameNo: 1,
    lastMove: { by: options.by, kind: 'start', seat: 0, tile: null, cat: null },
  };
}

/** The cats on `seat`'s floor. An unreadable floor reads as empty (normalize refuses those states). */
export function floorCats(state: GameState, seat: number): PlacedCat[] {
  return parseFloor(state.floors[seat] ?? '') ?? [];
}

export function scores(state: GameState): number[] {
  return state.players.map((_, seat) => tally(floorCats(state, seat)).total);
}

/** Seats with the top score. Several when tied. Meaningful once the game is over. */
export function winners(state: GameState): number[] {
  const s = scores(state);
  const best = Math.max(...s);
  return s.flatMap((n, seat) => (n === best ? [seat] : []));
}

/**
 * What the table does for a player who is away. Deterministic, so every
 * client that races to send it makes the same choice: the placement worth the
 * most points right now (first found on a tie, biggest cat preferred), or the
 * first cat at the door sent away if nothing fits.
 */
export function autoMove(state: GameState): Extract<Move, { kind: 'seat' | 'pass' }> {
  const seat = state.toAct ?? 0;
  const cats = floorCats(state, seat);
  const grid = gridOf(cats);
  const base = tally(cats).total;
  let best: { slot: number; orient: number; x: number; y: number; value: number } | null = null;
  let firstSlot = 0;
  let sawTile = false;
  parseMarket(state.market).forEach((tile, slot) => {
    if (!tile) return;
    if (!sawTile) {
      firstSlot = slot;
      sawTile = true;
    }
    for (const p of placements(grid, tile)) {
      const value = tally([...cats, { coat: tile.coat, cells: p.cells }]).total - base + p.cells.length * 0.1;
      if (!best || value > best.value) best = { slot, orient: p.orient, x: p.x, y: p.y, value };
    }
  });
  const found = best as { slot: number; orient: number; x: number; y: number } | null;
  return found
    ? { kind: 'seat', slot: found.slot, orient: found.orient, x: found.x, y: found.y }
    : { kind: 'pass', slot: firstSlot };
}

function commit(state: GameState, by: string, lastMove: Omit<LastMove, 'by'>): GameState {
  const toAct = seatOnTurn(state.picks, state.players.length, state.starter);
  return {
    ...state,
    phase: toAct === null ? 'gameover' : 'playing',
    toAct,
    turnUid: toAct === null ? ANY_PLAYER : state.players[toAct].uid,
    version: state.version + 1,
    lastMove: { by, ...lastMove },
  };
}

/** Take a tile for the player on turn. Shared by `seat`, `pass` and `away`. */
function pick(
  state: GameState,
  choice: Extract<Move, { kind: 'seat' | 'pass' }>,
  by: string,
  kind: 'seat' | 'pass' | 'away',
  rnd: Rnd,
): ApplyResult {
  const seat = state.toAct;
  if (state.phase !== 'playing' || seat === null) return { ok: false, error: 'The game is over.' };
  const slots = parseMarket(state.market);
  const tile: Tile | null = Number.isInteger(choice.slot) ? (slots[choice.slot] ?? null) : null;
  if (!tile) return { ok: false, error: 'That cat has already been taken.' };

  let cat: string | null = null;
  if (choice.kind === 'seat') {
    const { orient, x, y } = choice;
    const whole = [orient, x, y].every((n) => Number.isInteger(n) && n >= 0);
    if (!whole || orient > 7 || x >= RULES.W || y >= RULES.H) return { ok: false, error: 'That is not a spot on the floor.' };
    if (!fits(gridOf(floorCats(state, seat)), cellsAt(tile.shape, orient, x, y))) {
      return { ok: false, error: 'That cat does not fit there.' };
    }
    cat = encodeCat(tile, orient, x, y);
  }

  const n = state.players.length;
  const picks = state.picks + 1;
  let market = state.market.slice(0, choice.slot * 2) + EMPTY_SLOT + state.market.slice(choice.slot * 2 + 2);
  // The pick that ends a round brings the next round's cats to the door.
  if (picks % n === 0 && picks < totalPicks(n)) market = refill(market, rnd);

  const tileStr = `${tile.coat}${tile.shape}`;
  return {
    ok: true,
    state: commit(
      {
        ...state,
        market,
        picks,
        floors: state.floors.map((f, i) => (i === seat && cat ? f + cat : f)),
        players: state.players.map((p, i) => (i === seat ? { ...p, sitOut: kind === 'away' } : p)),
      },
      by,
      { kind, seat, tile: tileStr, cat },
    ),
  };
}

export function applyMove(state: GameState, move: Move, uid: string, rnd: Rnd): ApplyResult {
  const seatOfSender = state.players.findIndex((p) => p.uid === uid);
  if (seatOfSender < 0) return { ok: false, error: 'You are not playing in this game.' };

  switch (move.kind) {
    case 'seat':
    case 'pass':
      if (state.toAct !== seatOfSender) return { ok: false, error: 'It is not your turn.' };
      return pick(state, move, uid, move.kind, rnd);

    case 'away':
      // Who may act for an absent player is the database rules' call (they
      // can see presence; the engine cannot). The engine only refuses the
      // nonsensical case of moving "for" yourself.
      if (state.toAct === null) return { ok: false, error: 'The game is over.' };
      if (state.toAct === seatOfSender) return { ok: false, error: 'It is your own turn.' };
      return pick(state, autoMove(state), uid, 'away', rnd);

    case 'rematch': {
      if (state.phase !== 'gameover') return { ok: false, error: 'Finish this game first.' };
      const starter = (state.starter + 1) % state.players.length;
      return {
        ok: true,
        state: commit(
          {
            ...state,
            market: refill(EMPTY_SLOT.repeat(marketSize(state.players.length)), rnd),
            floors: state.players.map(() => ''),
            picks: 0,
            starter,
            gameNo: state.gameNo + 1,
            players: state.players.map((p) => ({ ...p, sitOut: false })),
          },
          uid,
          { kind: 'rematch', seat: starter, tile: null, cat: null },
        ),
      };
    }

    default:
      return { ok: false, error: 'Unknown move.' };
  }
}
