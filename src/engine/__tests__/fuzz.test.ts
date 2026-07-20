/**
 * The highest-value test in the codebase.
 *
 * Because every source of randomness is a seed carried inside a move, a whole
 * game is a pure function of its game index `g`. This plays thousands of fully
 * seeded games, drives every decision from `legalMoves` / `legalCategories`, and
 * asserts the domain invariants after EVERY step — including a round-trip
 * through simulated Realtime Database transport damage, which is the failure
 * mode no unit test tends to reach.
 *
 * Any failure is exactly reproducible: rerun with the `g` printed in the message.
 */

import { describe, expect, test } from 'vitest';
import { applyMove, initialGameState, legalCategories, legalMoves } from '../reducer';
import { makeRng } from '../rng';
import { breakdown, scoreFor } from '../scoring';
import { normalize } from '../serialize';
import { CATEGORIES, RULES, type GameState, type Move } from '../types';

const GAMES = 2000;

/**
 * Mimic what Realtime Database does to a value in transit: prune nulls and
 * anything that ends up empty, and deliver every array as an integer-keyed
 * object. Returns `undefined` for a value RTDB would drop entirely.
 */
function toWire(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const o: Record<string, unknown> = {};
    v.forEach((x, i) => {
      const w = toWire(x);
      if (w !== undefined) o[String(i)] = w;
    });
    return Object.keys(o).length > 0 ? o : undefined;
  }
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const w = toWire(x);
      if (w !== undefined) o[k] = w;
    }
    return Object.keys(o).length > 0 ? o : undefined;
  }
  return v;
}

/** Every structural invariant that must hold of any state the reducer produces. */
function checkInvariants(s: GameState, where: string): void {
  const n = s.players.length;

  if (s.turnUid !== s.players[s.turn].uid) {
    throw new Error(`${where}: turnUid drifted from players[turn]`);
  }
  if (s.dice.length !== 0 && s.dice.length !== RULES.DICE) {
    throw new Error(`${where}: ${s.dice.length} dice on the table`);
  }
  for (const d of s.dice) {
    if (!Number.isInteger(d) || d < 1 || d > RULES.FACES) {
      throw new Error(`${where}: impossible die face ${d}`);
    }
  }
  if (s.rollsUsed < 0 || s.rollsUsed > RULES.ROLLS_PER_TURN) {
    throw new Error(`${where}: rollsUsed = ${s.rollsUsed}`);
  }
  if (s.cards.length !== n || s.yahtzeeBonus.length !== n) {
    throw new Error(`${where}: per-seat arrays out of step with players`);
  }
  if ((s.phase === 'over') !== (s.result !== null)) {
    throw new Error(`${where}: phase/result disagree`);
  }

  // A snapshot must survive the wire unchanged. This is the invariant that
  // catches pruned empties, sparse seat-indexed arrays, and any place a
  // legitimately-zero score gets coerced back to "open".
  const round = normalize(toWire(s));
  if (round === null) {
    throw new Error(`${where}: normalize rejected a state the reducer produced`);
  }
  expect(round).toEqual(s);
}

describe('fuzz', () => {
  test(
    `${GAMES} fully-seeded games hold every invariant`,
    () => {
      let reachedOver = 0;
      let sawYahtzeeBonus = 0;
      let sawJokerForced = 0;

      for (let g = 0; g < GAMES; g++) {
        // Decorrelate adjacent game indices — makeRng([g]) alone gives
        // correlated streams and the fuzzer explores far less.
        const rng = makeRng([g + 1, 0x9e3779b9, (g * 2654435761) >>> 0]);
        const seatCount = 1 + Math.floor(rng() * RULES.MAX_PLAYERS);
        const players = Array.from({ length: seatCount }, (_, i) => ({
          uid: `u${i}`,
          name: `P${i}`,
        }));

        let s = initialGameState(players);
        checkInvariants(s, `game ${g} initial`);

        let prevVersion = s.version;
        let scoresMade = 0;
        const filled = new Array<number>(seatCount).fill(0);
        // Every turn ends in exactly one score, so the game is bounded: any
        // overshoot means the reducer failed to terminate.
        const cap = RULES.ROUNDS * seatCount * (RULES.ROLLS_PER_TURN + 1) + 8;
        let steps = 0;

        while (s.phase !== 'over' && steps < cap) {
          const uid = s.turnUid;
          const seat = s.turn;
          const legal = legalMoves(s, uid);
          if (legal.length === 0) throw new Error(`game ${g}: stuck with no legal move`);

          // Roll while rolls remain, with a bias toward stopping early so both
          // the re-roll path and the score-immediately path get exercised.
          const mustScore = !legal.includes('roll');
          const wantScore = mustScore || (s.phase === 'decide' && rng() < 0.4);

          let move: Move;
          if (!wantScore) {
            const keep: number[] = [];
            if (s.rollsUsed > 0) {
              for (let i = 0; i < RULES.DICE; i++) if (rng() < 0.45) keep.push(i);
              // Keeping all five is not a roll; drop one so the payload is legal.
              if (keep.length === RULES.DICE) keep.pop();
            }
            move = { kind: 'roll', keep, seed: [Math.floor(rng() * 1e9), g, steps] };
          } else {
            const options = legalCategories(s, seat);
            if (options.length === 0) throw new Error(`game ${g}: no scorable category`);
            if (options.length === 1 && CATEGORIES.length > 1) sawJokerForced++;
            // Half the time take the best available box, half the time take a
            // random one — greedy alone never scratches, random alone never
            // builds an upper bonus, and both paths need coverage.
            let category = options[Math.floor(rng() * options.length)];
            if (rng() < 0.5) {
              const joker =
                s.dice.length === RULES.DICE &&
                s.dice.every((d) => d === s.dice[0]) &&
                s.cards[seat].yahtzee !== null;
              let best = -1;
              for (const c of options) {
                const v = scoreFor(c, s.dice, joker);
                if (v > best) {
                  best = v;
                  category = c;
                }
              }
            }
            move = { kind: 'score', category };
          }

          const res = applyMove(s, move, uid);
          if (!res.ok) {
            throw new Error(
              `game ${g} step ${steps} rejected: ${res.error} ` +
                `(${JSON.stringify(move)}, phase ${s.phase}, rollsUsed ${s.rollsUsed})`,
            );
          }
          const next = res.state;

          if (next.version <= prevVersion) {
            throw new Error(`game ${g} step ${steps}: version did not advance`);
          }
          prevVersion = next.version;

          if (move.kind === 'score') {
            scoresMade++;
            filled[seat]++;
            let used = 0;
            for (const cat of CATEGORIES) if (next.cards[seat][cat] !== null) used++;
            if (used !== filled[seat]) {
              throw new Error(
                `game ${g} step ${steps}: seat ${seat} has ${used} filled boxes, expected ${filled[seat]}`,
              );
            }
          }

          checkInvariants(next, `game ${g} step ${steps}`);
          s = next;
          steps++;
        }

        if (s.phase !== 'over') throw new Error(`game ${g}: never finished (${steps} steps)`);
        reachedOver++;

        // Exactly one score per seat per round — no box scored twice, none skipped.
        expect(scoresMade).toBe(RULES.ROUNDS * seatCount);

        // The published result must reconcile with the cards it claims to total.
        s.result!.scores.forEach((got, seat) => {
          expect(got).toEqual(breakdown(s.cards[seat], s.yahtzeeBonus[seat]));
        });
        const best = Math.max(...s.result!.scores.map((b) => b.total));
        expect(s.result!.winners.length).toBeGreaterThan(0);
        for (const w of s.result!.winners) expect(s.result!.scores[w].total).toBe(best);

        for (const b of s.yahtzeeBonus) if (b > 0) sawYahtzeeBonus++;

        // A finished game accepts a rematch from any seat and nothing else.
        for (const p of s.players) expect(legalMoves(s, p.uid)).toEqual(['rematch']);
      }

      expect(reachedOver).toBe(GAMES);
      // Coverage guards: if these ever hit zero the fuzzer has gone vacuous and
      // the joker/bonus rules are no longer being exercised at all.
      expect(sawYahtzeeBonus).toBeGreaterThan(0);
      expect(sawJokerForced).toBeGreaterThan(0);
    },
    180_000,
  );
});
