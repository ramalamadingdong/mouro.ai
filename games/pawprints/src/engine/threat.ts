/**
 * How promising a point is, for one seat. Shared by `autoCell` (the move the
 * table makes for an absent player) and the computer cats in `src/ai`.
 *
 * The measure is the classic "window" count: every straight stretch of
 * `need` points through the candidate that holds no other seat's paw is a
 * line this seat could still finish there. Each such window is worth more the
 * fuller it already is. An open three shows up as several nearly full
 * windows, a blocked one as fewer, so openness is counted without any
 * pattern tables. Pure; no randomness.
 */
import { DIRECTIONS, stepFrom } from './grid';
import { EMPTY } from './types';

/** Worth of one window by how many paws short of a line it would be after playing. */
const WINDOW = [1e8, 2500, 120, 12, 1] as const;

export function windowWorth(short: number): number {
  return WINDOW[Math.min(Math.max(short, 0), WINDOW.length - 1)];
}

/** Sum of the windows through `cell` that `mark` could still complete, as if it played `cell`. */
export function attackScore(cells: string, size: number, cell: number, mark: string, need: number): number {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    for (let offset = 0; offset < need; offset++) {
      let own = 0;
      let blocked = false;
      for (let k = 0; k < need; k++) {
        const p = stepFrom(size, cell, dr, dc, k - offset);
        if (p < 0) {
          blocked = true;
          break;
        }
        const ch = p === cell ? mark : cells[p];
        if (ch === mark) own++;
        else if (ch !== EMPTY) {
          blocked = true;
          break;
        }
      }
      if (!blocked) total += windowWorth(need - own);
    }
  }
  return total;
}

/** True when `mark` playing `cell` makes a line of `need`. */
export function wins(cells: string, size: number, cell: number, mark: string, need: number): boolean {
  if (cells[cell] !== EMPTY) return false;
  for (const [dr, dc] of DIRECTIONS) {
    let run = 1;
    for (const sign of [1, -1]) {
      for (let k = 1; ; k++) {
        const p = stepFrom(size, cell, dr, dc, sign * k);
        if (p < 0 || cells[p] !== mark) break;
        run++;
      }
    }
    if (run >= need) return true;
  }
  return false;
}

/**
 * The empty points worth considering: within two steps of any paw, or the
 * middle of the board when it is empty. Ascending order.
 */
export function candidates(cells: string, size: number): number[] {
  const near = new Uint8Array(cells.length);
  let any = false;
  for (let cell = 0; cell < cells.length; cell++) {
    if (cells[cell] === EMPTY) continue;
    any = true;
    const r = Math.floor(cell / size);
    const c = cell % size;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < size && cc < size) near[rr * size + cc] = 1;
      }
    }
  }
  const middle = Math.floor(size / 2) * size + Math.floor(size / 2);
  if (!any) return [middle];
  const out: number[] = [];
  for (let cell = 0; cell < cells.length; cell++) if (near[cell] && cells[cell] === EMPTY) out.push(cell);
  if (out.length === 0) for (let cell = 0; cell < cells.length; cell++) if (cells[cell] === EMPTY) out.push(cell);
  return out;
}

/** How much the defence counts against the attack. Just under 1: a line of your own beats blocking an equal one. */
export const DEFENCE = 0.85;

/** Attack for `seat` plus defence against every other seat, at `cell`. */
export function cellScore(cells: string, size: number, cell: number, seat: number, players: number, need: number): number {
  let score = attackScore(cells, size, cell, String(seat), need);
  for (let other = 0; other < players; other++) {
    if (other !== seat) score += DEFENCE * attackScore(cells, size, cell, String(other), need);
  }
  return score;
}

/** Squared distance from the middle; nearer the middle breaks ties. */
export function centrality(size: number, cell: number): number {
  const mid = (size - 1) / 2;
  const r = Math.floor(cell / size) - mid;
  const c = (cell % size) - mid;
  return r * r + c * c;
}
