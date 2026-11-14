import { initialMatchState, applyMove, legalMoves } from '../reducer';
import { knockOptions } from '../melds';
import { pipValue } from '../cards';
import { makeRng } from '../rng';
import type { GameState, Move } from '../types';

const CAP = 300;
const GAMES = 2000;

function conserved(s: GameState): boolean {
  const all = [...s.stock, ...s.discard, ...s.hands.p0, ...s.hands.p1];
  return all.length === 52 && new Set(all).size === 52;
}

/** Pick a legal move + acting uid for the current state, or null to stop. */
function pick(
  s: GameState,
  rng: () => number,
): { move: Move; uid: string } | null {
  if (s.phase === 'matchOver') return null;
  const ri = () => Math.floor(rng() * 1e9);
  if (s.phase === 'roundOver') {
    return { move: { kind: 'nextRound', seed: [ri(), ri()] }, uid: s.players.p0 };
  }
  const uid = s.turnUid;
  const legal = legalMoves(s, uid);
  const seat = s.turn;
  const hand = s.hands[seat];

  if (s.phase === 'upcard1' || s.phase === 'upcard2') {
    return {
      move: { kind: rng() < 0.5 ? 'takeUpcard' : 'passUpcard' },
      uid,
    };
  }
  if (s.phase === 'draw') {
    if (legal.includes('drawDiscard') && rng() < 0.35) {
      return { move: { kind: 'drawDiscard' }, uid };
    }
    return { move: { kind: 'drawStock' }, uid };
  }
  // discard phase
  if (legal.includes('bigGin')) {
    return { move: { kind: 'bigGin' }, uid };
  }
  if (legal.includes('knock')) {
    const opts = knockOptions(hand)
      .filter((o) => o.deadwoodAfter <= 10 && o.card !== s.noDiscard)
      .sort((a, b) => a.deadwoodAfter - b.deadwoodAfter);
    if (opts.length > 0) {
      return { move: { kind: 'knock', discard: opts[0].card }, uid };
    }
  }
  // plain discard: shed the highest-pip card that isn't the just-taken one
  const candidates = hand.filter((c) => c !== s.noDiscard);
  let best = candidates[0];
  for (const c of candidates) if (pipValue(c) > pipValue(best)) best = c;
  return { move: { kind: 'discard', card: best }, uid };
}

describe('fuzz', () => {
  test(
    'plays 2000 seeded games with invariants held every step',
    () => {
      let reachedMatchOver = 0;
      for (let g = 0; g < GAMES; g++) {
        const rng = makeRng([g + 1, 0x9e3779b9, (g * 2654435761) >>> 0]);
        const seed = [Math.floor(rng() * 1e9), Math.floor(rng() * 1e9)];
        let s = initialMatchState({
          hostUid: 'H', guestUid: 'G', hostName: 'H', guestName: 'G', seed,
        });

        expect(conserved(s)).toBe(true);
        let sawTerminal = false;
        let moves = 0;
        let prevVersion = s.version;

        while (moves < CAP) {
          if (s.phase === 'matchOver') {
            reachedMatchOver++;
            sawTerminal = true;
            break;
          }
          const choice = pick(s, rng);
          if (choice === null) break;
          const res = applyMove(s, choice.move, choice.uid);
          if (!res.ok) {
            throw new Error(
              `game ${g} move ${moves} rejected: ${res.error} (${JSON.stringify(choice.move)}, phase ${s.phase})`,
            );
          }
          const next = res.state;
          // version strictly increases
          expect(next.version).toBeGreaterThan(prevVersion);
          prevVersion = next.version;
          // 52 unique cards conserved
          if (!conserved(next)) {
            throw new Error(`game ${g} move ${moves}: card conservation broken`);
          }
          if (next.phase === 'roundOver' || next.phase === 'matchOver') {
            sawTerminal = true;
          }
          s = next;
          moves++;
        }

        expect(sawTerminal).toBe(true);
      }
      // Random play should complete plenty of full matches.
      expect(reachedMatchOver).toBeGreaterThan(0);
    },
    180000,
  );
});
