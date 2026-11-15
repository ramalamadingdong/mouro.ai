/**
 * Board geometry. A board of `cols × rows` boxes has `(cols+1) × (rows+1)`
 * dots and two kinds of edge, numbered in one flat index space:
 *
 *   horizontal  h(r, c) = r * cols + c                 r in 0..rows,   c in 0..cols-1
 *   vertical    v(r, c) = H + r * (cols + 1) + c       r in 0..rows-1, c in 0..cols
 *
 * where H = (rows + 1) * cols is the number of horizontal edges. Box (r, c)
 * is `r * cols + c` and is bounded by h(r, c), h(r+1, c), v(r, c), v(r, c+1).
 *
 * Pure functions only; the reducer, the cats and the board view all use them.
 */

export interface Size {
  cols: number;
  rows: number;
}

export function horizontalCount({ cols, rows }: Size): number {
  return (rows + 1) * cols;
}

export function edgeCount(size: Size): number {
  return horizontalCount(size) + size.rows * (size.cols + 1);
}

export function boxCount({ cols, rows }: Size): number {
  return cols * rows;
}

export function hEdge(size: Size, r: number, c: number): number {
  return r * size.cols + c;
}

export function vEdge(size: Size, r: number, c: number): number {
  return horizontalCount(size) + r * (size.cols + 1) + c;
}

/** The four edges around box `b`: top, bottom, left, right. */
export function boxEdges(size: Size, b: number): [number, number, number, number] {
  const r = Math.floor(b / size.cols);
  const c = b % size.cols;
  return [hEdge(size, r, c), hEdge(size, r + 1, c), vEdge(size, r, c), vEdge(size, r, c + 1)];
}

/** The one or two boxes an edge borders. */
export function edgeBoxes(size: Size, e: number): number[] {
  const H = horizontalCount(size);
  const out: number[] = [];
  if (e < H) {
    const r = Math.floor(e / size.cols);
    const c = e % size.cols;
    if (r > 0) out.push((r - 1) * size.cols + c);
    if (r < size.rows) out.push(r * size.cols + c);
  } else {
    const i = e - H;
    const r = Math.floor(i / (size.cols + 1));
    const c = i % (size.cols + 1);
    if (c > 0) out.push(r * size.cols + c - 1);
    if (c < size.cols) out.push(r * size.cols + c);
  }
  return out;
}

/** Dot coordinates (column, row) of an edge's two ends. */
export function edgeEnds(size: Size, e: number): [[number, number], [number, number]] {
  const H = horizontalCount(size);
  if (e < H) {
    const r = Math.floor(e / size.cols);
    const c = e % size.cols;
    return [
      [c, r],
      [c + 1, r],
    ];
  }
  const i = e - H;
  const r = Math.floor(i / (size.cols + 1));
  const c = i % (size.cols + 1);
  return [
    [c, r],
    [c, r + 1],
  ];
}

export function isHorizontal(size: Size, e: number): boolean {
  return e < horizontalCount(size);
}
