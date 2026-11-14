/**
 * Seeded whole-match fuzzing.
 *
 * Every hand-written test above pins one rule. This one plays thousands of real
 * matches and asserts the properties that must hold after EVERY accepted move —
 * the things a rule bug would break even if it slipped past a unit test.
 *
 * It is also the serialize test's second line of defence: every so often the
 * live state is pushed through the RTDB pruning simulation and back, so a
 * `normalize` gap shows up here too.
 *
 * NOTE ON STYLE: the invariants are checked with plain `if` + `fail()`, not with
 * `expect()`. There are millions of checks in this loop and jest's matchers cost
 * enough to turn a 20-second run into a 10-minute one. The summary assertions at
 * the end are ordinary `expect`s.
 */
import { BAR, CHECKERS, OFF, allHome, otherSeat, pipCount, toScratch } from '../board';
import { CUBE_VALUES } from '../cube';
import { maxUsableDice, turnLines } from '../moves';
import { applyMove, initialMatchState, legalMoves } from '../reducer';
import { normalize } from '../serialize';
import { makeRng } from '../rng';
import type { GameState, Move, Seat, Step } from '../types';
import { GUEST, HOST, prune } from './helpers';

const MATCHES = 2000;
/** Generous: a real match to 5 points is a few hundred moves. */
const MOVE_CAP = 1500;
const TARGETS = [1, 3, 5];

function fail(msg: string): never {
  throw new Error(msg);
}

function checkerCounts(s: GameState): [number, number] {
  let p0 = 0;
  let p1 = 0;
  for (const v of s.points) {
    if (v > 0) p0 += v;
    else p1 += -v;
  }
  return [p0 + s.bar.p0 + s.off.p0, p1 + s.bar.p1 + s.off.p1];
}

/** Pips a step removes from the mover: bar entry is `d`, a bear-off is `from + 1`. */
function stepPips(st: Step): number {
  return st.to === OFF ? st.from + 1 : st.from - st.to;
}

/**
 * Check the ORDER of a committed turn: while the mover has checkers on the bar
 * every step must be a bar entry, and no checker may come off while anything is
 * still outside the home board.
 */
function orderingIsLegal(before: GameState, seat: Seat, steps: Step[]): boolean {
  const b = toScratch(before, seat);
  for (const st of steps) {
    if (b.bar > 0 && st.from !== BAR) return false;
    if (st.to === OFF && !allHome(b)) return false;
    const hit = st.to !== OFF && b.pts[st.to] === -1;
    if (st.from === BAR) b.bar -= 1;
    else b.pts[st.from] -= 1;
    if (st.to === OFF) b.off += 1;
    else if (hit) {
      b.pts[st.to] = 1;
      b.oppBar += 1;
    } else {
      b.pts[st.to] += 1;
    }
  }
  return true;
}

const legalCubeValues = new Set<number>(CUBE_VALUES);

describe('fuzz: whole matches', () => {
  it(
    'holds every invariant across thousands of seeded matches',
    () => {
      const stats = {
        matchesFinished: 0,
        games: 0,
        doubles: 0,
        takes: 0,
        drops: 0,
        gammons: 0,
        backgammons: 0,
        forcedPasses: 0,
        hits: 0,
        crawfordGames: 0,
        maxCube: 1,
        serializeChecks: 0,
      };

      for (let m = 0; m < MATCHES; m++) {
        const rng = makeRng([m, 0x5eed]);
        const target = TARGETS[m % TARGETS.length];
        let s = initialMatchState({
          hostUid: HOST,
          guestUid: GUEST,
          hostName: 'Host',
          guestName: 'Guest',
          target,
        });

        let moves = 0;
        let sawCrawford = false;

        while (s.phase !== 'matchOver' && moves < MOVE_CAP) {
          // In a terminal phase EITHER player may act, so alternate at random —
          // that is the real race the security rules have to allow.
          const actor = s.phase === 'gameOver' ? (rng() < 0.5 ? HOST : GUEST) : s.turnUid;
          const seat: Seat = actor === HOST ? 'p0' : 'p1';
          const legal = legalMoves(s, actor);
          if (legal.length === 0) fail(`match ${m}: nobody can move in phase ${s.phase}`);
          if (s.crawford) {
            sawCrawford = true;
            if (legal.includes('double')) fail(`match ${m}: doubling offered in the Crawford game`);
          }

          let move: Move;
          if (legal.includes('openingRoll')) {
            move = { kind: 'openingRoll', seed: [m, moves, 1] };
          } else if (legal.includes('roll')) {
            // Double about one turn in twelve, so the cube gets a real workout.
            if (legal.includes('double') && rng() < 0.08) {
              move = { kind: 'double' };
              stats.doubles += 1;
            } else {
              move = { kind: 'roll', seed: [m, moves, 2] };
            }
          } else if (legal.includes('take')) {
            if (rng() < 0.75) {
              move = { kind: 'take' };
              stats.takes += 1;
            } else {
              move = { kind: 'pass' };
              stats.drops += 1;
            }
          } else if (legal.includes('play')) {
            const lines = turnLines(s, seat);
            const line = lines[Math.floor(rng() * lines.length)];
            if (line.steps.length === 0) stats.forcedPasses += 1;
            stats.hits += line.hits.length;
            move = { kind: 'play', steps: line.steps };
          } else {
            move = { kind: 'nextGame' };
          }

          const before = s;
          const beforeMax = before.phase === 'moving' ? maxUsableDice(before, seat) : 0;
          const r = applyMove(before, move, actor);
          if (!r.ok) fail(`match ${m} move ${moves} (${move.kind}) rejected: ${r.error}`);
          s = r.state;
          moves += 1;

          // ── Invariants that must hold after EVERY accepted move ───────────
          const [c0, c1] = checkerCounts(s);
          if (c0 !== CHECKERS || c1 !== CHECKERS) {
            fail(`match ${m} move ${moves}: checkers not conserved (${c0}/${c1})`);
          }
          if (s.version !== before.version + 1) fail(`match ${m}: version did not advance by 1`);
          if (s.turnUid !== s.players[s.turn]) fail(`match ${m}: turnUid out of step with turn`);
          if (!legalCubeValues.has(s.cube.value)) fail(`match ${m}: illegal cube ${s.cube.value}`);
          if (s.lastMove?.by !== actor) fail(`match ${m}: lastMove.by is not the mover`);
          if (s.cube.value > stats.maxCube) stats.maxCube = s.cube.value;

          const reached = s.scores.p0 >= s.target || s.scores.p1 >= s.target;
          if (reached !== (s.phase === 'matchOver')) {
            fail(`match ${m}: score ${s.scores.p0}-${s.scores.p1}/${s.target} vs phase ${s.phase}`);
          }

          if (move.kind === 'play') {
            const steps = move.steps;

            // Exactly as many dice as the position allowed — this is the
            // must-use-both-dice / doubles-give-four rule, checked universally.
            if (steps.length !== beforeMax) {
              fail(`match ${m}: played ${steps.length} of ${beforeMax} available dice`);
            }
            if (!orderingIsLegal(before, seat, steps)) {
              fail(`match ${m}: illegal step order (bar-first or premature bear-off)`);
            }

            // Pip accounting is EXACT, not merely monotone.
            let spent = 0;
            for (const st of steps) {
              if (st.from <= st.to) fail(`match ${m}: a checker moved backwards`);
              spent += stepPips(st);
            }
            if (pipCount(before, seat) - pipCount(s, seat) !== spent) {
              fail(`match ${m}: mover's pip count does not match the steps played`);
            }

            const opp = otherSeat(seat);
            let sentBack = 0;
            for (const j of s.lastMove?.hits ?? []) sentBack += 24 - j;
            if (pipCount(s, opp) - pipCount(before, opp) !== sentBack) {
              fail(`match ${m}: victim's pip count does not match the blots hit`);
            }
          }

          if (s.phase === 'gameOver' || s.phase === 'matchOver') {
            if (!s.gameResult) fail(`match ${m}: ${s.phase} with no game result`);
            stats.games += 1;
            if (s.gameResult.multiplier === 2) stats.gammons += 1;
            if (s.gameResult.multiplier === 3) stats.backgammons += 1;
          }

          // Every 40th accepted move, prove the state survives the database.
          if (moves % 40 === 0) {
            const back = normalize(prune(JSON.parse(JSON.stringify(s))));
            if (JSON.stringify(back) !== JSON.stringify(s)) {
              fail(`match ${m} move ${moves}: state does not survive an RTDB round trip`);
            }
            stats.serializeChecks += 1;
          }
        }

        if (s.phase !== 'matchOver') fail(`match ${m}: did not finish within ${MOVE_CAP} moves`);
        if (!s.matchResult) fail(`match ${m}: matchOver with no match result`);
        if (s.matchResult.scores[s.matchResult.winner] < target) {
          fail(`match ${m}: winner did not reach the target`);
        }
        stats.matchesFinished += 1;
        if (sawCrawford) stats.crawfordGames += 1;
      }

      // Guard against a fuzzer that silently stops exercising anything.
      expect(stats.matchesFinished).toBe(MATCHES);
      expect(stats.games).toBeGreaterThan(MATCHES);
      expect(stats.doubles).toBeGreaterThan(0);
      expect(stats.takes).toBeGreaterThan(0);
      expect(stats.drops).toBeGreaterThan(0);
      expect(stats.gammons).toBeGreaterThan(0);
      expect(stats.backgammons).toBeGreaterThan(0);
      expect(stats.forcedPasses).toBeGreaterThan(0);
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.crawfordGames).toBeGreaterThan(0);
      expect(stats.maxCube).toBeGreaterThan(2);
      expect(stats.serializeChecks).toBeGreaterThan(0);
    },
    300_000,
  );
});
