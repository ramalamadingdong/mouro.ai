/**
 * gen-sample-matches.ts — synthesize archived matches for testing the analytics
 * pipeline without any real data.
 *
 * It plays complete games with the REAL engine, driven by a few simple policies
 * (an eager knocker, a hold-for-gin player, a balanced one), and writes the exact
 * shape the app archives to `matches/<matchId>`: { meta, players, initial, log }.
 * Feed the output to extract-features.ts and the per-player summary should show
 * the policies pulling apart (the ginner holds longer, knocks with less deadwood).
 *
 * Run:  npm run analytics:gen        (writes scripts/analytics/out/sample-matches.json)
 * Demo: npm run analytics:demo       (gen + extract in one step)
 *
 * Outside the app tsconfig on purpose — dev tooling, run with tsx.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv } from 'node:process';

import {
  applyMove,
  deadwoodValue,
  initialMatchState,
  isBigGin,
  knockOptions,
  legalMoves,
  pipValue,
  seatOf,
  SCORING,
} from '../../src/engine';
import type { CardId, GameState, Move, Seat } from '../../src/engine/types';

interface Style {
  /** Knock as soon as the post-discard deadwood is at or below this. */
  knockThreshold: number;
  /** When the stock is this low, take any legal knock (don't risk a void). */
  panicStock: number;
}
const STYLES: Record<string, Style> = {
  aggressive: { knockThreshold: SCORING.KNOCK_MAX, panicStock: 999 },
  balanced: { knockThreshold: 5, panicStock: 8 },
  ginner: { knockThreshold: 2, panicStock: 6 },
};

interface Player {
  uid: string;
  name: string;
  style: keyof typeof STYLES;
}
const ROSTER: Player[] = [
  { uid: 'u_alice', name: 'Alice', style: 'aggressive' },
  { uid: 'u_bob', name: 'Bob', style: 'ginner' },
  { uid: 'u_cara', name: 'Cara', style: 'balanced' },
];

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A small non-crypto RNG so runs vary; seeds only synthetic test data. */
function seedArray(): number[] {
  const s: number[] = [];
  for (let i = 0; i < 8; i++) s.push(Math.floor(Math.random() * 65536));
  return s;
}
function randomCode(): string {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}

const top = (pile: CardId[]) => (pile.length ? pile[pile.length - 1] : null);

/** Min 10-card deadwood reachable if `card` were taken into `hand`. */
function deadwoodIfTake(hand: CardId[], card: CardId): number {
  let best = Infinity;
  for (const o of knockOptions([...hand, card])) best = Math.min(best, o.deadwoodAfter);
  return best;
}

/** Pick the discard that minimises resulting deadwood, throwing the biggest card on ties. */
function bestDiscard(hand: CardId[], noDiscard: CardId | null) {
  const opts = knockOptions(hand).filter((o) => o.card !== noDiscard);
  let best = opts[0];
  for (const o of opts) {
    if (
      o.deadwoodAfter < best.deadwoodAfter ||
      (o.deadwoodAfter === best.deadwoodAfter && pipValue(o.card) > pipValue(best.card))
    ) {
      best = o;
    }
  }
  return best;
}

/** Choose a move for the seat to act, per its style. */
function policyMove(state: GameState, seat: Seat, style: Style): Move {
  const hand = state.hands[seat];
  const uid = state.players[seat];

  if (state.phase === 'upcard1' || state.phase === 'upcard2') {
    const up = top(state.discard)!;
    return deadwoodIfTake(hand, up) < deadwoodValue(hand)
      ? { kind: 'takeUpcard' }
      : { kind: 'passUpcard' };
  }

  if (state.phase === 'draw') {
    const legal = legalMoves(state, uid);
    const up = top(state.discard);
    if (legal.includes('drawDiscard') && up !== null && deadwoodIfTake(hand, up) < deadwoodValue(hand)) {
      return { kind: 'drawDiscard' };
    }
    return { kind: 'drawStock' };
  }

  // discard phase (11-card hand)
  if (isBigGin(hand)) return { kind: 'bigGin' };
  const opts = knockOptions(hand).filter((o) => o.card !== state.noDiscard);
  const gin = opts.find((o) => o.deadwoodAfter === 0);
  if (gin) return { kind: 'knock', discard: gin.card }; // go gin

  const knockable = opts
    .filter((o) => o.deadwoodAfter <= SCORING.KNOCK_MAX)
    .sort((a, b) => a.deadwoodAfter - b.deadwoodAfter);
  if (knockable.length) {
    const bk = knockable[0];
    const panic = state.stock.length <= style.panicStock;
    if (panic || bk.deadwoodAfter <= style.knockThreshold) {
      return { kind: 'knock', discard: bk.card };
    }
  }
  return { kind: 'discard', card: bestDiscard(hand, state.noDiscard).card };
}

interface LoggedMove {
  seat: Seat;
  move: Move;
}

/** Play one full match, returning the archive record the app would write. */
function playMatch(p0: Player, p1: Player, createdAt: number, target: number) {
  const initial = initialMatchState({
    hostUid: p0.uid,
    guestUid: p1.uid,
    hostName: p0.name,
    guestName: p1.name,
    seed: seedArray(),
    target,
  });

  let state: GameState = initial;
  const log: Record<number, LoggedMove> = {};

  for (let guard = 0; guard < 5000; guard++) {
    if (state.phase === 'matchOver') break;

    let move: Move;
    let seat: Seat;
    if (state.phase === 'roundOver') {
      seat = state.turn;
      move = { kind: 'nextRound', seed: seedArray() };
    } else {
      seat = state.turn;
      move = policyMove(state, seat, STYLES[seat === 'p0' ? p0.style : p1.style]);
    }

    const uid = state.players[seat];
    const applied = applyMove(state, move, uid);
    if (!applied.ok) throw new Error(`illegal policy move (${move.kind}): ${applied.error}`);
    // Log keyed by the resulting version and attributed to the acting seat —
    // exactly as submitMove archives it.
    log[applied.state.version] = { seat: seatOf(applied.state, uid)!, move };
    state = applied.state;
  }

  const code = randomCode();
  return {
    matchId: `${code}-${createdAt}`,
    record: {
      meta: { code, createdAt, startedAt: createdAt },
      players: { p0: p0.uid, p1: p1.uid },
      initial,
      log,
    },
  };
}

function main() {
  const count = Number(argv[2]) || 8;
  const target = Number(argv[3]) || 50;
  const outPath = resolve('scripts/analytics/out/sample-matches.json');

  const matches: Record<string, unknown> = {};
  const base = Date.now();
  for (let i = 0; i < count; i++) {
    // Rotate through pairings so every roster player accumulates several games.
    const p0 = ROSTER[i % ROSTER.length];
    const p1 = ROSTER[(i + 1) % ROSTER.length];
    const { matchId, record } = playMatch(p0, p1, base + i, target);
    matches[matchId] = record;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ matches }, null, 2));
  console.log(`wrote ${count} synthetic matches (target ${target}) -> ${outPath}`);
}

main();
