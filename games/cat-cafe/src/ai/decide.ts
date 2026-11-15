/**
 * How a computer cat picks. Pure: the state in, a move out, randomness passed
 * in as an argument.
 *
 * Every legal placement of every cat at the door gets a value, and the best
 * one wins. Difficulty is what goes into that value:
 *
 *   easy    the points on offer, and a great deal of noise — it often takes
 *           a pretty cat over a good one.
 *   medium  points, plus a liking for big cats while there is room.
 *   hard    also avoids leaving gaps nothing can fill, builds toward full
 *           rows, and weighs what the cat would be worth to the next player.
 */
import {
  autoMove,
  floorCats,
  gridOf,
  parseMarket,
  placements,
  tally,
  RULES,
  type GameState,
  type Move,
  type Rnd,
  type Tile,
  type PlacedCat,
} from '@/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

const NOISE: Record<Difficulty, number> = { easy: 20, medium: 2, hard: 0.3 };

/** Cost of the awkward gaps on a floor: a lone empty square can never be filled, a pair rarely. */
export function gapCost(grid: readonly number[]): number {
  const { W, H } = RULES;
  const seen = new Uint8Array(W * H);
  let cost = 0;
  for (let i = 0; i < W * H; i++) {
    if (grid[i] >= 0 || seen[i]) continue;
    let n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % W;
      const y = Math.floor(j / W);
      n++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = ny * W + nx;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && grid[k] < 0 && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (n === 1) cost += 2.5;
    else if (n === 2) cost += 1;
  }
  return cost;
}

/** How close the unfinished rows are to done (nearly-full rows count for much more). */
function rowPromise(grid: readonly number[]): number {
  const { W, H } = RULES;
  let p = 0;
  for (let y = 0; y < H; y++) {
    let f = 0;
    for (let x = 0; x < W; x++) if (grid[y * W + x] >= 0) f++;
    if (f < W) p += (f / W) ** 2;
  }
  return p;
}

/** The most points the owner of `cats` could make right now with `tile` (0 if it fits nowhere). */
function bestGain(cats: PlacedCat[], tile: Tile): number {
  const base = tally(cats).total;
  let best = 0;
  for (const p of placements(gridOf(cats), tile)) {
    best = Math.max(best, tally([...cats, { coat: tile.coat, cells: p.cells }]).total - base);
  }
  return best;
}

/** The move for the cat on turn. Falls back to the table's own choice if nothing fits. */
export function decide(state: GameState, difficulty: Difficulty, rnd: Rnd): Extract<Move, { kind: 'seat' | 'pass' }> {
  const seat = state.toAct;
  if (seat === null) return { kind: 'pass', slot: 0 };
  const mine = floorCats(state, seat);
  const next = floorCats(state, (seat + 1) % state.players.length);
  const g0 = gridOf(mine);
  const base = tally(mine).total;
  const gap0 = gapCost(g0);
  const promise0 = rowPromise(g0);

  let best: { slot: number; orient: number; x: number; y: number; value: number } | null = null;
  parseMarket(state.market).forEach((tile, slot) => {
    if (!tile) return;
    const deny = difficulty === 'hard' ? bestGain(next, tile) * 0.35 : 0;
    for (const p of placements(g0, tile)) {
      const cats = [...mine, { coat: tile.coat, cells: p.cells }];
      let value = tally(cats).total - base;
      if (difficulty !== 'easy') value += p.cells.length * 0.5;
      if (difficulty === 'hard') {
        const g = gridOf(cats);
        value += deny - (gapCost(g) - gap0) + (rowPromise(g) - promise0) * 2;
      }
      value += (rnd() - 0.5) * NOISE[difficulty];
      if (!best || value > best.value) best = { slot, orient: p.orient, x: p.x, y: p.y, value };
    }
  });
  const found = best as { slot: number; orient: number; x: number; y: number } | null;
  return found ? { kind: 'seat', slot: found.slot, orient: found.orient, x: found.x, y: found.y } : autoMove(state);
}
