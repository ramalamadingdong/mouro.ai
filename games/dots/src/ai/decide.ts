/**
 * How a computer cat picks its line. Depends only on the engine.
 *
 * The three levels are the three stages most people go through learning the
 * game:
 *
 *  - easy    grabs most boxes it sees, avoids most giveaways, and sometimes
 *            just draws anything;
 *  - medium  always takes a free box, never gives one away while a safe line
 *            exists, and when forced, gives away as little as it can;
 *  - hard    medium, plus the endgame trick that decides most real games:
 *            at the end of a chain it can decline the last two boxes (the
 *            "double-cross") so the opponent has to open the next chain; and
 *            when it must hand over a pair, it draws the middle line so the
 *            opponent cannot do the same to it.
 *
 * `rng` is passed in so tests can be deterministic; the app passes Math.random.
 */
import { boxEdges, edgeBoxes, EMPTY, type GameState, type Size } from '@/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

interface Board {
  size: Size;
  /** 1 = drawn. */
  drawn: Uint8Array;
  claimed: Uint8Array;
}

function boardOf(state: GameState): Board {
  return {
    size: state.config,
    drawn: Uint8Array.from(state.edges, (ch) => (ch === EMPTY ? 0 : 1)),
    claimed: Uint8Array.from(state.boxes, (ch) => (ch === EMPTY ? 0 : 1)),
  };
}

function sides(board: Board, b: number): number {
  let n = 0;
  for (const e of boxEdges(board.size, b)) n += board.drawn[e];
  return n;
}

function missing(board: Board, b: number): number[] {
  return boxEdges(board.size, b).filter((e) => board.drawn[e] === 0);
}

function freeEdges(board: Board): number[] {
  const out: number[] = [];
  for (let e = 0; e < board.drawn.length; e++) if (board.drawn[e] === 0) out.push(e);
  return out;
}

function closes(board: Board, e: number): boolean {
  return edgeBoxes(board.size, e).some((b) => sides(board, b) === 3);
}

/** Gives nothing away: no neighbouring box would be left with three sides. */
function isSafe(board: Board, e: number): boolean {
  return edgeBoxes(board.size, e).every((b) => sides(board, b) < 2);
}

/** How many boxes the next player could take in a row if we drew `e` (without it closing anything for us). */
function giveaway(board: Board, e: number): number {
  const drawn = board.drawn.slice();
  drawn[e] = 1;
  const claimed = board.claimed.slice();
  const sim: Board = { size: board.size, drawn, claimed };
  let taken = 0;
  for (;;) {
    let progressed = false;
    for (let b = 0; b < claimed.length; b++) {
      if (claimed[b] || sides(sim, b) !== 3) continue;
      const [gap] = missing(sim, b);
      drawn[gap] = 1;
      // A line can close two boxes at once: count both.
      for (const x of edgeBoxes(board.size, gap)) {
        if (!claimed[x] && sides(sim, x) === 4) {
          claimed[x] = 1;
          taken += 1;
        }
      }
      progressed = true;
    }
    if (!progressed) return taken;
  }
}

const pick = <T,>(list: readonly T[], rng: () => number): T => list[Math.floor(rng() * list.length) % list.length];

/** Fewest boxes handed over; for the hard cat, ties go to the middle of a pair. */
function leastBad(board: Board, free: number[], rng: () => number, hard: boolean): number {
  let best = Infinity;
  let options: number[] = [];
  for (const e of free) {
    const n = giveaway(board, e);
    if (n < best) {
      best = n;
      options = [e];
    } else if (n === best) {
      options.push(e);
    }
  }
  if (hard && best === 2) {
    const middles = options.filter((e) => {
      const bs = edgeBoxes(board.size, e);
      return bs.length === 2 && bs.every((b) => sides(board, b) === 2);
    });
    if (middles.length > 0) return pick(middles, rng);
  }
  return pick(options, rng);
}

/**
 * The double-cross. Only when no safe line is left anywhere and the one box we
 * could take is the end of a two-box chain: draw the far side of the pair
 * instead, handing both boxes over and making the opponent open the next
 * chain. Worth it when at least three boxes are still in play elsewhere.
 */
function doubleCross(board: Board, completers: number[]): number | null {
  const capturable: number[] = [];
  for (let b = 0; b < board.claimed.length; b++) if (!board.claimed[b] && sides(board, b) === 3) capturable.push(b);
  if (capturable.length !== 1) return null;
  const a = capturable[0];
  const [ea] = missing(board, a);
  if (!completers.includes(ea)) return null;
  const b = edgeBoxes(board.size, ea).find((x) => x !== a);
  if (b === undefined || board.claimed[b] || sides(board, b) !== 2) return null;
  const eb = missing(board, b).find((e) => e !== ea);
  if (eb === undefined) return null;
  const c = edgeBoxes(board.size, eb).find((x) => x !== b);
  if (c !== undefined && sides(board, c) >= 2) return null; // the chain goes on past b
  let open = 0;
  for (let x = 0; x < board.claimed.length; x++) if (!board.claimed[x]) open++;
  return open - 2 >= 3 ? eb : null;
}

/** The edge this cat draws. The state must have a cat on turn. */
export function decide(state: GameState, difficulty: Difficulty, rng: () => number): number {
  const board = boardOf(state);
  const free = freeEdges(board);
  const completers = free.filter((e) => closes(board, e));
  const safe = free.filter((e) => !closes(board, e) && isSafe(board, e));

  if (difficulty === 'easy') {
    if (completers.length > 0 && rng() < 0.75) return pick(completers, rng);
    if (safe.length > 0 && rng() < 0.85) return pick(safe, rng);
    return pick(free, rng);
  }

  if (completers.length > 0) {
    if (difficulty === 'hard' && safe.length === 0) {
      const cross = doubleCross(board, completers);
      if (cross !== null) return cross;
    }
    return pick(completers, rng);
  }
  if (safe.length > 0) return pick(safe, rng);
  return leastBad(board, free, rng, difficulty === 'hard');
}
