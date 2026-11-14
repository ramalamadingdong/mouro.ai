/**
 * Fuzz: thousands of hands of random LEGAL play, with the invariants checked
 * after every single move (see `checkInvariants` in helpers.ts). Each game is
 * a pure function of its index, so any failure reproduces exactly.
 */
import { describe, expect, it } from 'vitest';
import { applyMove, makeRng, totalChips } from '@/engine';
import { checkInvariants, newGame, randomLegalMove } from './helpers';

describe('fuzz', () => {
  it('plays 3,000+ random hands without breaking an invariant', { timeout: 60_000 }, () => {
    let hands = 0;
    let showdowns = 0;
    let sidePots = 0;
    let splits = 0;
    for (let game = 0; hands < 3000; game++) {
      const rng = makeRng([game, 0xf22]);
      const seats = 2 + (game % 5);
      let s = newGame(seats, [500, 1000, 2000, 5000][game % 4], 1 + (game % 7));
      const chips = totalChips(s);
      let version = s.version;
      let handMoves = 0;

      // Play to the end of the game (the rising blinds guarantee there is one).
      for (let step = 0; s.phase !== 'gameover'; step++) {
        expect(step, `game ${game} never ends`).toBeLessThan(40_000);
        const { move, uid } = randomLegalMove(s, rng);
        const result = applyMove(s, move, uid);
        const label = `game ${game} step ${step} ${move.kind}`;
        // A move chosen from legalActions must never be refused.
        if (!result.ok) throw new Error(`${label}: legal move rejected — ${result.error}`);
        const prevHand = s.handNo;
        s = result.state;
        expect(s.version, `${label}: version`).toBe(version + 1);
        version = s.version;
        checkInvariants(s, chips, label);

        // A hand always terminates: bounded moves between deals.
        handMoves = s.handNo === prevHand ? handMoves + 1 : 0;
        expect(handMoves, `${label}: hand never ends`).toBeLessThan(400);

        if (move.kind !== 'deal' && s.phase === 'showdown' && s.lastMove?.kind !== 'deal') {
          if (s.result!.showdown) showdowns++;
          if (s.result!.pots.length > 1) sidePots++;
          if (s.result!.pots.some((p) => p.winners.length > 1)) splits++;
        }
        if (move.kind === 'deal' && s.phase !== 'gameover') hands++;
      }

      // Game over: one stack holds everything, or the human is out.
      const alive = s.players.filter((p) => p.stack > 0);
      expect(alive.length === 1 || s.players[0].stack === 0, `game ${game}: why did it end`).toBe(true);
      expect(s.players[s.winner!].stack, `game ${game}: winner is the chip leader`).toBe(Math.max(...s.players.map((p) => p.stack)));
    }
    // The run must actually have exercised the interesting paths.
    expect(showdowns).toBeGreaterThan(300);
    expect(sidePots).toBeGreaterThan(50);
    expect(splits).toBeGreaterThan(0);
  });
});
