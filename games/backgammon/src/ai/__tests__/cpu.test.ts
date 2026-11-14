/**
 * The computer opponent must be legal, deterministic, and actually better at
 * the harder settings. Those three properties are what the difficulty picker
 * promises, so they are what is tested.
 */
import { chooseLine, chooseMove } from '../cpu';
import { shouldDouble, shouldTake } from '../cube-policy';
import { blotRisk, evaluate, oppPips, scratchPips } from '../eval';
import { DIFFICULTIES, type Difficulty } from '../difficulty';
import { toScratch } from '@/engine/board';
import { isCompleteTurn, maxUsableDice, turnLines } from '@/engine/moves';
import { applyMove, initialMatchState, legalMoves } from '@/engine/reducer';
import { makeRng } from '@/engine/rng';
import type { GameState, Move, Seat } from '@/engine/types';

const HOST = 'H';
const GUEST = 'G';

function fresh(target = 5): GameState {
  return initialMatchState({
    hostUid: HOST,
    guestUid: GUEST,
    hostName: 'Host',
    guestName: 'CPU',
    target,
  });
}

/** Play a whole match with both seats driven by the CPU. */
function playMatch(
  seed: number,
  p0: Difficulty,
  p1: Difficulty,
  onStep?: (s: GameState, seat: Seat, move: Move) => void,
): GameState {
  const rng = makeRng([seed, 0xc9a]);
  let s = fresh(3);
  let guard = 0;

  while (s.phase !== 'matchOver' && guard++ < 3000) {
    const actor = s.phase === 'gameOver' ? HOST : s.turnUid;
    const seat: Seat = actor === HOST ? 'p0' : 'p1';
    const move = chooseMove(s, actor, seat === 'p0' ? p0 : p1, [
      seed,
      guard,
      Math.floor(rng() * 65536),
    ]);
    if (!move) throw new Error(`no move in phase ${s.phase}`);
    onStep?.(s, seat, move);
    const r = applyMove(s, move, actor);
    if (!r.ok) throw new Error(`CPU move rejected in ${s.phase}: ${r.error}`);
    s = r.state;
  }
  if (s.phase !== 'matchOver') throw new Error('match did not finish');
  return s;
}

describe('evaluation primitives', () => {
  it('counts pips consistently with the engine at the opening position', () => {
    const s = fresh();
    const b = toScratch(s, 'p0');
    expect(scratchPips(b)).toBe(167);
    expect(oppPips(b)).toBe(167);
  });

  it('sees no shots when there are no blots', () => {
    const s = fresh();
    expect(blotRisk(toScratch(s, 'p0'), true)).toBe(0);
  });

  it('sees a direct shot on an exposed blot', () => {
    const s = fresh();
    // Split a back checker: p0's own 23 goes to own 20, leaving blots on both,
    // with p1's checkers sitting right behind them.
    s.points[23] = 1;
    s.points[20] = 1;
    s.points[12] = 4;
    const risk = blotRisk(toScratch(s, 'p0'), true);
    expect(risk).toBeGreaterThan(0);
  });

  it('scores a safe position above the same position with a blot', () => {
    const safe = fresh();
    const exposed = fresh();
    exposed.points[13] = 1; // a lone checker out in the open
    exposed.points[12] = 4;
    expect(evaluate(toScratch(safe, 'p0'), true)).toBeGreaterThan(
      evaluate(toScratch(exposed, 'p0'), true),
    );
  });
});

describe('legality', () => {
  it('only ever returns legal turns, across every difficulty', () => {
    for (const d of DIFFICULTIES) {
      let checked = 0;
      playMatch(d === 'easy' ? 1 : d === 'medium' ? 2 : 3, d, d, (s, seat, move) => {
        if (move.kind !== 'play') return;
        expect(isCompleteTurn(s, seat, move.steps)).toBe(true);
        expect(move.steps.length).toBe(maxUsableDice(s, seat));
        checked += 1;
      });
      expect(checked).toBeGreaterThan(10);
    }
  });

  it('only ever returns a move that legalMoves allows', () => {
    playMatch(9, 'hard', 'medium', (s, seat, move) => {
      const uid = seat === 'p0' ? HOST : GUEST;
      expect(legalMoves(s, uid)).toContain(move.kind);
    });
  });

  it('plays the empty turn when the position is closed out', () => {
    const s = fresh();
    // Close every entry point against p0 and put a p0 checker on the bar.
    for (let i = 18; i < 24; i++) s.points[i] = -2;
    s.points[0] = 0;
    s.points[5] = 0;
    s.points[7] = 0;
    s.points[12] = 0;
    s.points[11] = 0;
    s.points[16] = 0;
    s.points[10] = 14;
    s.bar = { p0: 1, p1: 3 };
    s.off = { p0: 0, p1: 0 };
    s.dice = [4, 2];
    s.phase = 'moving';
    s.turn = 'p0';
    s.turnUid = HOST;
    expect(turnLines(s, 'p0')[0].steps).toEqual([]);
    expect(chooseLine(s, 'p0', 'hard')).toEqual([]);
  });
});

describe('determinism', () => {
  it('picks the same line for the same position, every time', () => {
    for (const d of DIFFICULTIES) {
      const s = fresh();
      s.dice = [6, 5];
      s.phase = 'moving';
      const a = chooseLine(s, 'p0', d);
      const b = chooseLine(s, 'p0', d);
      expect(a).toEqual(b);
    }
  });

  it('replays a whole match identically', () => {
    const a = playMatch(42, 'hard', 'easy');
    const b = playMatch(42, 'hard', 'easy');
    expect(a.scores).toEqual(b.scores);
    expect(a.matchResult).toEqual(b.matchResult);
  });
});

describe('difficulty actually differs', () => {
  it('hard beats easy over a run of matches', () => {
    let hardWins = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      // Alternate seats so neither difficulty gets a systematic first-move edge.
      const hardIsP0 = i % 2 === 0;
      const result = playMatch(1000 + i, hardIsP0 ? 'hard' : 'easy', hardIsP0 ? 'easy' : 'hard');
      const hardSeat: Seat = hardIsP0 ? 'p0' : 'p1';
      if (result.matchResult?.winner === hardSeat) hardWins += 1;
    }
    // Backgammon is dice-heavy, so this is a margin, not a rout.
    expect(hardWins).toBeGreaterThan(N * 0.6);
  }, 120_000);

  it('never doubles on easy, and does double on hard', () => {
    let easyDoubles = 0;
    let hardDoubles = 0;
    for (let i = 0; i < 12; i++) {
      playMatch(500 + i, 'easy', 'easy', (_s, _seat, move) => {
        if (move.kind === 'double') easyDoubles += 1;
      });
      playMatch(500 + i, 'hard', 'hard', (_s, _seat, move) => {
        if (move.kind === 'double') hardDoubles += 1;
      });
    }
    expect(easyDoubles).toBe(0);
    expect(hardDoubles).toBeGreaterThan(0);
  }, 120_000);
});

describe('cube policy', () => {
  const racing = (myPips: number, theirPips: number): GameState => {
    const s = fresh();
    // A pure race: strip the board to two stacks whose pip counts we control.
    s.points = new Array<number>(24).fill(0);
    // Place p0 so the pip count works out, and p1 likewise, both all home.
    s.points[Math.max(0, Math.min(5, Math.round(myPips / 15) - 1))] = 15;
    s.points[23 - Math.max(0, Math.min(5, Math.round(theirPips / 15) - 1))] = -15;
    s.phase = 'roll';
    s.turn = 'p0';
    s.turnUid = HOST;
    return s;
  };

  it('never doubles on easy', () => {
    expect(shouldDouble(racing(30, 90), 'p0', 'easy')).toBe(false);
  });

  it('doubles with a clear lead on medium', () => {
    expect(shouldDouble(racing(45, 75), 'p0', 'medium')).toBe(true);
  });

  it('does not double from behind', () => {
    expect(shouldDouble(racing(90, 30), 'p0', 'medium')).toBe(false);
  });

  it('respects the Crawford game', () => {
    const s = racing(45, 75);
    s.crawford = true;
    expect(shouldDouble(s, 'p0', 'hard')).toBe(false);
  });

  it('takes a close double and drops a hopeless one', () => {
    const close = racing(75, 70);
    close.offer = { by: 'p1', value: 2 };
    close.phase = 'doubled';
    expect(shouldTake(close, 'p0', 'medium')).toBe(true);

    const hopeless = racing(90, 20);
    hopeless.offer = { by: 'p1', value: 2 };
    hopeless.phase = 'doubled';
    expect(shouldTake(hopeless, 'p0', 'medium')).toBe(false);
  });
});
