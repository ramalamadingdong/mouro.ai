/**
 * Hong Kong scoring, in faan. Every pattern a complete hand shows is added up
 * (the split of the concealed tiles that scores most is used), then capped at
 * the limit. What a hand is worth in points comes from `pointsFor`:
 * a discarded win is paid double by the discarder and single by the other
 * two; a self-drawn win is paid double by all three.
 */
import { decompositions, isThirteenOrphans, type Meld } from './hand';
import {
  DRAGON_RED,
  FLOWER_FIRST,
  SEASON_FIRST,
  WIND_EAST,
  isBonus,
  isDragon,
  isHonor,
  isSuited,
  isWind,
  kindOf,
  suitOf,
} from './tiles';

/** Faan at and above which a hand is a limit hand. */
export const LIMIT_FAAN = 10;

/** Points by faan, 0…10 (10 = the limit). */
export const POINTS = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128] as const;

export function pointsFor(faan: number): number {
  return POINTS[Math.max(0, Math.min(LIMIT_FAAN, faan))];
}

export interface WinContext {
  /** Concealed tiles including the winning tile. */
  concealed: string;
  melds: Meld[];
  flowers: string;
  /** This player's seat wind, 0 East … 3 North. */
  seatWind: number;
  /** Prevailing wind. */
  wind: number;
  selfDrawn: boolean;
  /** The winning tile was the last one in the wall (or the last discard). */
  lastTile: boolean;
  /** Won on the replacement tile after a kong. */
  afterKong: boolean;
  /** Won by robbing a kong. */
  robbed: boolean;
}

export interface Score {
  faan: number;
  /** [name, faan] per pattern. */
  lines: [string, number][];
}

interface FullSet {
  type: 'chow' | 'pung' | 'kong';
  kind: number;
  concealed: boolean;
}

function bonusLines(ctx: WinContext): [string, number][] {
  const lines: [string, number][] = [];
  const kinds = Array.from(ctx.flowers, kindOf).filter(isBonus);
  if (kinds.length === 0) {
    lines.push(['No flowers', 1]);
    return lines;
  }
  const flowers = kinds.filter((k) => k < SEASON_FIRST);
  const seasons = kinds.filter((k) => k >= SEASON_FIRST);
  if (flowers.includes(FLOWER_FIRST + ctx.seatWind)) lines.push(['Own flower', 1]);
  if (seasons.includes(SEASON_FIRST + ctx.seatWind)) lines.push(['Own season', 1]);
  if (flowers.length === 4) lines.push(['All four flowers', 2]);
  if (seasons.length === 4) lines.push(['All four seasons', 2]);
  return lines;
}

function situationLines(ctx: WinContext, concealedHand: boolean): [string, number][] {
  const lines: [string, number][] = [];
  if (ctx.selfDrawn) lines.push(['Self-drawn', 1]);
  if (concealedHand) lines.push(['Concealed hand', 1]);
  if (ctx.lastTile) lines.push([ctx.selfDrawn ? 'Last tile of the wall' : 'Last discard', 1]);
  if (ctx.afterKong) lines.push(['Win on a kong replacement', 1]);
  if (ctx.robbed) lines.push(['Robbing a kong', 1]);
  return lines;
}

function scoreShape(ctx: WinContext, sets: FullSet[], pair: number): Score {
  const lines: [string, number][] = [];
  const concealedHand = ctx.melds.every((m) => m.type === 'hidden-kong');
  const pungs = sets.filter((s) => s.type !== 'chow');
  const chows = sets.filter((s) => s.type === 'chow');

  // Limit hands first: they replace everything else.
  const dragonPungs = pungs.filter((s) => isDragon(s.kind)).length;
  const windPungs = pungs.filter((s) => isWind(s.kind)).length;
  const allKinds = [...sets.map((s) => s.kind), pair];
  const allHonors = allKinds.every(isHonor);
  const kongs = sets.filter((s) => s.type === 'kong').length;
  const limits: string[] = [];
  if (windPungs === 4) limits.push('Great four winds');
  if (dragonPungs === 3) limits.push('Great three dragons');
  if (allHonors) limits.push('All honours');
  if (kongs === 4) limits.push('Four kongs');
  if (pungs.length === 4 && ctx.selfDrawn && pungs.every((s) => s.concealed)) limits.push('Four concealed pungs');
  if (limits.length > 0) return { faan: LIMIT_FAAN, lines: [[limits[0], LIMIT_FAAN]] };

  lines.push(...situationLines(ctx, concealedHand));
  lines.push(...bonusLines(ctx));

  if (chows.length === 4 && !isDragon(pair) && pair !== WIND_EAST + ctx.seatWind && pair !== WIND_EAST + ctx.wind) {
    lines.push(['All chows', 1]);
  }
  if (pungs.length === 4) lines.push(['All pungs', 3]);

  const suits = new Set(allKinds.filter(isSuited).map(suitOf));
  const honors = allKinds.some(isHonor);
  if (suits.size === 1 && !honors) lines.push(['Pure one suit', 7]);
  else if (suits.size === 1 && honors) lines.push(['Mixed one suit', 3]);

  if (windPungs === 3 && isWind(pair)) lines.push(['Small four winds', 10]);
  if (dragonPungs === 2 && isDragon(pair)) lines.push(['Small three dragons', 5]);
  else {
    for (const s of pungs) if (isDragon(s.kind)) lines.push([`${['Red', 'Green', 'White'][s.kind - DRAGON_RED]} dragon pung`, 1]);
  }
  if (!(windPungs === 3 && isWind(pair))) {
    for (const s of pungs) {
      if (s.kind === WIND_EAST + ctx.seatWind) lines.push(['Seat wind', 1]);
      if (s.kind === WIND_EAST + ctx.wind) lines.push(['Round wind', 1]);
    }
  }

  const faan = Math.min(LIMIT_FAAN, lines.reduce((n, [, f]) => n + f, 0));
  return { faan, lines };
}

/** The best score for a winning hand, or null if it is not complete. */
export function scoreHand(ctx: WinContext): Score | null {
  if (ctx.melds.length === 0 && isThirteenOrphans(ctx.concealed)) {
    return { faan: LIMIT_FAAN, lines: [['Thirteen orphans', LIMIT_FAAN]] };
  }
  const melded: FullSet[] = ctx.melds.map((m) => ({
    type: m.type === 'chow' ? 'chow' : m.type === 'pung' ? 'pung' : 'kong',
    kind: m.kind,
    concealed: m.type === 'hidden-kong',
  }));
  const winKind = ctx.concealed.length > 0 ? kindOf(ctx.concealed[ctx.concealed.length - 1]) : -1;
  let best: Score | null = null;
  for (const d of decompositions(ctx.concealed)) {
    const sets: FullSet[] = [
      ...melded,
      ...d.sets.map((s) => ({
        type: s.type,
        kind: s.kind,
        // A pung completed by someone else's discard counts as exposed.
        concealed: s.type === 'pung' && (ctx.selfDrawn || s.kind !== winKind),
      })),
    ];
    const score = scoreShape(ctx, sets, d.pair);
    if (!best || score.faan > best.faan) best = score;
  }
  return best;
}

export function formatLines(lines: [string, number][]): string {
  return lines.map(([name, faan]) => `${name}:${faan}`).join('|');
}

export function parseLines(text: string): [string, number][] {
  if (!text) return [];
  return text.split('|').map((part) => {
    const i = part.lastIndexOf(':');
    return [part.slice(0, i), Number(part.slice(i + 1)) || 0];
  });
}
