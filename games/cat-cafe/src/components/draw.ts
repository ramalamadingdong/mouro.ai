/**
 * The artwork: floors, cats and badges as SVG markup strings, in "floor
 * units" where one square is 100 × 100.
 *
 * Strings rather than React elements because a floor is redrawn whole on
 * every pointer move while a cat is being aimed, and because every value that
 * reaches the markup is a number or a key of COATS — nothing from a player.
 * Pure: no React, no DOM.
 */
import { RULES, tally, type Cell, type Coat, type Link, type Mood } from '@/engine';

export const U = 100;

interface Paint {
  fill: string;
  face: string;
  edge: string;
  ink: string;
  eye: string;
}

export const PAINT: Record<Coat, Paint> = {
  g: { fill: '#ef9140', face: '#f8ad66', edge: '#b05c17', ink: '#4a2508', eye: '#4a2508' },
  s: { fill: '#8f9cb3', face: '#a9b5c9', edge: '#525e75', ink: '#1f2735', eye: '#1f2735' },
  t: { fill: '#37323f', face: '#474152', edge: '#131018', ink: '#2a2530', eye: '#f1df6e' },
  w: { fill: '#fffaf1', face: '#ffffff', edge: '#ad9878', ink: '#4b3f33', eye: '#4b3f33' },
};

export type FaceMood = Mood | 'awake';

const f1 = (n: number): string => n.toFixed(1);

/** Outline of a set of squares as one rounded path, pulled in by `inset`. */
export function outline(cells: readonly Cell[], inset = 5, radius = 24): string {
  const has = new Set(cells.map((c) => c.join()));
  const next = new Map<string, [number, number]>();
  const edge = (x1: number, y1: number, x2: number, y2: number): void => void next.set(`${x1},${y1}`, [x2, y2]);
  for (const [x, y] of cells) {
    if (!has.has(`${x},${y - 1}`)) edge(x, y, x + 1, y);
    if (!has.has(`${x + 1},${y}`)) edge(x + 1, y, x + 1, y + 1);
    if (!has.has(`${x},${y + 1}`)) edge(x + 1, y + 1, x, y + 1);
    if (!has.has(`${x - 1},${y}`)) edge(x, y + 1, x, y);
  }
  // Walk the loop clockwise from any boundary corner, keeping only the turns.
  const first = next.keys().next().value;
  if (first === undefined) return '';
  const start = first.split(',').map(Number) as [number, number];
  const pts: { p: [number, number]; dir: [number, number] }[] = [];
  let p = start;
  let prev: [number, number] | null = null;
  do {
    const q = next.get(p.join());
    if (!q) return '';
    const dir: [number, number] = [q[0] - p[0], q[1] - p[1]];
    if (!prev || dir[0] !== prev[0] || dir[1] !== prev[1]) pts.push({ p, dir });
    prev = dir;
    p = q;
  } while (p[0] !== start[0] || p[1] !== start[1]);
  // The first point is only a corner if the loop turns there.
  const last = pts[pts.length - 1].dir;
  if (pts[0].dir[0] === last[0] && pts[0].dir[1] === last[1]) pts.shift();
  const n = pts.length;
  const corners = pts.map(({ p: [x, y], dir }, i) => {
    const before = pts[(i + n - 1) % n].dir;
    // Inward normal of a clockwise edge (dx, dy) is (-dy, dx).
    return [x * U + inset * (-before[1] - dir[1]), y * U + inset * (before[0] + dir[0])];
  });
  let d = '';
  corners.forEach((c, i) => {
    const toward = (t: number[]): number[] => {
      const len = Math.hypot(t[0] - c[0], t[1] - c[1]);
      const r = Math.min(radius, len / 2);
      return [c[0] + ((t[0] - c[0]) / len) * r, c[1] + ((t[1] - c[1]) / len) * r];
    };
    const p1 = toward(corners[(i + n - 1) % n]);
    const p2 = toward(corners[(i + 1) % n]);
    d += `${i ? 'L' : 'M'}${f1(p1[0])} ${f1(p1[1])}Q${f1(c[0])} ${f1(c[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  });
  return `${d}Z`;
}

/** A cat's face, always upright, centred on (cx, cy). */
export function face(cx: number, cy: number, coat: Coat, mood: FaceMood): string {
  const c = PAINT[coat];
  const ear = (s: number): string =>
    `<path d="M${cx + s * 31} ${cy - 4}L${cx + s * 28} ${cy - 38}L${cx + s * 4} ${cy - 20}Z" fill="${c.face}" stroke="${c.edge}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M${cx + s * 25} ${cy - 13}L${cx + s * 24} ${cy - 29}L${cx + s * 12} ${cy - 20}Z" fill="#f2a7ae"/>`;
  const stroke = `fill="none" stroke="${c.eye}" stroke-width="3.6" stroke-linecap="round"`;
  let eyes: string;
  if (mood === 'awake') {
    eyes = `<circle cx="${cx - 13}" cy="${cy + 2}" r="4.6" fill="${c.eye}"/><circle cx="${cx + 13}" cy="${cy + 2}" r="4.6" fill="${c.eye}"/>`;
  } else if (mood === 'happy') {
    eyes = `<path d="M${cx - 19} ${cy + 4}q6 -8 12 0M${cx + 7} ${cy + 4}q6 -8 12 0" ${stroke}/>`;
  } else if (mood === 'grumpy') {
    eyes =
      `<path d="M${cx - 20} ${cy - 3}l12 6M${cx + 20} ${cy - 3}l-12 6" ${stroke}/>` +
      `<circle cx="${cx - 12}" cy="${cy + 6}" r="2.6" fill="${c.eye}"/><circle cx="${cx + 12}" cy="${cy + 6}" r="2.6" fill="${c.eye}"/>`;
  } else {
    eyes = `<path d="M${cx - 19} ${cy + 1}q6 6 12 0M${cx + 7} ${cy + 1}q6 6 12 0" ${stroke}/>`;
  }
  const muzzle = coat === 't' ? `<ellipse cx="${cx}" cy="${cy + 19}" rx="16" ry="11" fill="#f5efe2"/>` : '';
  const brow =
    coat === 'g'
      ? `<path d="M${cx - 6} ${cy - 17}v8M${cx} ${cy - 19}v9M${cx + 6} ${cy - 17}v8" stroke="${c.edge}" stroke-width="3" stroke-linecap="round" opacity=".55"/>`
      : '';
  const whisk = coat === 't' ? '#f5efe2' : c.ink;
  return (
    ear(-1) +
    ear(1) +
    `<ellipse cx="${cx}" cy="${cy + 6}" rx="32" ry="27" fill="${c.face}" stroke="${c.edge}" stroke-width="4"/>` +
    muzzle +
    brow +
    eyes +
    `<path d="M${cx - 4.5} ${cy + 11}h9l-4.5 5z" fill="#e98b93"/>` +
    `<path d="M${cx - 7} ${cy + 20}q3.5 4 7 0q3.5 4 7 0" fill="none" stroke="${c.ink}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M${cx - 23} ${cy + 13}l-13 -3M${cx - 23} ${cy + 18}l-13 3M${cx + 23} ${cy + 13}l13 -3M${cx + 23} ${cy + 18}l13 3" stroke="${whisk}" stroke-width="2" stroke-linecap="round" opacity=".5"/>`
  );
}

/** One whole cat on absolute squares: body, markings, tail curl, face. */
export function catMarkup(cells: readonly Cell[], coat: Coat, mood: FaceMood, cls = ''): string {
  const c = PAINT[coat];
  const d = outline(cells);
  let s = `<g class="cat ${cls}"><path class="cat__shape" d="${d}" fill="${c.fill}" stroke="${c.edge}" stroke-width="4" stroke-linejoin="round"/>`;
  cells.forEach(([x, y], i) => {
    if (i === 0) return;
    const ox = x * U;
    const oy = y * U;
    if (i === cells.length - 1) {
      s += `<path d="M${ox + 30} ${oy + 66}q-6 -34 20 -34q24 2 20 24q-4 14 -16 10" fill="none" stroke="${c.edge}" stroke-width="7" stroke-linecap="round" opacity=".7"/>`;
    } else if (coat === 'g') {
      s += `<path d="M${ox + 30} ${oy + 42}q20 -10 40 0M${ox + 30} ${oy + 60}q20 -10 40 0" fill="none" stroke="${c.edge}" stroke-width="5" stroke-linecap="round" opacity=".45"/>`;
    } else if (coat === 's') {
      s += `<circle cx="${ox + 40}" cy="${oy + 44}" r="8" fill="${c.face}" opacity=".8"/><circle cx="${ox + 62}" cy="${oy + 60}" r="6" fill="${c.face}" opacity=".8"/>`;
    } else if (coat === 't') {
      s += `<ellipse cx="${ox + 50}" cy="${oy + 52}" rx="15" ry="12" fill="#f5efe2" opacity=".9"/>`;
    }
  });
  const [hx, hy] = cells[0];
  s += face(hx * U + 50, hy * U + 50, coat, mood);
  if (cls.includes('cat--bad')) s += `<path class="cat__veto" d="${d}"/>`;
  return `${s}</g>`;
}

const FLOOR = (() => {
  let s = '';
  for (let y = 0; y < RULES.H; y++) {
    for (let x = 0; x < RULES.W; x++) {
      s += `<rect x="${x * U + 2}" y="${y * U + 2}" width="96" height="96" rx="10" fill="${(x + y) % 2 ? '#e3cba3' : '#eedcbc'}"/>`;
    }
  }
  return s;
})();

function badge(l: Link): string {
  const t = `transform="translate(${l.x * U} ${l.y * U})"`;
  return l.kind === 'friend'
    ? `<g ${t}><circle r="15" fill="#fff7f3" stroke="#e9577a" stroke-width="2.5"/><path d="M0 8C-13 -2 -6 -11 0 -5C6 -11 13 -2 0 8Z" fill="#e9577a"/></g>`
    : `<g ${t}><circle r="15" fill="#e4573d" stroke="#7d2415" stroke-width="2.5"/><path d="M3 -10L-7 2H-1L-3 10L7 -2H1Z" fill="#fff"/></g>`;
}

/** A whole floor: tiles, cats with their moods, full-row rings and badges. `fresh` is the cat to animate in. */
export function floorMarkup(cats: readonly { coat: Coat; cells: readonly Cell[] }[], fresh = -1): string {
  const t = tally(cats);
  let s = FLOOR;
  cats.forEach((c, i) => {
    s += catMarkup(c.cells, c.coat, t.mood[i], i === fresh ? 'cat--settle' : '');
  });
  for (const y of t.fullRows) {
    s += `<rect x="3" y="${y * U + 3}" width="${RULES.W * U - 6}" height="94" rx="26" fill="none" stroke="#f2b560" stroke-width="6" opacity=".95"/>`;
  }
  for (const l of t.links) s += badge(l);
  return s;
}

/** The cat being aimed, drawn over the floor. */
export function ghostMarkup(cells: readonly Cell[], coat: Coat, ok: boolean): string {
  return catMarkup(cells, coat, 'awake', `cat--ghost ${ok ? 'cat--ok' : 'cat--bad'}`);
}

/** A loose tile centred in a 4.2-square box (the viewBox to use is returned with it). */
export function tileMarkup(cells: readonly Cell[], coat: Coat): { viewBox: string; markup: string } {
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const box = 420;
  return { viewBox: `${-(box - w * U) / 2} ${-(box - h * U) / 2} ${box} ${box}`, markup: catMarkup(cells, coat, 'awake') };
}
