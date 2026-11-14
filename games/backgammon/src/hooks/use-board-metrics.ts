/**
 * Board geometry — ONE source of truth.
 *
 * Every static position and every animation target comes from this object, so
 * the flying-checker overlay can never drift from where the checkers actually
 * sit. Nothing in the board layer may compute a coordinate any other way.
 *
 * ── Why this is not `useResponsiveScale` ─────────────────────────────────────
 * The gin rummy app scales cards with a single multiplier over fixed sizes,
 * because a hand is a flow layout that can wrap. A backgammon board is a rigid
 * grid: 12 points, a bar and a rail must all fit across the width, at once. So
 * the scale is derived from the available WIDTH first and then clamped by
 * height, rather than picked and hoped for.
 *
 * ── The layout, in the viewer's own frame ────────────────────────────────────
 * You are always at the bottom. Own index 0 is the bottom-right point (what a
 * player calls their 1 point) and 23 is the top-right, so the path runs
 * anticlockwise: down the right side, along the top... and bears off into the
 * bottom-right tray. That is a real board, not a mirror of one.
 *
 *   columns 0..5   left half      columns 6..11  right half
 *   bottom row     own 11..0      (column = 11 - own)
 *   top row        own 12..23     (column = own - 12)
 */
import { useWindowDimensions } from 'react-native';

/** The outer column never grows past this, matching the gin rummy app. */
export const TABLE_MAX_WIDTH = 820;

/** Geometry at scale 1, in px. Everything else is these times `scale`. */
const BASE = {
  ptW: 23,
  triH: 120,
  midH: 46,
  barW: 26,
  railW: 26,
  ch: 20,
} as const;

const BASE_W = BASE.ptW * 12 + BASE.barW + BASE.railW; // 328
const BASE_H = BASE.triH * 2 + BASE.midH; // 286

/** Fraction of the viewport height the board block may occupy. */
const HEIGHT_BUDGET = 0.62;

export interface Pos {
  x: number;
  y: number;
}

export interface PointGeom extends Pos {
  /** 0..11, left to right across the play area. */
  col: number;
  /** True for the bottom row, whose triangles point UP. */
  up: boolean;
}

export interface BoardMetrics {
  scale: number;
  boardW: number;
  boardH: number;
  ptW: number;
  triH: number;
  midH: number;
  barW: number;
  railW: number;
  ch: number;
  /** Left edge of the bar column. */
  barX: number;
  /** Left edge of the right rail. */
  railX: number;
  /** Vertical centre of the play field. */
  midY: number;
  /** Vertical spacing between stacked checkers on a point holding `count`. */
  pitch: (count: number) => number;
  /** How many checkers to actually draw for a stack of `count`. */
  drawn: (count: number) => number;
  /** Top-left of a point's ptW x triH box, in board coordinates. */
  pointXY: (own: number) => PointGeom;
  /** Top-left of the k-th checker (0 = nearest the outer edge) on a point. */
  checkerXY: (own: number, k: number, count: number) => Pos;
  /** Top-left of the k-th checker on the bar. */
  barXY: (mine: boolean, k: number) => Pos;
  /** Top-left of the k-th borne-off checker in a tray. */
  trayXY: (mine: boolean, k: number) => Pos;
  /** Height of one borne-off checker's edge-on bar. */
  trayBarH: number;
  /** Top-left of the doubling cube, given who owns it. */
  cubeXY: (owner: 'mine' | 'theirs' | 'centre') => Pos;
  cubeSize: number;
  /** Top-left of die `i` (0 or 1, or 0..3 for doubles) in the middle strip. */
  dieXY: (i: number, count: number) => Pos;
  dieSize: number;
}

/** The largest stack drawn checker-by-checker before a count badge takes over. */
const MAX_DRAWN = 8;

/**
 * @param scale     horizontal scale — sets point width and checker size
 * @param stretch   extra VERTICAL scale for the triangles and the middle strip
 *
 * The two are separate because a backgammon board is wider than it is tall, and
 * a portrait phone is the other way round: fitting 12 points across pins the
 * width long before the height runs out, leaving a large dead band under the
 * board. Letting the points grow longer fills it, gives tall stacks more room
 * to breathe, and is perfectly ordinary — real boards vary a lot in how long
 * their points are.
 */
export function buildMetrics(scale: number, stretch = 1): BoardMetrics {
  const ptW = BASE.ptW * scale;
  const triH = BASE.triH * scale * stretch;
  const midH = BASE.midH * scale * stretch;
  const barW = BASE.barW * scale;
  const railW = BASE.railW * scale;
  const ch = BASE.ch * scale;

  const boardW = ptW * 12 + barW + railW;
  const boardH = triH * 2 + midH;
  const barX = ptW * 6;
  const railX = boardW - railW;
  const midY = triH + midH / 2;
  const trayBarH = Math.max(3, 4 * scale);
  const cubeSize = Math.min(railW - 4 * scale, 22 * scale);
  const dieSize = Math.min(midH - 10 * scale, 24 * scale);

  const pitch = (count: number) => Math.min(ch, (triH - ch) / Math.max(1, count - 1));
  const drawn = (count: number) => Math.min(count, MAX_DRAWN);

  const pointXY = (own: number): PointGeom => {
    const up = own < 12;
    const col = up ? 11 - own : own - 12;
    const x = col * ptW + (col >= 6 ? barW : 0);
    const y = up ? boardH - triH : 0;
    return { x, y, col, up };
  };

  const checkerXY = (own: number, k: number, count: number): Pos => {
    const { x, up } = pointXY(own);
    const p = pitch(count);
    const cx = x + (ptW - ch) / 2;
    // k counts inward from the board edge, so a stack always grows toward the
    // middle no matter which row it is on.
    const cy = up ? boardH - ch - k * p : k * p;
    return { x: cx, y: cy };
  };

  const barXY = (mine: boolean, k: number): Pos => {
    const p = ch * 0.8;
    const x = barX + (barW - ch) / 2;
    const gap = 6 * scale;
    const y = mine ? midY + gap + k * p : midY - gap - ch - k * p;
    return { x, y };
  };

  const trayXY = (mine: boolean, k: number): Pos => {
    const x = railX + 3 * scale;
    const gap = 6 * scale;
    const y = mine ? boardH - gap - (k + 1) * trayBarH : gap + k * trayBarH;
    return { x, y };
  };

  const cubeXY = (owner: 'mine' | 'theirs' | 'centre'): Pos => {
    const x = railX + (railW - cubeSize) / 2;
    if (owner === 'centre') return { x, y: midY - cubeSize / 2 };
    // Just inside the owner's tray, so "who has the cube" is readable at a
    // glance from which end of the rail it sits at.
    const inset = trayBarH * 16 + 12 * scale;
    return { x, y: owner === 'mine' ? boardH - inset - cubeSize : inset };
  };

  const dieXY = (i: number, count: number): Pos => {
    const gap = 6 * scale;
    const total = count * dieSize + (count - 1) * gap;
    // Centred in the RIGHT half of the strip, the side the player rolls into.
    const half = barX + barW + ptW * 3;
    const x = half - total / 2 + i * (dieSize + gap);
    return { x, y: midY - dieSize / 2 };
  };

  return {
    scale,
    boardW,
    boardH,
    ptW,
    triH,
    midH,
    barW,
    railW,
    ch,
    barX,
    railX,
    midY,
    pitch,
    drawn,
    pointXY,
    checkerXY,
    barXY,
    trayXY,
    trayBarH,
    cubeXY,
    cubeSize,
    dieXY,
    dieSize,
  };
}

/** How much longer than the base aspect the points may grow. */
const MAX_STRETCH = 1.5;

/** Board metrics sized to the current viewport. */
export function useBoardMetrics(): BoardMetrics {
  const { width, height } = useWindowDimensions();
  const availW = Math.min(width, TABLE_MAX_WIDTH) - 16;
  const availH = height * HEIGHT_BUDGET;
  const raw = Math.min(availW / BASE_W, availH / BASE_H);
  // The lower bound is below 1 on purpose: a 320px-wide phone cannot fit the
  // base size, and shrinking is far better than overflowing off-screen.
  const scale = Math.max(0.75, Math.min(2.4, raw));
  // Spend whatever height is left over on longer points rather than on a gap.
  const stretch = Math.max(1, Math.min(MAX_STRETCH, availH / (BASE_H * scale)));
  return buildMetrics(scale, stretch);
}
