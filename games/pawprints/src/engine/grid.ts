/**
 * Board geometry. A board of `size × size` points is numbered row by row:
 * point (r, c) is `r * size + c`. Pure functions only; the reducer, the cats
 * and the board view all use them.
 */

/** The four line directions, as [dRow, dCol]: across, down, and the two diagonals. */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function rowOf(size: number, cell: number): number {
  return Math.floor(cell / size);
}

export function colOf(size: number, cell: number): number {
  return cell % size;
}

/** The point `steps` along direction (dr, dc) from `cell`, or -1 off the board. */
export function stepFrom(size: number, cell: number, dr: number, dc: number, steps: number): number {
  const r = rowOf(size, cell) + dr * steps;
  const c = colOf(size, cell) + dc * steps;
  return r < 0 || c < 0 || r >= size || c >= size ? -1 : r * size + c;
}

/**
 * The run of `mark` through `cell` in one direction, as the list of points
 * (cell included, in board order). `cell` itself is counted as `mark`
 * whatever the board says, so the same function asks "what if I played here?".
 */
export function runThrough(cells: string, size: number, cell: number, dr: number, dc: number, mark: string): number[] {
  const back: number[] = [];
  for (let k = 1; ; k++) {
    const p = stepFrom(size, cell, dr, dc, -k);
    if (p < 0 || cells[p] !== mark) break;
    back.unshift(p);
  }
  const out = [...back, cell];
  for (let k = 1; ; k++) {
    const p = stepFrom(size, cell, dr, dc, k);
    if (p < 0 || cells[p] !== mark) break;
    out.push(p);
  }
  return out;
}

/** The longest run of `mark` through `cell`, if it reaches `need`; else null. */
export function winningRun(cells: string, size: number, cell: number, mark: string, need: number): number[] | null {
  for (const [dr, dc] of DIRECTIONS) {
    const run = runThrough(cells, size, cell, dr, dc, mark);
    if (run.length >= need) return run;
  }
  return null;
}

/** Every run of `need` or more of one mark anywhere on the board, with its owner. */
export function allRuns(cells: string, size: number, need: number): { mark: string; run: number[] }[] {
  const out: { mark: string; run: number[] }[] = [];
  for (let cell = 0; cell < cells.length; cell++) {
    const mark = cells[cell];
    if (mark === '.') continue;
    for (const [dr, dc] of DIRECTIONS) {
      // Only start a run at its first point, so each one is found once.
      const prev = stepFrom(size, cell, dr, dc, -1);
      if (prev >= 0 && cells[prev] === mark) continue;
      const run = runThrough(cells, size, cell, dr, dc, mark);
      if (run.length >= need) out.push({ mark, run });
    }
  }
  return out;
}
