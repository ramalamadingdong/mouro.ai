/**
 * How a computer cat picks its point. Depends only on the engine.
 *
 * Every level scores the candidate points with the engine's window count
 * (`cellScore`: its own lines plus the lines it would block). They differ in
 * how carefully they use it:
 *
 *  - easy    usually finishes a line and usually blocks one, otherwise picks
 *            among the better-looking points, and sometimes just wanders;
 *  - medium  always finishes a line, always blocks the next player's, and
 *            otherwise plays the best-scoring point;
 *  - hard    medium, plus a look one move ahead: of the best few points it
 *            prefers the one that leaves the opponents the least to work with,
 *            and it plays a double threat (two lines one short at once)
 *            whenever it has one.
 *
 * `rng` is passed in so tests can be deterministic; the app passes Math.random.
 */
import { attackScore, candidates, cellScore, need, wins, windowWorth, type GameState } from '@/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

const pick = <T,>(list: readonly T[], rng: () => number): T => list[Math.floor(rng() * list.length) % list.length];

function replaceAt(s: string, i: number, ch: string): string {
  return s.slice(0, i) + ch + s.slice(i + 1);
}

interface Scored {
  cell: number;
  score: number;
}

function ranked(state: GameState, seat: number, list: number[]): Scored[] {
  const size = state.config.size;
  const n = state.players.length;
  const k = need(state);
  return list
    .map((cell) => ({ cell, score: cellScore(state.cells, size, cell, seat, n, k) }))
    .sort((a, b) => b.score - a.score || a.cell - b.cell);
}

/** Points where `mark` would be one short of a line in two different windows-or-more: a fork. */
function threatsAfter(cells: string, size: number, mark: string, k: number): number {
  let n = 0;
  for (const c of candidates(cells, size)) if (wins(cells, size, c, mark, k)) n++;
  return n;
}

/** The point this cat plays. The state must have a cat on turn. */
export function decide(state: GameState, difficulty: Difficulty, rng: () => number): number {
  const seat = state.toAct ?? 0;
  const size = state.config.size;
  const n = state.players.length;
  const k = need(state);
  const mark = String(seat);
  const list = candidates(state.cells, size);

  const finish = list.filter((c) => wins(state.cells, size, c, mark, k));
  // The next player's winning points come first: they move before anyone else.
  const blocks: number[] = [];
  for (let step = 1; step < n && blocks.length === 0; step++) {
    const other = String((seat + step) % n);
    for (const c of list) if (wins(state.cells, size, c, other, k)) blocks.push(c);
  }

  if (difficulty === 'easy') {
    if (finish.length > 0 && rng() < 0.75) return pick(finish, rng);
    if (blocks.length > 0 && rng() < 0.6) return pick(blocks, rng);
    if (rng() < 0.15) return pick(list, rng);
    const top = ranked(state, seat, list).slice(0, 6);
    return pick(top, rng).cell;
  }

  if (finish.length > 0) return pick(finish, rng);
  if (blocks.length > 0) {
    // Of several blocks, the one that also builds our own line.
    return ranked(state, seat, blocks)[0].cell;
  }

  const scored = ranked(state, seat, list);
  if (difficulty === 'medium') {
    const best = scored[0].score;
    const near = scored.filter((s) => s.score >= best * 0.97);
    return pick(near, rng).cell;
  }

  // hard: a fork wins outright, so take one if there is one.
  const top = scored.slice(0, 10);
  for (const { cell } of top) {
    const after = replaceAt(state.cells, cell, mark);
    if (threatsAfter(after, size, mark, k) >= 2) return cell;
  }
  // Otherwise look one move ahead: what is the best the next player could do after us?
  const nextMark = String((seat + 1) % n);
  let best = top[0].cell;
  let bestValue = -Infinity;
  for (const { cell, score } of top.slice(0, 8)) {
    const after = replaceAt(state.cells, cell, mark);
    let reply = 0;
    for (const c of candidates(after, size)) {
      reply = Math.max(reply, attackScore(after, size, c, nextMark, k));
    }
    // A reply that makes an open four (two windows one short) is a loss coming.
    const value = score - 0.6 * reply - (reply >= 2 * windowWorth(1) ? windowWorth(1) : 0);
    if (value > bestValue) {
      bestValue = value;
      best = cell;
    }
  }
  return best;
}
