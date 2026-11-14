/**
 * extract-features.ts — turn archived matches into an ML-ready feature table.
 *
 * Input: a JSON dump of the Realtime Database `matches` node (see README.md for
 * how to export it). Each match is `{ meta, players, initial, log }`, where
 * `initial` is the round-1 deal (a GameState at version 0) and `log` is
 * `{ <version>: { seat, move } }` — every accepted move in order.
 *
 * Because the engine is a PURE, deterministic reducer, `initial` + the ordered
 * move stream replays the entire match: we re-run `applyMove` move-by-move and,
 * at each decision, read the reconstructed hands / deadwood / discard pile to
 * emit one row of features. Nothing about a decision needs to have been logged —
 * we recompute it from the replay. Output is a CSV (one row per decision) plus a
 * per-player summary CSV of aggregate strategy tendencies.
 *
 * Run:  npm run extract:features -- <dump.json> [--out features.csv] [--summary players.csv]
 * Demo: npm run analytics:demo   (generates synthetic matches, then extracts)
 *
 * This file is intentionally OUTSIDE the app's tsconfig (see tsconfig exclude):
 * it is dev tooling run with tsx, not shipped in the Expo Go bundle.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv, exit } from 'node:process';

import {
  applyMove,
  bestArrangement,
  deadwoodValue,
  knockOptions,
  normalize,
  pipValue,
  cardToAscii,
  SCORING,
} from '../../src/engine';
import type { CardId, GameState, Move, Seat } from '../../src/engine/types';
import { loadMatches, sortLog, type Json } from './replay';

// ── per-round replay bookkeeping ─────────────────────────────────────────────
// Tracks, per seat, how many turns (draws) have elapsed this round and the turn
// index at which each held card was acquired — this is what lets us report how
// long a discarded card was held ("high-card hold time").

interface RoundTrack {
  turn: Record<Seat, number>;
  acquired: Record<Seat, Map<CardId, number>>;
}

function freshTrack(state: GameState): RoundTrack {
  const acq = (seat: Seat) => new Map<CardId, number>(state.hands[seat].map((c) => [c, 0]));
  return { turn: { p0: 0, p1: 0 }, acquired: { p0: acq('p0'), p1: acq('p1') } };
}

const other = (s: Seat): Seat => (s === 'p0' ? 'p1' : 'p0');
const top = (pile: CardId[]): CardId | null => (pile.length ? pile[pile.length - 1] : null);
const HIGH_PIP = 8; // 8/9/10-valued cards — the ones worth analysing hold time for

// ── feature row ──────────────────────────────────────────────────────────────
const COLUMNS = [
  'matchId', 'code', 'round', 'version', 'seat', 'playerUid', 'playerName',
  'phase', 'moveKind', 'decision', 'turnInRound',
  'stockBefore', 'discardTopBefore', 'discardTopPipBefore',
  'handSizeBefore', 'deadwoodBefore',
  'drawSource', 'tookDiscard', 'takenCard', 'takenPip', 'discardTopHelped',
  'discardedCard', 'discardedPip', 'deadwoodAfterDiscard', 'discardHoldTurns',
  'declinedKnock', 'declinedGin',
  'knockType', 'deadwoodAtKnock', 'roundWinner', 'roundPoints',
  'scoreP0', 'scoreP1',
] as const;

type Row = Partial<Record<(typeof COLUMNS)[number], string | number>>;

/** Best 10-card deadwood reachable if the seat took `card` into its hand. */
function deadwoodIfTake(hand: CardId[], card: CardId): number {
  let best = Infinity;
  for (const o of knockOptions([...hand, card])) best = Math.min(best, o.deadwoodAfter);
  return best;
}

/**
 * Replay one match and emit a decision row per meaningful move. Returns the rows
 * plus a count of moves skipped due to a gap/rejection (best-effort capture can
 * drop a move; we stop that match at the first gap rather than desync the replay).
 */
function extractMatch(matchId: string, match: Json): { rows: Row[]; gap: boolean } {
  const rows: Row[] = [];
  const state0 = normalize(match.initial);
  if (!state0) return { rows, gap: false };

  const code: string = match?.meta?.code ?? matchId.split('-')[0];
  let state = state0;
  let track = freshTrack(state);
  let gap = false;

  for (const { v, seat, move } of sortLog(match.log)) {
    // The log is keyed by resulting version; a missing key means a capture gap.
    // Applying out of order would desync every later move, so stop this match.
    if (v !== state.version + 1) {
      gap = true;
      break;
    }
    const pre = state;
    const uid = pre.players[seat];
    const kind = move.kind;
    const hand = pre.hands[seat];
    const discardTop = top(pre.discard);

    // Update turn/acquisition tracking for draw-type moves BEFORE building the
    // row so `turnInRound` reflects the turn this move belongs to.
    const acquiredThisMove =
      kind === 'drawStock' ? top(pre.stock)
      : kind === 'drawDiscard' || kind === 'takeUpcard' ? discardTop
      : null;
    if (kind === 'drawStock' || kind === 'drawDiscard' || kind === 'takeUpcard') {
      track.turn[seat] += 1;
      if (acquiredThisMove !== null) track.acquired[seat].set(acquiredThisMove, track.turn[seat]);
    }

    const applied = applyMove(pre, move, uid);
    if (!applied.ok) {
      gap = true; // a logged move the reducer rejects — treat like a gap
      break;
    }
    const next = applied.state;

    // Only the moves below are strategic decisions; nextRound/rematch just re-deal.
    const decision =
      kind === 'takeUpcard' || kind === 'passUpcard' ? 'upcard'
      : kind === 'drawStock' || kind === 'drawDiscard' ? 'draw'
      : kind === 'discard' ? 'discard'
      : kind === 'knock' ? 'knock'
      : kind === 'bigGin' ? 'biggin'
      : null;

    if (decision) {
      const row: Row = {
        matchId,
        code,
        round: pre.round,
        version: v,
        seat,
        playerUid: uid,
        playerName: pre.names[seat],
        phase: pre.phase,
        moveKind: kind,
        decision,
        turnInRound: track.turn[seat],
        stockBefore: pre.stock.length,
        discardTopBefore: discardTop === null ? '' : cardToAscii(discardTop),
        discardTopPipBefore: discardTop === null ? '' : pipValue(discardTop),
        handSizeBefore: hand.length,
        deadwoodBefore: bestArrangement(hand).deadwoodValue,
        scoreP0: next.scores.p0,
        scoreP1: next.scores.p1,
      };

      if (decision === 'draw' || decision === 'upcard') {
        row.drawSource =
          kind === 'drawStock' ? 'stock'
          : kind === 'drawDiscard' ? 'discard'
          : kind === 'takeUpcard' ? 'upcard-take'
          : 'upcard-pass';
        const took = kind === 'drawDiscard' || kind === 'takeUpcard';
        row.tookDiscard = took ? 1 : 0;
        // The taken card is only observable info when it comes from the discard
        // pile / upcard; a stock draw is blind, so leave it empty.
        row.takenCard = took && discardTop !== null ? cardToAscii(discardTop) : '';
        row.takenPip = took && discardTop !== null ? pipValue(discardTop) : '';
        // Was the visible discard top actually useful? (Reveals "grabbed junk" vs
        // "passed a useful card" tendencies for both stock and discard draws.)
        row.discardTopHelped =
          discardTop === null
            ? ''
            : deadwoodIfTake(hand, discardTop) < bestArrangement(hand).deadwoodValue ? 1 : 0;
      }

      if (decision === 'discard' || decision === 'knock') {
        const card = kind === 'knock' ? (move as { discard: CardId }).discard : (move as { card: CardId }).card;
        const rest = hand.filter((c) => c !== card);
        row.discardedCard = cardToAscii(card);
        row.discardedPip = pipValue(card);
        row.deadwoodAfterDiscard = deadwoodValue(rest);
        row.discardHoldTurns = track.turn[seat] - (track.acquired[seat].get(card) ?? 0);
      }

      if (decision === 'discard') {
        // On a plain discard, did the player pass up an available knock / gin?
        const opts = knockOptions(hand).filter((o) => o.card !== pre.noDiscard);
        row.declinedKnock = opts.some((o) => o.deadwoodAfter <= SCORING.KNOCK_MAX) ? 1 : 0;
        row.declinedGin = opts.some((o) => o.deadwoodAfter === 0) ? 1 : 0;
      }

      if (decision === 'biggin') {
        row.deadwoodBefore = 0;
      }

      // Knock/gin/big-gin outcome comes from the resolved round result.
      const rr = next.roundResult;
      if ((decision === 'knock' || decision === 'biggin') && rr && rr.knocker) {
        row.knockType = rr.type;
        row.deadwoodAtKnock = rr.deadwood[rr.knocker];
        row.roundWinner = rr.winner ?? '';
        row.roundPoints = rr.points;
      }

      rows.push(row);
    }

    // A fresh deal resets per-round turn/acquisition tracking.
    if (kind === 'nextRound' || kind === 'rematch') track = freshTrack(next);

    state = next;
  }

  return { rows, gap };
}

// ── per-player summary ───────────────────────────────────────────────────────
// Aggregate the raw rows into one line per player — a quick, human-readable read
// on each person's tendencies and a sanity check that the pipeline works.

const SUMMARY_COLUMNS = [
  'playerUid', 'playerName', 'games', 'decisions',
  'drawTakeRate', 'takeWhenUsefulRate', 'grabWhenUselessRate',
  'avgDiscardPip', 'avgDiscardHoldTurns', 'avgHighCardHoldTurns',
  'holdForGinRate', 'knocks', 'gins', 'bigGins', 'avgDeadwoodAtKnock',
] as const;

function mean(xs: number[]): string {
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '';
}
function rate(num: number, den: number): string {
  return den ? (num / den).toFixed(3) : '';
}

function summarize(rows: Row[]): Row[] {
  const byPlayer = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r.playerUid);
    (byPlayer.get(key) ?? byPlayer.set(key, []).get(key)!).push(r);
  }

  const out: Row[] = [];
  for (const [uid, rs] of byPlayer) {
    const draws = rs.filter((r) => r.decision === 'draw' || r.decision === 'upcard');
    const usefulDraws = draws.filter((r) => r.discardTopHelped === 1);
    const uselessDraws = draws.filter((r) => r.discardTopHelped === 0);
    const discards = rs.filter((r) => r.decision === 'discard');
    const highDiscards = discards.filter((r) => Number(r.discardedPip) >= HIGH_PIP);
    const knocks = rs.filter((r) => r.decision === 'knock' || r.decision === 'biggin');
    const declinedKnocks = discards.filter((r) => r.declinedKnock === 1).length;

    out.push({
      playerUid: uid,
      playerName: rs[rs.length - 1].playerName,
      games: new Set(rs.map((r) => r.matchId)).size,
      decisions: rs.length,
      // How often the player takes a card from the discard/upcard vs stock.
      drawTakeRate: rate(draws.filter((r) => r.tookDiscard === 1).length, draws.length),
      // Discipline: takes the visible card when it helps; grabs it when it doesn't.
      takeWhenUsefulRate: rate(usefulDraws.filter((r) => r.tookDiscard === 1).length, usefulDraws.length),
      grabWhenUselessRate: rate(uselessDraws.filter((r) => r.tookDiscard === 1).length, uselessDraws.length),
      avgDiscardPip: mean(discards.map((r) => Number(r.discardedPip))),
      avgDiscardHoldTurns: mean(discards.map((r) => Number(r.discardHoldTurns))),
      avgHighCardHoldTurns: mean(highDiscards.map((r) => Number(r.discardHoldTurns))),
      // Of all the times a knock was on the table, how often they held for gin.
      holdForGinRate: rate(declinedKnocks, declinedKnocks + knocks.length),
      knocks: knocks.filter((r) => r.knockType === 'knock' || r.knockType === 'undercut').length,
      gins: knocks.filter((r) => r.knockType === 'gin').length,
      bigGins: knocks.filter((r) => r.knockType === 'bigGin').length,
      avgDeadwoodAtKnock: mean(
        knocks.map((r) => Number(r.deadwoodAtKnock)).filter((n) => Number.isFinite(n)),
      ),
    });
  }
  return out.sort((a, b) => Number(b.decisions) - Number(a.decisions));
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(cols: readonly string[], rows: Row[]): string {
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell((r as Row)[c as keyof Row])).join(','));
  return lines.join('\n') + '\n';
}

// ── main ─────────────────────────────────────────────────────────────────────
function parseArgs(args: string[]) {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) opts[a.slice(2)] = args[++i] ?? '';
    else positional.push(a);
  }
  return { positional, opts };
}

function main() {
  const { positional, opts } = parseArgs(argv.slice(2));
  const dumpPath = positional[0];
  if (!dumpPath) {
    console.error('usage: extract-features <dump.json> [--out features.csv] [--summary players.csv]');
    exit(1);
  }
  const outPath = resolve(opts.out ?? 'scripts/analytics/out/features.csv');
  const summaryPath = resolve(opts.summary ?? 'scripts/analytics/out/players.csv');

  const matches: Record<string, Json> = loadMatches(dumpPath);

  const allRows: Row[] = [];
  let gaps = 0;
  let usable = 0;
  for (const [mid, match] of Object.entries(matches)) {
    if (!match || typeof match !== 'object' || !('initial' in match)) continue;
    const { rows, gap } = extractMatch(mid, match);
    if (gap) gaps++;
    if (rows.length) usable++;
    allRows.push(...rows);
  }

  const summary = summarize(allRows);
  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(outPath, toCsv(COLUMNS, allRows));
  writeFileSync(summaryPath, toCsv(SUMMARY_COLUMNS, summary));

  console.log(`matches: ${Object.keys(matches).length} (${usable} with decisions, ${gaps} truncated by a capture gap)`);
  console.log(`decisions: ${allRows.length} rows -> ${outPath}`);
  console.log(`players:   ${summary.length} -> ${summaryPath}`);
  if (summary.length) {
    console.log('\nper-player summary:');
    console.table(
      summary.map((s) => ({
        player: s.playerName,
        games: s.games,
        decisions: s.decisions,
        drawTake: s.drawTakeRate,
        avgDiscPip: s.avgDiscardPip,
        holdForGin: s.holdForGinRate,
        gins: s.gins,
        knocks: s.knocks,
        avgKnockDW: s.avgDeadwoodAtKnock,
      })),
    );
  }
}

main();
