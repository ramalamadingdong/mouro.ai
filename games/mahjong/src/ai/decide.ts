/**
 * How the cats play. Depends only on the engine; randomness comes in as an
 * argument so tests can seed it.
 *
 * Everything rests on shanten — how many tiles a hand is from being ready —
 * and ukeire — how many unseen tiles would bring it a step closer.
 *
 * - easy: usually throws a tile that keeps the hand as close as possible,
 *   but often picks loosely, and calls pungs and chows on a whim.
 * - medium: always keeps shanten lowest, breaks ties by ukeire, calls only
 *   when the call brings the hand closer.
 * - hard: as medium, and also keeps pairs of scoring honours, leans a little
 *   towards one suit when the hand already does, prefers tiles others have
 *   already thrown, and folds — throws the safest tile — when another player
 *   has three sets on show and its own hand is still far off.
 *
 * Measured over 200 four-cat games (seats medium/hard/medium/hard), hard
 * finishes slightly ahead of medium; both finish well ahead of easy.
 */
import {
  PLAY_KINDS,
  WIND_EAST,
  chowTiles,
  claimOptions,
  countsOf,
  isDragon,
  isSuited,
  isTerminalOrHonor,
  kindOf,
  kongOptions,
  parseMelds,
  riichiOptions,
  rankOf,
  removeTiles,
  seatWind,
  selfWin,
  suitOf,
  tileOf,
  type ChowPos,
  type ClaimMark,
  type GameState,
  type Move,
} from '@/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

// ─── shanten ─────────────────────────────────────────────────────────────────

/** (sets, partials, pair) a group of tiles can be split into, packed as s*100 + p*10 + pair. */
type Shapes = number[];

const memo = new Map<string, Shapes>();

function shift(c: number[], kinds: number[], by: number): void {
  for (const k of kinds) c[k] += by;
}

/**
 * Every (sets, partials, pair) split of one suit (9 counts, with runs) or of
 * the honours (7 counts, no runs). Memoised by the counts, so a whole game
 * costs a few thousand distinct suit shapes.
 */
function groupShapes(c: number[], runs: boolean): Shapes {
  const key = (runs ? 'r' : 'h') + c.join('');
  const hit = memo.get(key);
  if (hit) return hit;
  const out = new Set<number>();
  const walk = (from: number, sets: number, partials: number, pair: number): void => {
    let k = from;
    while (k < c.length && c[k] === 0) k++;
    if (k === c.length) {
      out.add(sets * 100 + partials * 10 + pair);
      return;
    }
    if (c[k] >= 3) {
      c[k] -= 3;
      walk(k, sets + 1, partials, pair);
      c[k] += 3;
    }
    if (runs && k <= 6 && c[k + 1] > 0 && c[k + 2] > 0) {
      shift(c, [k, k + 1, k + 2], -1);
      walk(k, sets + 1, partials, pair);
      shift(c, [k, k + 1, k + 2], 1);
    }
    if (c[k] >= 2) {
      c[k] -= 2;
      if (!pair) walk(k, sets, partials, 1);
      walk(k, sets, partials + 1, pair);
      c[k] += 2;
    }
    if (runs && k <= 7 && c[k + 1] > 0) {
      shift(c, [k, k + 1], -1);
      walk(k, sets, partials + 1, pair);
      shift(c, [k, k + 1], 1);
    }
    if (runs && k <= 6 && c[k + 2] > 0) {
      shift(c, [k, k + 2], -1);
      walk(k, sets, partials + 1, pair);
      shift(c, [k, k + 2], 1);
    }
    c[k]--;
    walk(k + 1, sets, partials, pair);
    c[k]++;
  };
  walk(0, 0, 0, 0);
  const shapes = Array.from(out);
  if (memo.size > 100_000) memo.clear();
  memo.set(key, shapes);
  return shapes;
}

function regularShanten(c: number[], melds: number): number {
  const need = 4 - melds;
  // Combine the groups' shapes, keeping each (sets, partials, pair) once.
  let acc = new Set<number>([0]);
  const groups: [number[], boolean][] = [
    [c.slice(0, 9), true],
    [c.slice(9, 18), true],
    [c.slice(18, 27), true],
    [c.slice(27, 34), false],
  ];
  for (const [counts, runs] of groups) {
    const shapes = groupShapes(counts, runs);
    const nextAcc = new Set<number>();
    for (const a of acc) {
      for (const b of shapes) {
        const pair = (a % 10) + (b % 10);
        if (pair > 1) continue;
        const sets = Math.min(Math.floor(a / 100) + Math.floor(b / 100), need);
        const partials = Math.min(Math.floor(a / 10) % 10 + Math.floor(b / 10) % 10, 8);
        nextAcc.add(sets * 100 + partials * 10 + pair);
      }
    }
    acc = nextAcc;
  }
  let best = 8;
  for (const v of acc) {
    const sets = Math.floor(v / 100);
    const partials = Math.min(Math.floor(v / 10) % 10, need - sets);
    const sh = 8 - 2 * (sets + melds) - partials - (v % 10);
    if (sh < best) best = sh;
  }
  return best;
}

function orphansShanten(c: number[]): number {
  let kinds = 0;
  let pair = 0;
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (!isTerminalOrHonor(k) || c[k] === 0) continue;
    kinds += 1;
    if (c[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

/** -1 = complete, 0 = ready (one tile away), 1 = two away, … */
export function shanten(concealed: string, melds: number): number {
  const c = countsOf(concealed).slice(0, PLAY_KINDS);
  const regular = regularShanten(c, melds);
  return melds === 0 ? Math.min(regular, orphansShanten(c)) : regular;
}

// ─── what is still out there ─────────────────────────────────────────────────

/** Copies of each kind this seat cannot see (in the wall or in other hands). */
function unseen(state: GameState, seat: number): number[] {
  let seen = state.players[seat].hand;
  for (const p of state.players) seen += p.discards + parseMelds(p.melds).map((m) => m.tiles).join('');
  const c = countsOf(seen);
  return Array.from({ length: PLAY_KINDS }, (_, k) => Math.max(0, 4 - c[k]));
}

/** Unseen tiles that would lower the shanten of a 3n+1 hand. */
function ukeire(hand: string, melds: number, left: number[]): number {
  const base = shanten(hand, melds);
  let n = 0;
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (left[k] === 0) continue;
    if (shanten(hand + tileOf(k), melds) < base) n += left[k];
  }
  return n;
}

/** The best shanten reachable by discarding one tile from a 3n+2 hand. */
function bestAfterDiscard(hand: string, melds: number): number {
  let best = 9;
  for (const t of new Set(hand)) best = Math.min(best, shanten(removeTiles(hand, t) ?? hand, melds));
  return best;
}

function isValueHonor(state: GameState, seat: number, kind: number): boolean {
  return isDragon(kind) || kind === WIND_EAST + seatWind(state, seat) || kind === WIND_EAST + state.wind;
}

/** The suit a hand leans to, if 9+ of its suited tiles share one. */
function leaningSuit(hand: string, meldTiles: string): string | null {
  const counts = new Map<string, number>();
  for (const t of hand + meldTiles) {
    const k = kindOf(t);
    if (isSuited(k)) counts.set(suitOf(k), (counts.get(suitOf(k)) ?? 0) + 1);
  }
  for (const [suit, n] of counts) if (n >= 9) return suit;
  return null;
}

// ─── turn ────────────────────────────────────────────────────────────────────

/** Riichi: an open hand needs a yaku it can still make. True if this one has an obvious route. */
function openYakuRoute(state: GameState, seat: number, hand: string, meldTiles: string, meldKinds: number[]): boolean {
  // A pung of a scoring honour already on the table, or a pair of one in hand to pung.
  if (meldKinds.some((k) => isValueHonor(state, seat, k))) return true;
  const all = Array.from(hand + meldTiles, kindOf);
  // All simples (tanyao).
  if (all.every((k) => !isTerminalOrHonor(k))) return true;
  // One suit, with or without honours (honitsu / chinitsu).
  if (new Set(all.filter(isSuited).map(suitOf)).size === 1) return true;
  return false;
}

function chooseDiscard(state: GameState, seat: number, difficulty: Difficulty, random: () => number, only?: string[]): string {
  const p = state.players[seat];
  const melds = parseMelds(p.melds);
  const m = melds.length;
  const left = unseen(state, seat);
  const riichiRules = state.config.ruleset === 'riichi';
  const open = melds.some((x) => x.type !== 'hidden-kong');
  const options = Array.from(new Set(only ?? p.hand)).map((tile) => {
    const rest = removeTiles(p.hand, tile) ?? p.hand;
    return { tile, rest, sh: shanten(rest, m) };
  });
  const best = Math.min(...options.map((o) => o.sh));

  if (difficulty === 'easy') {
    const loose = options.filter((o) => o.sh <= best + 1);
    const pool = random() < 0.3 ? loose : options.filter((o) => o.sh === best);
    return pool[Math.floor(random() * pool.length)].tile;
  }

  // Hard cats fold when another player looks close (three sets on show) and
  // their own hand is still far off: throw the safest tile that does not set
  // the hand back more than one step.
  if (difficulty === 'hard' && best >= 1) {
    const threats = state.players.filter((q, i) => i !== seat && (q.riichi || parseMelds(q.melds).length >= 3));
    if (threats.length > 0) {
      const danger = (tile: string): number => {
        const k = kindOf(tile);
        let d = 0;
        for (const q of threats) {
          if (q.discards.includes(tile)) continue; // they threw it themselves
          d += isTerminalOrHonor(k) ? (left[k] <= 1 ? 0.2 : 1) : 2 + (isSuited(k) && rankOf(k) >= 3 && rankOf(k) <= 7 ? 1 : 0);
        }
        return d;
      };
      const safe = options.filter((o) => o.sh <= best + 1).sort((a, b) => danger(a.tile) - danger(b.tile) || a.sh - b.sh);
      return safe[0].tile;
    }
  }

  const thrown = countsOf(state.players.map((q) => q.discards).join(''));
  const suit = difficulty === 'hard' ? leaningSuit(p.hand, melds.map((x) => x.tiles).join('')) : null;
  let top = -Infinity;
  let picks: string[] = [];
  for (const o of options) {
    if (o.sh !== best) continue;
    const k = kindOf(o.tile);
    let value = ukeire(o.rest, m, left);
    // Lone honours and terminals are the least useful tiles to keep.
    if (isTerminalOrHonor(k)) value += 0.5;
    if (difficulty === 'hard') {
      if (isValueHonor(state, seat, k) && (p.hand.split(o.tile).length - 1) >= 2) value -= 6;
      if (suit && isSuited(k) && suitOf(k) !== suit) value += 1.5;
      value += Math.min(thrown[k], 3) * 0.25;
    }
    // Riichi, open hand: shed terminals and honours to keep tanyao alive.
    if (riichiRules && open && isTerminalOrHonor(k) && !isValueHonor(state, seat, k)) value += 3;
    if (value > top + 1e-9) {
      top = value;
      picks = [o.tile];
    } else if (Math.abs(value - top) < 1e-9) picks.push(o.tile);
  }
  return picks[Math.floor(random() * picks.length)];
}

function decideTurn(state: GameState, seat: number, difficulty: Difficulty, random: () => number): Move {
  if (selfWin(state)) return { kind: 'win', seat };
  const p = state.players[seat];
  // In riichi the drawn tile goes straight out.
  if (p.riichi && state.drawn) return { kind: 'discard', seat, tile: state.drawn };
  const ready = riichiOptions(state);
  if (ready.length > 0 && (difficulty !== 'easy' || random() < 0.6)) {
    return { kind: 'discard', seat, tile: chooseDiscard(state, seat, 'medium', random, ready), riichi: true };
  }
  const m = parseMelds(p.melds).length;
  const now = bestAfterDiscard(p.hand, m);
  for (const tile of kongOptions(state)) {
    const four = p.hand.split(tile).length - 1 === 4;
    if (!four) return { kind: 'kong', seat, tile }; // adding to a pung never hurts the hand
    const rest = removeTiles(p.hand, tile.repeat(4)) ?? p.hand;
    if (difficulty === 'easy' || shanten(rest, m + 1) <= now) return { kind: 'kong', seat, tile };
  }
  return { kind: 'discard', seat, tile: chooseDiscard(state, seat, difficulty, random) };
}

// ─── claims ──────────────────────────────────────────────────────────────────

function decideClaim(state: GameState, seat: number, difficulty: Difficulty, random: () => number): Move {
  const claim = state.claim;
  if (!claim) return { kind: 'claim', seat, call: 'pass' };
  const options: ClaimMark[] = claimOptions(state, seat, claim);
  if (options.includes('w')) return { kind: 'claim', seat, call: 'win' };

  const p = state.players[seat];
  const m = parseMelds(p.melds).length;
  const now = shanten(p.hand, m);
  const kind = kindOf(claim.tile);

  type Candidate = { move: Move; after: number };
  const candidates: Candidate[] = [];
  if (options.includes('k')) {
    const rest = removeTiles(p.hand, claim.tile.repeat(3)) ?? p.hand;
    candidates.push({ move: { kind: 'claim', seat, call: 'kong' }, after: shanten(rest, m + 1) });
  }
  if (options.includes('p')) {
    const rest = removeTiles(p.hand, claim.tile.repeat(2)) ?? p.hand;
    candidates.push({ move: { kind: 'claim', seat, call: 'pung' }, after: bestAfterDiscard(rest, m + 1) });
  }
  for (const pos of ['l', 'm', 'h'] as ChowPos[]) {
    if (!options.includes(pos)) continue;
    const pair = chowTiles(p.hand, claim.tile, pos);
    if (!pair) continue;
    const rest = removeTiles(p.hand, pair) ?? p.hand;
    candidates.push({ move: { kind: 'claim', seat, call: 'chow', chow: pos }, after: bestAfterDiscard(rest, m + 1) });
  }
  if (candidates.length === 0) return { kind: 'claim', seat, call: 'pass' };

  // Riichi: never call into a hand that can no longer make a yaku.
  if (state.config.ruleset === 'riichi') {
    const melds = parseMelds(p.melds);
    const meldTiles = melds.map((x) => x.tiles).join('');
    const meldKinds = melds.map((x) => x.kind);
    const keep = candidates.filter((c) => {
      if (c.move.kind !== 'claim') return false;
      if ((c.move.call === 'pung' || c.move.call === 'kong') && isValueHonor(state, seat, kind)) return true;
      return openYakuRoute(state, seat, p.hand, meldTiles + claim.tile, meldKinds);
    });
    if (keep.length === 0) return { kind: 'claim', seat, call: 'pass' };
    candidates.splice(0, candidates.length, ...keep);
  }

  // Scoring honours are worth a pung whatever it does to the shape.
  if (isValueHonor(state, seat, kind) && difficulty !== 'easy') {
    const pung = candidates.find((c) => c.move.kind === 'claim' && (c.move.call === 'pung' || c.move.call === 'kong'));
    if (pung) return pung.move;
  }

  candidates.sort((a, b) => a.after - b.after);
  const top = candidates[0];
  if (difficulty === 'easy') {
    return top.after <= now || random() < 0.4 ? top.move : { kind: 'claim', seat, call: 'pass' };
  }
  if (top.after >= now) return { kind: 'claim', seat, call: 'pass' };
  return top.move;
}

/**
 * The next move for the cat in `seat`, or null if that seat has nothing to
 * do right now.
 */
export function decide(state: GameState, seat: number, difficulty: Difficulty, random: () => number): Move | null {
  if (state.phase === 'turn' && state.toAct === seat) return decideTurn(state, seat, difficulty, random);
  if (state.phase === 'claim' && state.claim?.asks[seat] === '?') return decideClaim(state, seat, difficulty, random);
  return null;
}

/** Seats a cat has to move for in this state, in the order they should go. */
export function pendingSeats(state: GameState): number[] {
  if (state.phase === 'turn' && state.toAct !== null) return [state.toAct];
  if (state.phase === 'claim' && state.claim) {
    const from = state.claim.from;
    const n = state.players.length;
    return Array.from({ length: n - 1 }, (_, d) => (from + d + 1) % n).filter((s) => state.claim?.asks[s] === '?');
  }
  return [];
}

/**
 * The coach: what a careful player would do here, and one line on why.
 * Deterministic (no randomness), medium-level judgement.
 */
export function advise(state: GameState, seat: number): { move: Move; why: string } | null {
  const move = decide(state, seat, 'medium', () => 0);
  if (!move) return null;
  const p = state.players[seat];
  const m = parseMelds(p.melds).length;
  if (move.kind === 'win') return { move, why: 'That is a winning hand — declare it!' };
  if (move.kind === 'kong') return { move, why: 'Four of a kind: declaring the kong costs nothing and draws you a replacement.' };
  if (move.kind === 'claim') {
    if (move.call === 'win') return { move, why: 'This tile completes your hand — call it!' };
    if (move.call === 'pass') {
      const riichiRules = state.config.ruleset === 'riichi';
      return {
        move,
        why: riichiRules
          ? 'Calling would not bring your hand closer, or would leave it with no yaku. Keeping it closed keeps riichi open to you.'
          : 'Calling would not bring your hand any closer to complete.',
      };
    }
    return { move, why: `Calling ${move.call} brings your hand a step closer to complete.` };
  }
  if (move.kind !== 'discard') return { move, why: '' };
  const rest = removeTiles(p.hand, move.tile) ?? p.hand;
  const sh = shanten(rest, m);
  const left = unseen(state, seat);
  const good = ukeire(rest, m, left);
  if (move.riichi) return { move, why: 'Your hand is ready and closed: declare riichi for an extra han (and ura dora).' };
  if (sh === 0) return { move, why: `Throwing it leaves you ready — ${good} tiles still out there would win.` };
  const steps = sh === 1 ? 'one tile' : `${sh} tiles`;
  return { move, why: `Keeps your hand ${steps} from ready, with the most tiles (${good}) that would improve it.` };
}
