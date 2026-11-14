/** Shared fixtures for the engine tests. */
import {
  ANY_PLAYER,
  applyMove,
  createGame,
  isBettingPhase,
  legalActions,
  normalize,
  parseCards,
  totalChips,
  type GameState,
  type Move,
} from '@/engine';

export const uidOf = (seat: number): string => `p${seat}`;

export function newGame(players: number, startingStack = 1000, blindUpEvery = 1000): GameState {
  return createGame({
    players: Array.from({ length: players }, (_, i) => ({ uid: uidOf(i), name: `P${i}`, isHuman: i === 0 })),
    startingStack,
    // Tests think in "50 big blinds deep": 1000 → 10/20, 750 → 7/15.
    bigBlind: Math.round(startingStack / 50),
    blindUpEvery,
  });
}

/** Apply a move that must succeed. */
export function must(state: GameState, move: Move, uid: string): GameState {
  const result = applyMove(state, move, uid);
  if (!result.ok) throw new Error(`${move.kind} by ${uid} rejected: ${result.error}`);
  return result.state;
}

/** Apply a player move for whoever is on turn. */
export function act(state: GameState, move: Move): GameState {
  if (state.toAct === null) throw new Error(`nobody to act in ${state.phase}`);
  return must(state, move, uidOf(state.toAct));
}

export const deal = (state: GameState, seed = 1): GameState => must(state, { kind: 'deal', seed: [seed] }, uidOf(0));
export const next = (state: GameState): GameState => must(state, { kind: 'next', from: state.phase }, uidOf(0));

/** Deal seeds until the button lands on the wanted seat (the first hand draws for it). */
export function dealWithButton(state: GameState, button: number): GameState {
  for (let seed = 1; seed < 500; seed++) {
    const dealt = deal(state, seed);
    if (dealt.button === button) return dealt;
  }
  throw new Error('no seed put the button there');
}

/**
 * Replace the cards of a freshly dealt hand: `holes[seat]` like 'As Kd', and
 * the five board cards in the order they will come. Everything else goes back
 * in the deck, so the 52-card invariant still holds.
 */
export function rig(state: GameState, holes: string[], board: string): GameState {
  const boardCards = parseCards(board);
  const holeCards = holes.map((h) => parseCards(h));
  const used = new Set([...boardCards, ...holeCards.flat()]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  return {
    ...state,
    players: state.players.map((p, i) => ({ ...p, hole: p.inHand ? holeCards[i] : [] })),
    // The engine deals from the END of the deck.
    deck: [...rest, ...[...boardCards].reverse()],
  };
}

/** Send `next` until the hand is over (for all-in runouts and checked-down hands). */
export function runOut(state: GameState): GameState {
  let s = state;
  while (s.phase !== 'showdown') {
    s = s.toAct === null ? next(s) : act(s, { kind: 'check' });
  }
  return s;
}

/**
 * What the realtime database does to a value in transit: nulls and empty
 * collections are pruned, and an array left with holes comes back as an
 * integer-keyed object. `normalize` must undo all of it.
 */
export function wireDamage(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const kept = value.map(wireDamage);
    if (kept.every((v) => v === undefined)) return undefined;
    if (kept.every((v) => v !== undefined)) return kept;
    const sparse: Record<string, unknown> = {};
    kept.forEach((v, i) => {
      if (v !== undefined) sparse[i] = v;
    });
    return sparse;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const kept = wireDamage(v);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value;
}

/** A random move the engine claims is legal for the current state. */
export function randomLegalMove(s: GameState, rng: () => number): { move: Move; uid: string } {
  const anyone = uidOf(Math.floor(rng() * s.players.length));
  if (s.phase === 'gameover') return { move: { kind: 'rematch', seed: [Math.floor(rng() * 1e9)] }, uid: anyone };
  if (s.phase === 'idle' || s.phase === 'showdown') {
    return { move: { kind: 'deal', seed: [Math.floor(rng() * 1e9)] }, uid: anyone };
  }
  const legal = legalActions(s);
  if (!legal) return { move: { kind: 'next', from: s.phase }, uid: anyone };

  const actor = uidOf(legal.seat);
  const roll = rng();
  // Occasionally somebody else acts for the player on turn.
  if (roll < 0.03) return { move: { kind: 'away' }, uid: uidOf((legal.seat + 1) % s.players.length) };
  if (roll < 0.15) return { move: { kind: 'fold' }, uid: actor };
  if (roll < 0.4 && legal.canRaise) {
    const pick = rng();
    const to =
      pick < 0.2
        ? legal.maxRaiseTo
        : pick < 0.5
          ? legal.minRaiseTo
          : legal.minRaiseTo + Math.floor(rng() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
    return { move: { kind: 'raise', to }, uid: actor };
  }
  return { move: { kind: legal.canCheck ? 'check' : 'call' }, uid: actor };
}

/** Plain assert: vitest's expect() is far too slow to call a million times. */
function check(ok: boolean, label: string, what: string): void {
  if (!ok) throw new Error(`${label}: ${what}`);
}

/** Structural equality for plain JSON-ish values. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Everything that must be true of ANY reachable state. Throws on the first violation. */
export function checkInvariants(s: GameState, chips: number, label: string): void {
  // Chips are conserved, whole, and never negative.
  check(totalChips(s) === chips, label, 'chips not conserved');
  for (const p of s.players) {
    check(p.stack >= 0 && p.bet >= 0 && p.committed >= p.bet, label, 'negative or inconsistent chips');
    check(Number.isInteger(p.stack) && Number.isInteger(p.bet) && Number.isInteger(p.committed), label, 'fractional chips');
    if (p.inHand && isBettingPhase(s.phase)) {
      check(p.hole.length === 2, label, 'hole cards');
      check(p.allIn === (p.stack === 0), label, 'all-in flag disagrees with the stack');
    }
  }
  // Exactly 52 distinct cards between the deck, the board and the hands.
  if (s.handNo > 0) {
    const all = [...s.deck, ...s.board, ...s.players.flatMap((p) => p.hole)];
    check(all.length === 52 && new Set(all).size === 52, label, 'not 52 distinct cards');
  }
  const boardSize: Partial<Record<GameState['phase'], number>> = { idle: 0, preflop: 0, flop: 3, turn: 4, river: 5 };
  check(s.board.length === (boardSize[s.phase] ?? s.board.length), label, 'board size');
  // The denormalized turn field never drifts.
  check(s.turnUid === (s.toAct === null ? ANY_PLAYER : s.players[s.toAct].uid), label, 'turnUid drifted');
  if (s.toAct !== null) {
    const p = s.players[s.toAct];
    check(p.inHand && !p.folded && !p.allIn, label, 'player on turn cannot act');
  }
  if (s.phase === 'showdown') {
    const r = s.result!;
    const paid = r.won.reduce((a, b) => a + b, 0);
    check(paid === r.pots.reduce((a, p) => a + p.amount, 0), label, 'pots not paid in full');
    for (const pot of r.pots) {
      check(pot.payouts.reduce((a, p) => a + p.amount, 0) === pot.amount, label, 'pot not split exactly');
      check(pot.winners.every((w) => pot.eligible.includes(w)), label, 'ineligible winner');
    }
    check(s.players.every((p) => p.committed === 0), label, 'table not cleared');
  }
  // And the state survives the database round-trip unchanged.
  check(same(normalize(wireDamage(s)), s), label, 'did not survive the wire round-trip');
}
