/**
 * head-to-head.ts — replay archived matches and tally player vs player.
 *
 * Reports, per matchup and per player: matches won, rounds won, points scored,
 * and how those points were made (gin / big gin / knock / undercut), plus the
 * average deadwood each player knocks with. Match results come from the engine's
 * own `matchResult` after replay, so bonuses (game bonus, boxes, shutout) are
 * included exactly as the app scored them.
 *
 * Unfinished matches (abandoned before anyone hit the target) are counted for
 * ROUNDS and points but not for match W/L, and are reported separately.
 *
 * Run: npm run head-to-head -- <dump.json>
 */
import { argv, exit } from 'node:process';

import { applyMove, normalize } from '../../src/engine';
import type { GameState, Seat } from '../../src/engine/types';
import { loadMatches, sortLog } from './replay';

interface Tally {
  matchesWon: number;
  roundsWon: number;
  points: number;
  gins: number;
  bigGins: number;
  knocks: number;
  undercuts: number;
  knockDeadwoods: number[];
}
const newTally = (): Tally => ({
  matchesWon: 0, roundsWon: 0, points: 0,
  gins: 0, bigGins: 0, knocks: 0, undercuts: 0, knockDeadwoods: [],
});

/** Replay one match to its final state, collecting per-seat round outcomes. */
function replayMatch(match: any) {
  const state0 = normalize(match.initial);
  if (!state0) return null;

  let state: GameState = state0;
  const perSeat: Record<Seat, Tally> = { p0: newTally(), p1: newTally() };
  let rounds = 0;
  let gap = false;
  // roundResult persists across the roundOver phase, so only score each round once.
  let lastScoredRound = -1;

  for (const { v, seat, move } of sortLog(match.log)) {
    if (v !== state.version + 1) { gap = true; break; }
    const applied = applyMove(state, move, state.players[seat]);
    if (!applied.ok) { gap = true; break; }
    state = applied.state;

    const rr = state.roundResult;
    if (rr && rr.winner && state.round !== lastScoredRound) {
      lastScoredRound = state.round;
      rounds++;
      const w = perSeat[rr.winner];
      w.roundsWon++;
      w.points += rr.points;
      if (rr.type === 'gin') w.gins++;
      else if (rr.type === 'bigGin') w.bigGins++;
      else if (rr.type === 'knock') w.knocks++;
      else if (rr.type === 'undercut') w.undercuts++;
      // Deadwood the KNOCKER carried, for REAL knocks only (on an undercut the
      // knocker is the loser). Gin/big gin are excluded — they are 0 by
      // definition and would just dilute the average toward zero.
      if (rr.knocker && (rr.type === 'knock' || rr.type === 'undercut')) {
        perSeat[rr.knocker].knockDeadwoods.push(rr.deadwood[rr.knocker]);
      }
    }
  }

  return {
    names: state.names,
    players: state.players,
    perSeat,
    rounds,
    gap,
    finished: state.phase === 'matchOver',
    winner: state.matchResult?.winner ?? null,
    finalScores: state.scores,
  };
}

function mean(xs: number[]): string {
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—';
}

function main() {
  const dumpPath = argv[2];
  if (!dumpPath) {
    console.error('usage: head-to-head <dump.json>');
    exit(1);
  }
  const matches = loadMatches(dumpPath);

  // Aggregate by uid (the stable identity); names are for display only.
  const byUid = new Map<string, Tally>();
  const nameOf = new Map<string, string>();
  // Matchup key = the two uids, order-independent.
  const pairs = new Map<string, { uids: [string, string]; played: number; finished: number; wins: Record<string, number> }>();

  let total = 0, finished = 0, unfinished = 0, gaps = 0, unreadable = 0;

  for (const [, match] of Object.entries<any>(matches)) {
    const r = replayMatch(match);
    if (!r) { unreadable++; continue; }
    total++;
    if (r.gap) gaps++;
    if (r.finished) finished++; else unfinished++;

    const uids: [string, string] = [r.players.p0, r.players.p1];
    for (const seat of ['p0', 'p1'] as Seat[]) {
      const uid = r.players[seat];
      nameOf.set(uid, r.names[seat]);
      const t = byUid.get(uid) ?? newTally();
      const s = r.perSeat[seat];
      t.roundsWon += s.roundsWon;
      t.points += s.points;
      t.gins += s.gins;
      t.bigGins += s.bigGins;
      t.knocks += s.knocks;
      t.undercuts += s.undercuts;
      t.knockDeadwoods.push(...s.knockDeadwoods);
      if (r.finished && r.winner === seat) t.matchesWon++;
      byUid.set(uid, t);
    }

    const key = [...uids].sort().join('|');
    const p = pairs.get(key) ?? { uids, played: 0, finished: 0, wins: { [uids[0]]: 0, [uids[1]]: 0 } };
    p.played++;
    if (r.finished) {
      p.finished++;
      if (r.winner) p.wins[r.players[r.winner]]++;
    }
    pairs.set(key, p);
  }

  console.log(
    `\n${total} matches replayed — ${finished} finished, ${unfinished} unfinished` +
    `${gaps ? `, ${gaps} truncated by a capture gap` : ''}` +
    `${unreadable ? `, ${unreadable} unreadable` : ''}\n`,
  );

  console.log('HEAD TO HEAD (finished matches)');
  for (const p of pairs.values()) {
    const [a, b] = p.uids;
    const an = nameOf.get(a) ?? a, bn = nameOf.get(b) ?? b;
    console.log(
      `  ${an} ${p.wins[a]} — ${p.wins[b]} ${bn}   ` +
      `(${p.finished} finished of ${p.played} played)`,
    );
  }

  console.log('\nPER PLAYER');
  console.table(
    [...byUid.entries()]
      .sort((x, y) => y[1].roundsWon - x[1].roundsWon)
      .map(([uid, t]) => ({
        player: nameOf.get(uid) ?? uid,
        matchesWon: t.matchesWon,
        roundsWon: t.roundsWon,
        points: t.points,
        gin: t.gins,
        bigGin: t.bigGins,
        knock: t.knocks,
        undercut: t.undercuts,
        timesKnocked: t.knockDeadwoods.length,
        avgDwOnKnock: mean(t.knockDeadwoods),
        ptsPerRound: t.roundsWon ? (t.points / t.roundsWon).toFixed(1) : '—',
      })),
  );
}

main();
