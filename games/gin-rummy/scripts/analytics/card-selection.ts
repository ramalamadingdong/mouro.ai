/**
 * card-selection.ts — audit DRAW and DISCARD decisions (not knock timing).
 *
 * Replays every archived match and, at each decision, compares what the player
 * actually did against what the engine says was available at that moment:
 *
 *  - Discard optimality: the chosen discard's resulting deadwood vs the BEST
 *    reachable deadwood from that same 11-card hand. The gap is avoidable
 *    deadwood the player left on the table, in pips, per discard.
 *  - Feeding: how often a discard was immediately taken by the opponent (the
 *    next move in the stream is their `drawDiscard`).
 *  - Draw discipline: took the face-up card when it helped / grabbed it when it
 *    didn't / passed it up when it would have helped.
 *  - Caught deadwood: what the player was holding when they LOST a round.
 *
 * Run: npm run card-selection -- <dump.json>
 */
import { argv, exit } from 'node:process';

import { applyMove, deadwoodValue, knockOptions, normalize, pipValue, cardToAscii } from '../../src/engine';
import type { CardId, GameState, Seat } from '../../src/engine/types';
import { loadMatches, sortLog } from './replay';

interface Stats {
  name: string;
  discards: number;
  /** Avoidable deadwood (pips) left by not making the best discard. */
  loss: number[];
  suboptimal: number;
  /** Worst individual misplays, for illustration. */
  worst: { card: string; lost: number; actual: number; best: string; round: number; match: string }[];
  fed: number;          // discards the opponent immediately took
  fedable: number;      // discards where the opponent had a chance to respond
  chosenPips: number[]; // pip of the card actually thrown
  bestPips: number[];   // pip of the card that would have been best
  lowForHigh: number;   // threw a low card (<=3) when a high one (>=8) was better
  drawUseful: number;   // face-up card would have helped
  drawUsefulTaken: number;
  drawUseless: number;  // face-up card would not have helped
  drawUselessTaken: number;
  caughtDeadwood: number[];
  holdHigh: number[];   // hold-turns for discarded cards with pip >= 8
}

const newStats = (name: string): Stats => ({
  name, discards: 0, loss: [], suboptimal: 0, worst: [],
  fed: 0, fedable: 0, chosenPips: [], bestPips: [], lowForHigh: 0,
  drawUseful: 0, drawUsefulTaken: 0, drawUseless: 0, drawUselessTaken: 0,
  caughtDeadwood: [], holdHigh: [],
});

const top = (p: CardId[]) => (p.length ? p[p.length - 1] : null);
const other = (s: Seat): Seat => (s === 'p0' ? 'p1' : 'p0');
const HIGH_PIP = 8;

/** Best 10-card deadwood reachable if `card` were taken into `hand`. */
function deadwoodIfTake(hand: CardId[], card: CardId): number {
  let best = Infinity;
  for (const o of knockOptions([...hand, card])) best = Math.min(best, o.deadwoodAfter);
  return best;
}

function mean(xs: number[]): string {
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '—';
}
function pct(n: number, d: number): string {
  return d ? ((100 * n) / d).toFixed(1) + '%' : '—';
}

function main() {
  const dumpPath = argv[2];
  if (!dumpPath) {
    console.error('usage: card-selection <dump.json>');
    exit(1);
  }
  const matches = loadMatches(dumpPath);
  const byUid = new Map<string, Stats>();

  for (const [matchId, match] of Object.entries<any>(matches)) {
    const state0 = normalize(match.initial);
    if (!state0) continue;
    let state: GameState = state0;
    const entries = sortLog(match.log);

    // Per-round acquisition tracking, for how long a discarded card was held.
    let turn: Record<Seat, number> = { p0: 0, p1: 0 };
    let acquired: Record<Seat, Map<CardId, number>> = {
      p0: new Map(state.hands.p0.map((c) => [c, 0])),
      p1: new Map(state.hands.p1.map((c) => [c, 0])),
    };
    let lastScoredRound = -1;

    for (let i = 0; i < entries.length; i++) {
      const { v, seat, move } = entries[i];
      if (v !== state.version + 1) break;
      const pre = state;
      const uid = pre.players[seat];
      const st = byUid.get(uid) ?? newStats(pre.names[seat]);
      byUid.set(uid, st);

      const hand = pre.hands[seat];
      const face = top(pre.discard);
      const kind = move.kind;

      // ── draw discipline ────────────────────────────────────────────────
      if (kind === 'drawStock' || kind === 'drawDiscard' || kind === 'takeUpcard' || kind === 'passUpcard') {
        if (face !== null) {
          const helps = deadwoodIfTake(hand, face) < deadwoodValue(hand);
          const took = kind === 'drawDiscard' || kind === 'takeUpcard';
          if (helps) { st.drawUseful++; if (took) st.drawUsefulTaken++; }
          else { st.drawUseless++; if (took) st.drawUselessTaken++; }
        }
        if (kind !== 'passUpcard') {
          turn[seat]++;
          const got = kind === 'drawStock' ? top(pre.stock) : face;
          if (got !== null) acquired[seat].set(got, turn[seat]);
        }
      }

      // ── discard quality (plain discards only; a knock discard is constrained
      //    by the decision to knock, which is a different question) ─────────
      if (kind === 'discard') {
        const card = (move as { card: CardId }).card;
        const opts = knockOptions(hand).filter((o) => o.card !== pre.noDiscard);
        const best = opts.reduce((a, b) => (b.deadwoodAfter < a.deadwoodAfter ? b : a), opts[0]);
        const actual = deadwoodValue(hand.filter((c) => c !== card));
        const lost = actual - best.deadwoodAfter;

        st.discards++;
        st.loss.push(lost);
        st.chosenPips.push(pipValue(card));
        st.bestPips.push(pipValue(best.card));
        // The classic leak: dumping a cheap card to hang on to an expensive one.
        if (lost > 0 && pipValue(card) <= 3 && pipValue(best.card) >= HIGH_PIP) st.lowForHigh++;
        if (lost > 0) {
          st.suboptimal++;
          st.worst.push({
            card: cardToAscii(card), lost, actual,
            best: cardToAscii(best.card), round: pre.round, match: matchId.split('-')[0],
          });
        }
        if (pipValue(card) >= HIGH_PIP) {
          st.holdHigh.push(turn[seat] - (acquired[seat].get(card) ?? 0));
        }
        // Did the opponent pounce on it? Their very next move is a draw.
        const nxt = entries[i + 1];
        if (nxt && nxt.seat === other(seat)) {
          st.fedable++;
          if (nxt.move.kind === 'drawDiscard') st.fed++;
        }
      }

      const applied = applyMove(pre, move, uid);
      if (!applied.ok) break;
      state = applied.state;

      // Deadwood the LOSER was caught holding.
      const rr = state.roundResult;
      if (rr && rr.winner && state.round !== lastScoredRound) {
        lastScoredRound = state.round;
        const loser = other(rr.winner);
        const luid = state.players[loser];
        const ls = byUid.get(luid) ?? newStats(state.names[loser]);
        ls.caughtDeadwood.push(rr.deadwood[loser]);
        byUid.set(luid, ls);
      }

      if (kind === 'nextRound' || kind === 'rematch') {
        turn = { p0: 0, p1: 0 };
        acquired = {
          p0: new Map(state.hands.p0.map((c) => [c, 0])),
          p1: new Map(state.hands.p1.map((c) => [c, 0])),
        };
        lastScoredRound = -1;
      }
    }
  }

  const rows = [...byUid.values()];
  console.log('\nDISCARD QUALITY  (how close each discard was to the best available)');
  console.table(rows.map((s) => ({
    player: s.name,
    discards: s.discards,
    suboptimal: pct(s.suboptimal, s.discards),
    avgPipsLost: mean(s.loss),
    totalPipsLost: s.loss.reduce((a, b) => a + b, 0),
    avgPipThrown: mean(s.chosenPips),
    avgPipBest: mean(s.bestPips),
    lowForHigh: `${s.lowForHigh} (${pct(s.lowForHigh, s.suboptimal)} of misplays)`,
  })));

  console.log('DRAW DISCIPLINE  (the face-up card was visible — did they use it?)');
  console.table(rows.map((s) => ({
    player: s.name,
    tookWhenUseful: pct(s.drawUsefulTaken, s.drawUseful),
    passedUpUseful: pct(s.drawUseful - s.drawUsefulTaken, s.drawUseful),
    grabbedWhenUseless: pct(s.drawUselessTaken, s.drawUseless),
  })));

  console.log('DISCARD SAFETY & HOLDING');
  console.table(rows.map((s) => ({
    player: s.name,
    fedOpponent: pct(s.fed, s.fedable),
    fedCount: `${s.fed}/${s.fedable}`,
    avgHighCardHoldTurns: mean(s.holdHigh),
    avgDeadwoodCaughtWith: mean(s.caughtDeadwood),
  })));

  for (const s of rows) {
    const worst = s.worst.sort((a, b) => b.lost - a.lost).slice(0, 5);
    if (!worst.length) continue;
    console.log(`\nWorst discards — ${s.name}:`);
    for (const w of worst) {
      console.log(
        `  threw ${w.card} (left ${w.actual} deadwood) — ${w.best} was better by ${w.lost} pips  [${w.match} r${w.round}]`,
      );
    }
  }
}

main();
