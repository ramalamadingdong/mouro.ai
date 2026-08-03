/**
 * Move generation: the rules of backgammon, in one place.
 *
 * Everything here works in the acting seat's OWN frame (see board.ts), so there
 * is no direction branching anywhere below.
 *
 * The public contract the rest of the app relies on:
 *
 *   turnLines(state, seat)   every legal way to play the WHOLE turn
 *   maxUsableDice(...)       how many dice a legal turn must use
 *   nextSteps(...)           legal continuations of a partially staged turn
 *   isCompleteTurn(...)      is this staged turn a legal complete turn?
 *   previewDraft(...)        the board after a staged turn (no version/turn change)
 *
 * `applyMove({kind:'play'})` accepts a submitted turn IFF `isCompleteTurn`. That
 * single membership test enforces every rule below — bar-first, hitting,
 * blocked points, exact and overshoot bear-offs, must-use-both-dice,
 * must-use-the-larger-die, doubles-give-four, and no-legal-move-forfeits — with
 * no rule restated at the reducer level. VALIDATE BY ENUMERATION MEMBERSHIP,
 * NEVER BY RE-DERIVING RULES: the two would drift.
 */
import {
  BAR,
  OFF,
  POINTS,
  allHome,
  boardKey,
  fromScratch,
  highestOwn,
  otherSeat,
  toScratch,
  type Scratch,
} from './board';
import type { GameState, Seat, Step, TurnLine } from './types';

/** One checker movement plus the die it actually consumed. */
export interface Ply {
  step: Step;
  /**
   * The die spent. This is `from - to` EXCEPT for an overshoot bear-off (a 6
   * played off the 4 point), which is precisely why it is carried explicitly —
   * the must-use-the-larger-die rule and the CPU both need the real die.
   */
  die: number;
  /** This step lands on a lone enemy checker and sends it to the bar. */
  hit: boolean;
}

/**
 * Safety valve for the enumerator. Realistic worst cases are a few thousand
 * nodes; the theoretical worst (doubles, 15 spread checkers, an open board) is
 * far higher. On overflow we fall back to a transposition-deduped search, which
 * is much smaller and still finds every distinct resulting position.
 */
const MAX_NODES = 60_000;

/**
 * Every legal single step with die `d` from this position.
 *
 * The rules, in the order they apply:
 *  1. BAR FIRST — while you have a checker on the bar nothing else is legal.
 *  2. A destination is open if it holds none, mine, or exactly one enemy
 *     checker (which is hit).
 *  3. Bearing off needs every checker home; exactly off the `d` point, or from
 *     a lower point only when it is the highest one you still occupy.
 */
export function plies(b: Scratch, d: number): Ply[] {
  if (b.bar > 0) {
    const to = POINTS - d; // 24 - d
    if (b.pts[to] >= -1) {
      return [{ step: { from: BAR, to }, die: d, hit: b.pts[to] === -1 }];
    }
    return [];
  }

  const out: Ply[] = [];
  const home = allHome(b);
  const highest = home ? highestOwn(b) : -1;

  for (let i = 0; i < POINTS; i++) {
    if (b.pts[i] <= 0) continue;
    const to = i - d;
    if (to >= 0) {
      if (b.pts[to] >= -1) {
        out.push({ step: { from: i, to }, die: d, hit: b.pts[to] === -1 });
      }
    } else if (home) {
      // `to < 0` only happens when d > i, i.e. the die overshoots the edge.
      if (i === d - 1) {
        // Exact: the die matches the point.
        out.push({ step: { from: i, to: OFF }, die: d, hit: false });
      } else if (i === highest) {
        // Overshoot: legal only from the highest point you still occupy.
        out.push({ step: { from: i, to: OFF }, die: d, hit: false });
      }
    }
  }
  return out;
}

/** Mutate `b` by playing `p`. Paired with `undoPly`. */
export function applyPly(b: Scratch, p: Ply): void {
  const { from, to } = p.step;
  if (from === BAR) b.bar -= 1;
  else b.pts[from] -= 1;

  if (to === OFF) {
    b.off += 1;
  } else if (p.hit) {
    b.pts[to] = 1;
    b.oppBar += 1;
  } else {
    b.pts[to] += 1;
  }
}

/** Exact inverse of `applyPly`. */
export function undoPly(b: Scratch, p: Ply): void {
  const { from, to } = p.step;
  if (from === BAR) b.bar += 1;
  else b.pts[from] += 1;

  if (to === OFF) {
    b.off -= 1;
  } else if (p.hit) {
    b.pts[to] = -1;
    b.oppBar -= 1;
  } else {
    b.pts[to] -= 1;
  }
}

/**
 * The victim's own-frame index for a hit landing on MY own-frame index `to`.
 *
 * `toOwn` is a reflection, so this is the same expression whichever seat is
 * moving: my own index i is the opponent's own index 23 - i.
 */
function victimIndex(to: number): number {
  return 23 - to;
}

function lineOf(plyList: Ply[]): TurnLine {
  const steps: Step[] = [];
  const dice: number[] = [];
  const hits: number[] = [];
  for (const p of plyList) {
    steps.push(p.step);
    dice.push(p.die);
    if (p.hit) hits.push(victimIndex(p.step.to));
  }
  return { steps, dice, hits };
}

/**
 * Enumerate the maximal legal turns, and apply the must-use-the-larger-die rule.
 *
 * Only lines of maximal length survive — which is exactly the must-use-both-dice
 * rule, and for doubles the use-as-many-as-you-can rule. The larger-die rule is
 * a separate tie-break that only bites when just one die is playable.
 */
function enumerate(b: Scratch, dice: [number, number], dedupe: boolean): TurnLine[] {
  const pips = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [dice[0], dice[1]];

  let best = 0;
  let lines: TurnLine[] = [];
  let nodes = 0;
  let overflow = false;
  const acc: Ply[] = [];
  // Only used when `dedupe` is on (the overflow fallback): one line per
  // resulting position, which collapses the combinatorial explosion.
  const seen = new Set<string>();

  const rec = (remaining: number[]): void => {
    if (overflow) return;
    if (++nodes > MAX_NODES) {
      overflow = true;
      return;
    }

    let moved = false;
    // Identical die values at the same depth are the same branch.
    const tried = new Set<number>();
    for (let k = 0; k < remaining.length; k++) {
      const d = remaining[k];
      if (tried.has(d)) continue;
      tried.add(d);
      const rest = remaining.slice(0, k).concat(remaining.slice(k + 1));
      for (const p of plies(b, d)) {
        moved = true;
        applyPly(b, p);
        acc.push(p);
        rec(rest);
        acc.pop();
        undoPly(b, p);
        if (overflow) return;
      }
    }

    if (!moved) {
      if (acc.length > best) {
        best = acc.length;
        lines = [];
        seen.clear();
      }
      if (acc.length === best) {
        if (dedupe) {
          const key = boardKey(b);
          if (seen.has(key)) return;
          seen.add(key);
        }
        lines.push(lineOf(acc));
      }
    }
  };

  rec(pips);

  if (overflow) {
    // Retry deduping by resulting position. Guaranteed to terminate well inside
    // the cap because the number of reachable positions is tiny next to the
    // number of orderings that reach them.
    return enumerate(b, dice, true);
  }

  // Must use the larger die when only one can be played. Keyed on the CONSUMED
  // die, so an overshoot bear-off that spends the 6 counts as playing the 6.
  if (best === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(dice[0], dice[1]);
    if (lines.some((l) => l.dice[0] === hi)) {
      lines = lines.filter((l) => l.dice[0] === hi);
    }
  }

  return lines;
}

// ── Content-keyed memo ───────────────────────────────────────────────────────
// The board component asks for the same lines on every render; the CPU asks for
// them once per candidate. Keying on CONTENT (not on `version`, which is only
// unique within one room) keeps this a pure function of its arguments.
const CACHE_MAX = 12;
const cache = new Map<string, TurnLine[]>();

function cacheKey(b: Scratch, dice: number[], seat: Seat): string {
  return `${seat}|${dice.join(',')}|${boardKey(b)}`;
}

/**
 * Every legal way to play the whole turn, in the seat's own frame.
 *
 * Returns `[[]]`-equivalent (one empty line) when the dice are unplayable — a
 * forced "no play" is still a legal turn. Returns `[]` only when it is not this
 * seat's turn to move at all.
 */
export function turnLines(state: GameState, seat: Seat): TurnLine[] {
  if (state.phase !== 'moving' || state.dice.length !== 2) return [];
  const b = toScratch(state, seat);
  const key = cacheKey(b, state.dice, seat);
  const hit = cache.get(key);
  if (hit) return hit;

  const lines = enumerate(b, [state.dice[0], state.dice[1]], false);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, lines);
  return lines;
}

/** How many dice a legal turn must use. 0 means the turn is forfeited. */
export function maxUsableDice(state: GameState, seat: Seat): number {
  const lines = turnLines(state, seat);
  return lines.length ? lines[0].steps.length : 0;
}

function stepEq(a: Step, b: Step): boolean {
  return a.from === b.from && a.to === b.to;
}

function isPrefix(draft: Step[], line: Step[]): boolean {
  if (draft.length > line.length) return false;
  for (let i = 0; i < draft.length; i++) if (!stepEq(draft[i], line[i])) return false;
  return true;
}

/**
 * The distinct legal continuations of a partially staged turn.
 *
 * This is what the board highlights. It is deliberately derived from the
 * maximal-line set rather than from `plies`, so a step that is legal in
 * isolation but would strand the player on a shorter turn is never offered.
 */
export function nextSteps(state: GameState, seat: Seat, draft: Step[]): Step[] {
  const out: Step[] = [];
  const seen = new Set<string>();
  for (const line of turnLines(state, seat)) {
    if (line.steps.length <= draft.length) continue;
    if (!isPrefix(draft, line.steps)) continue;
    const s = line.steps[draft.length];
    const k = `${s.from}:${s.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** The legal continuations that start from one particular point. */
export function legalStepsFrom(
  state: GameState,
  seat: Seat,
  draft: Step[],
  from: number,
): Step[] {
  return nextSteps(state, seat, draft).filter((s) => s.from === from);
}

/** Points the player may pick up from right now, given what is already staged. */
export function movableSources(state: GameState, seat: Seat, draft: Step[]): number[] {
  const seen = new Set<number>();
  for (const s of nextSteps(state, seat, draft)) seen.add(s.from);
  return Array.from(seen);
}

/** Is this staged turn a legal COMPLETE turn — i.e. submittable? */
export function isCompleteTurn(state: GameState, seat: Seat, draft: Step[]): boolean {
  for (const line of turnLines(state, seat)) {
    if (line.steps.length !== draft.length) continue;
    if (isPrefix(draft, line.steps)) return true;
  }
  return false;
}

/** The full `TurnLine` matching a staged turn, or null if it isn't a legal turn. */
export function lineFor(state: GameState, seat: Seat, draft: Step[]): TurnLine | null {
  for (const line of turnLines(state, seat)) {
    if (line.steps.length !== draft.length) continue;
    if (isPrefix(draft, line.steps)) return line;
  }
  return null;
}

/** The board after applying a list of steps. */
export interface AppliedTurn {
  points: number[];
  bar: Record<Seat, number>;
  off: Record<Seat, number>;
  /** Victim's own-frame indices of blots hit. */
  hits: number[];
}

/**
 * Move checkers, mechanically. Validates only that each step is physically
 * possible (a checker of mine is there, the destination is not blocked) — the
 * DICE rules are enforced by line membership in the reducer, not here, so that
 * they live in exactly one place.
 *
 * Returns `null` if a step is impossible.
 */
export function applySteps(state: GameState, seat: Seat, steps: Step[]): AppliedTurn | null {
  const b = toScratch(state, seat);
  const hits: number[] = [];

  for (const s of steps) {
    if (s.from === BAR) {
      if (b.bar <= 0) return null;
    } else {
      if (s.from < 0 || s.from >= POINTS) return null;
      if (b.pts[s.from] <= 0) return null;
      // You may not move anything else while you have a checker on the bar.
      if (b.bar > 0) return null;
    }

    if (s.to === OFF) {
      if (!allHome(b)) return null;
    } else {
      if (s.to < 0 || s.to >= POINTS) return null;
      if (b.pts[s.to] < -1) return null;
    }

    const hit = s.to !== OFF && b.pts[s.to] === -1;
    applyPly(b, { step: s, die: s.from - s.to, hit });
    if (hit) hits.push(victimIndex(s.to));
  }

  const flipped = fromScratch(b, seat);
  // `fromScratch` cannot know the opponent's borne-off count (my turn never
  // changes it), so reinstate it here.
  flipped.off[otherSeat(seat)] = state.off[otherSeat(seat)];
  return { points: flipped.points, bar: flipped.bar, off: flipped.off, hits };
}

/**
 * The board as it would look with a staged turn applied — no version bump, no
 * turn flip, no scoring.
 *
 * This is the workhorse of the UI: it renders BOTH my own staged position and
 * the opponent's turn being replayed (fed `lastMove.steps.slice(0, k)`), so the
 * two can never disagree about what a half-played turn looks like.
 */
export function previewDraft(state: GameState, seat: Seat, draft: Step[]): GameState {
  if (draft.length === 0) return state;
  const applied = applySteps(state, seat, draft);
  if (!applied) return state;
  return { ...state, points: applied.points, bar: applied.bar, off: applied.off };
}

/** Which die VALUES a staged turn has already spent, for dimming the dice. */
export function consumedDice(state: GameState, seat: Seat, draft: Step[]): number[] {
  if (draft.length === 0) return [];
  for (const l of turnLines(state, seat)) {
    if (isPrefix(draft, l.steps)) return l.dice.slice(0, draft.length);
  }
  return [];
}
