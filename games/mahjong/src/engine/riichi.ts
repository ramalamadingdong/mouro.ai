/**
 * Japanese (Riichi) scoring: yaku, dora, fu and points.
 *
 * `scoreRiichi(ctx)` tries every way to read the hand (every split into sets
 * and a pair, every set the winning tile could have completed, seven pairs,
 * thirteen orphans) and keeps the reading worth the most. It returns null if
 * the hand is not complete or has no yaku — dora alone never makes a hand.
 *
 * Kept out: red fives, double yakuman, nagashi mangan, abortive draws.
 */
import { decompositions, type Meld } from './hand';
import {
  DRAGON_RED,
  PLAY_KINDS,
  WIND_EAST,
  countsOf,
  isDragon,
  isHonor,
  isSuited,
  isTerminalOrHonor,
  isWind,
  kindOf,
  rankOf,
  suitOf,
} from './tiles';

export interface RiichiContext {
  /** Concealed tiles, including the winning tile. */
  concealed: string;
  winTile: string;
  melds: Meld[];
  tsumo: boolean;
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  /** 0 East … 3 North. */
  seatWind: number;
  roundWind: number;
  /** Dora indicators showing (and ura indicators, counted only after riichi). */
  doraIndicators: string;
  uraIndicators: string;
  /** Won on the last tile of the wall (tsumo) or its discard (ron). */
  lastTile: boolean;
  rinshan: boolean;
  chankan: boolean;
  /** The dealer's very first draw (tenhou) / a non-dealer's first draw with no calls (chiihou). */
  firstDraw: boolean;
  dealer: boolean;
}

export interface RiichiScore {
  han: number;
  fu: number;
  /** [name, han] for every yaku and dora line; yakuman lines carry 13. */
  lines: [string, number][];
  /** Count of yakuman (0 for an ordinary hand). */
  yakuman: number;
  /** Basic points: fu × 2^(han+2), capped by the limit hands. */
  base: number;
  /** '' or Mangan / Haneman / Baiman / Sanbaiman / Yakuman. */
  limit: string;
}

/** The tile a dora indicator points at. */
export function doraOf(indicatorKind: number): number {
  if (isSuited(indicatorKind)) return indicatorKind - (indicatorKind % 9) + ((indicatorKind % 9) + 1) % 9;
  if (isWind(indicatorKind)) return WIND_EAST + ((indicatorKind - WIND_EAST + 1) % 4);
  // Dragons go white → green → red → white. Kinds: 31 red, 32 green, 33 white.
  return indicatorKind === 33 ? 32 : indicatorKind === 32 ? 31 : 33;
}

export function countDora(tiles: string, indicators: string): number {
  const counts = countsOf(tiles);
  let n = 0;
  for (const ind of indicators) n += counts[doraOf(kindOf(ind))] ?? 0;
  return n;
}

interface ReadSet {
  type: 'chow' | 'pung' | 'kong';
  kind: number;
  /** Concealed for scoring: not called, and a pung not completed by a ron. */
  closed: boolean;
}

type Wait = 'ryanmen' | 'kanchan' | 'penchan' | 'tanki' | 'shanpon';

function limitFor(han: number, fu: number): { base: number; limit: string } {
  if (han >= 13) return { base: 8000, limit: 'Kazoe yakuman' };
  if (han >= 11) return { base: 6000, limit: 'Sanbaiman' };
  if (han >= 8) return { base: 4000, limit: 'Baiman' };
  if (han >= 6) return { base: 3000, limit: 'Haneman' };
  const base = fu * 2 ** (han + 2);
  if (han >= 5 || base >= 2000) return { base: 2000, limit: 'Mangan' };
  return { base, limit: '' };
}

const isTerminal = (k: number) => isSuited(k) && (rankOf(k) === 1 || rankOf(k) === 9);
const isValueKind = (k: number, ctx: RiichiContext) =>
  isDragon(k) || k === WIND_EAST + ctx.seatWind || k === WIND_EAST + ctx.roundWind;

/** Yaku that do not depend on how the hand is split. */
function situational(ctx: RiichiContext, closed: boolean): [string, number][] {
  const out: [string, number][] = [];
  if (ctx.doubleRiichi) out.push(['Double riichi', 2]);
  else if (ctx.riichi) out.push(['Riichi', 1]);
  if (ctx.ippatsu && ctx.riichi) out.push(['Ippatsu', 1]);
  if (ctx.tsumo && closed) out.push(['Menzen tsumo', 1]);
  if (ctx.lastTile && !ctx.rinshan) out.push([ctx.tsumo ? 'Haitei' : 'Houtei', 1]);
  if (ctx.rinshan) out.push(['Rinshan kaihou', 1]);
  if (ctx.chankan) out.push(['Chankan', 1]);
  return out;
}

function allTileKinds(ctx: RiichiContext): number[] {
  return [...Array.from(ctx.concealed, kindOf), ...ctx.melds.flatMap((m) => Array.from(m.tiles, kindOf))];
}

function flushYaku(kinds: number[], closed: boolean): [string, number][] {
  const suits = new Set(kinds.filter(isSuited).map(suitOf));
  const honors = kinds.some(isHonor);
  if (suits.size === 1 && !honors) return [['Chinitsu', closed ? 6 : 5]];
  if (suits.size === 1 && honors) return [['Honitsu', closed ? 3 : 2]];
  return [];
}

function yakumanFor(ctx: RiichiContext, sets: ReadSet[] | null, pair: number | null, closed: boolean): string[] {
  const kinds = allTileKinds(ctx);
  const out: string[] = [];
  if (ctx.firstDraw && ctx.tsumo && closed) out.push(ctx.dealer ? 'Tenhou' : 'Chiihou');
  if (kinds.every(isHonor)) out.push('Tsuuiisou');
  if (kinds.every(isTerminal)) out.push('Chinroutou');
  const green = new Set([19, 20, 21, 23, 25, 32]); // 2 3 4 6 8 bamboo, green dragon
  if (kinds.every((k) => green.has(k))) out.push('Ryuuiisou');
  if (sets && pair !== null) {
    const pungs = sets.filter((s) => s.type !== 'chow');
    if (pungs.filter((s) => isDragon(s.kind)).length === 3) out.push('Daisangen');
    const windPungs = pungs.filter((s) => isWind(s.kind)).length;
    if (windPungs === 4) out.push('Daisuushii');
    else if (windPungs === 3 && isWind(pair)) out.push('Shousuushii');
    if (pungs.length === 4 && pungs.every((s) => s.closed)) out.push('Suuankou');
    if (sets.filter((s) => s.type === 'kong').length === 4) out.push('Suukantsu');
  }
  if (closed && ctx.melds.length === 0) {
    const c = countsOf(ctx.concealed);
    for (const base of [0, 9, 18]) {
      const shape = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      let ok = c.slice(base, base + 9).reduce((n, x) => n + x, 0) === 14;
      for (let i = 0; i < 9 && ok; i++) if (c[base + i] < shape[i]) ok = false;
      if (ok) out.push('Chuuren poutou');
    }
  }
  return out;
}

function finish(lines: [string, number][], fu: number, ctx: RiichiContext): RiichiScore | null {
  if (lines.length === 0) return null; // no yaku
  const all = [...ctx.concealed, ...ctx.melds.map((m) => m.tiles).join('')].join('');
  const dora = countDora(all, ctx.doraIndicators);
  const ura = ctx.riichi ? countDora(all, ctx.uraIndicators) : 0;
  const out = lines.slice();
  if (dora > 0) out.push(['Dora', dora]);
  if (ura > 0) out.push(['Ura dora', ura]);
  const han = out.reduce((n, [, h]) => n + h, 0);
  const { base, limit } = limitFor(han, fu);
  return { han, fu, lines: out, yakuman: 0, base, limit };
}

function yakumanScore(names: string[]): RiichiScore {
  return {
    han: 13 * names.length,
    fu: 0,
    lines: names.map((n) => [n, 13]),
    yakuman: names.length,
    base: 8000 * names.length,
    limit: names.length > 1 ? `${names.length}× Yakuman` : 'Yakuman',
  };
}

function better(a: RiichiScore | null, b: RiichiScore | null): RiichiScore | null {
  if (!a) return b;
  if (!b) return a;
  if (b.base !== a.base) return b.base > a.base ? b : a;
  if (b.han !== a.han) return b.han > a.han ? b : a;
  return b.fu > a.fu ? b : a;
}

function sevenPairs(ctx: RiichiContext): RiichiScore | null {
  if (ctx.melds.length > 0 || ctx.concealed.length !== 14) return null;
  const c = countsOf(ctx.concealed);
  for (let k = 0; k < PLAY_KINDS; k++) if (c[k] !== 0 && c[k] !== 2) return null;
  const ym = yakumanFor(ctx, null, null, true);
  if (ym.length > 0) return yakumanScore(ym);
  const kinds = Array.from(ctx.concealed, kindOf);
  const lines: [string, number][] = [...situational(ctx, true), ['Chiitoitsu', 2]];
  if (kinds.every((k) => !isTerminalOrHonor(k))) lines.push(['Tanyao', 1]);
  if (kinds.every(isTerminalOrHonor)) lines.push(['Honroutou', 2]);
  lines.push(...flushYaku(kinds, true));
  return finish(lines, 25, ctx);
}

function orphans(ctx: RiichiContext): RiichiScore | null {
  if (ctx.melds.length > 0 || ctx.concealed.length !== 14) return null;
  const c = countsOf(ctx.concealed);
  let pair = false;
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (isTerminalOrHonor(k)) {
      if (c[k] === 0 || c[k] > 2) return null;
      if (c[k] === 2) pair = true;
    } else if (c[k] > 0) return null;
  }
  return pair ? yakumanScore(['Kokushi musou']) : null;
}

/** Score one reading: sets (melds + concealed), pair, and the wait the winning tile filled. */
function scoreReading(ctx: RiichiContext, sets: ReadSet[], pair: number, wait: Wait): RiichiScore | null {
  const closed = ctx.melds.every((m) => m.type === 'hidden-kong');
  const ym = yakumanFor(ctx, sets, pair, closed);
  if (ym.length > 0) return yakumanScore(ym);

  const lines = situational(ctx, closed);
  const chows = sets.filter((s) => s.type === 'chow');
  const pungs = sets.filter((s) => s.type !== 'chow');
  const kinds = allTileKinds(ctx);

  const pinfu = closed && chows.length === 4 && !isValueKind(pair, ctx) && wait === 'ryanmen';
  if (pinfu) lines.push(['Pinfu', 1]);
  if (kinds.every((k) => !isTerminalOrHonor(k))) lines.push(['Tanyao', 1]);

  for (const s of pungs) {
    if (isDragon(s.kind)) lines.push([`Yakuhai: ${['red', 'green', 'white'][s.kind - DRAGON_RED]} dragon`, 1]);
    if (s.kind === WIND_EAST + ctx.seatWind) lines.push(['Yakuhai: seat wind', 1]);
    if (s.kind === WIND_EAST + ctx.roundWind) lines.push(['Yakuhai: round wind', 1]);
  }

  if (closed) {
    const seen = new Map<number, number>();
    for (const s of chows) seen.set(s.kind, (seen.get(s.kind) ?? 0) + 1);
    const twins = Array.from(seen.values()).reduce((n, c) => n + Math.floor(c / 2), 0);
    if (twins >= 2) lines.push(['Ryanpeikou', 3]);
    else if (twins === 1) lines.push(['Iipeikou', 1]);
  }

  const chowStarts = new Set(chows.map((s) => s.kind));
  for (let r = 0; r < 7; r++) {
    if (chowStarts.has(r) && chowStarts.has(r + 9) && chowStarts.has(r + 18)) {
      lines.push(['Sanshoku doujun', closed ? 2 : 1]);
      break;
    }
  }
  for (const base of [0, 9, 18]) {
    if (chowStarts.has(base) && chowStarts.has(base + 3) && chowStarts.has(base + 6)) {
      lines.push(['Ittsu', closed ? 2 : 1]);
      break;
    }
  }
  const pungKinds = new Set(pungs.map((s) => s.kind));
  for (let r = 0; r < 9; r++) {
    if (pungKinds.has(r) && pungKinds.has(r + 9) && pungKinds.has(r + 18)) lines.push(['Sanshoku doukou', 2]);
  }

  const groupHasTerminal = (s: ReadSet) =>
    s.type === 'chow' ? isTerminal(s.kind) || isTerminal(s.kind + 2) : isTerminalOrHonor(s.kind);
  if (chows.length > 0 && sets.every(groupHasTerminal) && isTerminalOrHonor(pair)) {
    const noHonors = !isHonor(pair) && sets.every((s) => !isHonor(s.kind));
    lines.push(noHonors ? ['Junchan', closed ? 3 : 2] : ['Chanta', closed ? 2 : 1]);
  }
  if (pungs.length === 4) lines.push(['Toitoi', 2]);
  if (pungs.filter((s) => s.closed).length === 3) lines.push(['Sanankou', 2]);
  if (sets.filter((s) => s.type === 'kong').length === 3) lines.push(['Sankantsu', 2]);
  if (kinds.every(isTerminalOrHonor)) lines.push(['Honroutou', 2]);
  if (pungs.filter((s) => isDragon(s.kind)).length === 2 && isDragon(pair)) lines.push(['Shousangen', 2]);
  lines.push(...flushYaku(kinds, closed));

  // Fu.
  let fu = 20;
  if (pinfu) fu = ctx.tsumo ? 20 : 30;
  else {
    if (closed && !ctx.tsumo) fu += 10;
    if (ctx.tsumo) fu += 2;
    for (const s of pungs) {
      let f = isTerminalOrHonor(s.kind) ? 4 : 2;
      if (s.closed) f *= 2;
      if (s.type === 'kong') f *= 4;
      fu += f;
    }
    if (isDragon(pair)) fu += 2;
    if (pair === WIND_EAST + ctx.seatWind) fu += 2;
    if (pair === WIND_EAST + ctx.roundWind) fu += 2;
    if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
    fu = Math.ceil(fu / 10) * 10;
    if (fu === 20) fu = 30; // an open hand with nothing else is 30 fu
  }
  return finish(lines, fu, ctx);
}

export function scoreRiichi(ctx: RiichiContext): RiichiScore | null {
  let best: RiichiScore | null = better(orphans(ctx), sevenPairs(ctx));
  const win = kindOf(ctx.winTile);
  const melded: ReadSet[] = ctx.melds.map((m) => ({
    type: m.type === 'chow' ? 'chow' : m.type === 'pung' ? 'pung' : 'kong',
    kind: m.kind,
    closed: m.type === 'hidden-kong',
  }));

  for (const d of decompositions(ctx.concealed)) {
    // Every place the winning tile could sit is a different reading.
    const readings: { index: number; wait: Wait }[] = [];
    if (d.pair === win) readings.push({ index: -1, wait: 'tanki' });
    d.sets.forEach((s, i) => {
      if (s.type === 'pung' && s.kind === win) readings.push({ index: i, wait: 'shanpon' });
      if (s.type === 'chow' && win >= s.kind && win <= s.kind + 2) {
        const pos = win - s.kind;
        const r = rankOf(s.kind);
        const wait: Wait = pos === 1 ? 'kanchan' : (pos === 0 && r === 7) || (pos === 2 && r === 1) ? 'penchan' : 'ryanmen';
        readings.push({ index: i, wait });
      }
    });
    for (const { index, wait } of readings) {
      const sets: ReadSet[] = [
        ...melded,
        ...d.sets.map((s, i) => ({
          type: s.type,
          kind: s.kind,
          // A pung finished by someone else's tile is open for fu and sanankou.
          closed: s.type === 'pung' && !(i === index && wait === 'shanpon' && !ctx.tsumo),
        })),
      ];
      best = better(best, scoreReading(ctx, sets, d.pair, wait));
    }
  }
  return best;
}

/** Points the winner collects, before honba and riichi sticks, from each seat. */
export function riichiPayments(
  base: number,
  winner: number,
  from: number,
  dealer: number,
  seats: number,
): number[] {
  const up = (n: number) => Math.ceil(n / 100) * 100;
  const pay = new Array<number>(seats).fill(0);
  const winnerIsDealer = winner === dealer;
  if (from >= 0 || seats === 2) {
    // A ron — or any win heads-up, where the one opponent pays the whole hand.
    const loser = from >= 0 ? from : (winner + 1) % 2;
    pay[loser] = up(base * (winnerIsDealer ? 6 : 4));
  } else {
    for (let s = 0; s < seats; s++) {
      if (s === winner) continue;
      pay[s] = up(base * (winnerIsDealer || s === dealer ? 2 : 1));
    }
  }
  return pay;
}
