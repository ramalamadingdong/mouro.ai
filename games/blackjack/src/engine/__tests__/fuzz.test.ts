/**
 * Fuzz: thousands of rounds of random LEGAL play, with the invariants checked
 * after every single move (see `checkInvariants` in helpers.ts). Each game is
 * a pure function of its index, so any failure reproduces exactly.
 */
import { describe, expect, it } from 'vitest';
import { applyMove, makeRng, totalChips } from '@/engine';
import { checkInvariants, newGame, randomLegalMove } from './helpers';

describe('fuzz', () => {
  it('plays 3,000+ random rounds without breaking an invariant', { timeout: 120_000 }, () => {
    let rounds = 0;
    let blackjacks = 0;
    let splits = 0;
    let doubles = 0;
    let dealerBusts = 0;
    let reshuffles = 0;
    let surrenders = 0;
    for (let game = 0; rounds < 3000; game++) {
      const rng = makeRng([game, 0xb1a]);
      const seats = 1 + (game % 8);
      let s = newGame(seats, [500, 1000, 2500][game % 3], 5 + (game % 30));
      const chips = totalChips(s);
      let version = s.version;
      let roundMoves = 0;

      for (let step = 0; s.phase !== 'gameover'; step++) {
        expect(step, `game ${game} never ends`).toBeLessThan(40_000);
        const { move, uid } = randomLegalMove(s, rng);
        const result = applyMove(s, move, uid);
        const label = `game ${game} step ${step} ${move.kind}`;
        // A move chosen from legalActions must never be refused.
        if (!result.ok) throw new Error(`${label}: legal move rejected — ${result.error}`);
        const prev = s;
        s = result.state;
        expect(s.version, `${label}: version`).toBe(version + 1);
        version = s.version;
        checkInvariants(s, chips, label);

        roundMoves = s.handNo === prev.handNo ? roundMoves + 1 : 0;
        expect(roundMoves, `${label}: round never ends`).toBeLessThan(400);

        if (move.kind === 'deal' && s.phase !== 'gameover') {
          rounds++;
          if (s.shoe.length > prev.shoe.length) reshuffles++;
        }
        if (move.kind === 'split') splits++;
        if (move.kind === 'double') doubles++;
        if (move.kind === 'surrender') surrenders++;
        if (s.phase === 'settled' && prev.phase !== 'settled' && s.result) {
          if (s.result.dealerTotal > 21) dealerBusts++;
          blackjacks += s.players.flatMap((p) => p.hands).filter((h) => h.outcome === 'blackjack').length;
        }
      }

      expect(s.players[s.winner!].stack, `game ${game}: winner is the chip leader`).toBe(Math.max(...s.players.map((p) => p.stack)));
    }
    // The run must actually have exercised the interesting paths.
    expect(blackjacks).toBeGreaterThan(100);
    expect(splits).toBeGreaterThan(100);
    expect(doubles).toBeGreaterThan(100);
    expect(dealerBusts).toBeGreaterThan(100);
    expect(reshuffles).toBeGreaterThan(5);
    expect(surrenders).toBeGreaterThan(30);
  });
});
