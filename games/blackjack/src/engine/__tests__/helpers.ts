/** Shared fixtures for the engine tests. */
import {
  ANY_PLAYER,
  RULES,
  applyMove,
  createGame,
  dealerSoft17,
  freshShoe,
  handValue,
  legalActions,
  maxTransfer,
  normalize,
  parseCards,
  totalChips,
  type Card,
  type GameState,
  type Move,
} from '@/engine';

export const uidOf = (seat: number): string => `p${seat}`;

export function newGame(players: number, startingStack = 1000, rounds = 1000): GameState {
  return createGame({
    players: Array.from({ length: players }, (_, i) => ({ uid: uidOf(i), name: `P${i}`, isHuman: i === 0 })),
    startingStack,
    rounds,
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
export const next = (state: GameState): GameState =>
  must(state, { kind: 'next', from: state.phase, dealerCards: state.dealer.length }, uidOf(0));

/** Everyone bets `amount` (or the given per-seat amounts). */
export function betAll(state: GameState, amount: number | number[]): GameState {
  let s = state;
  while (s.phase === 'betting' && s.toAct !== null) {
    s = act(s, { kind: 'bet', amount: Array.isArray(amount) ? amount[s.toAct] : amount });
  }
  return s;
}

/**
 * Stack the shoe so the next cards come out in `order` (as the engine deals:
 * each bettor's first card, the dealer's up card, each bettor's second card,
 * the hole card, then hits). Every other card stays in the shoe below them.
 */
export function stack(state: GameState, order: string): GameState {
  const want = parseCards(order);
  const used = new Set<Card>(want);
  if (used.size !== want.length) throw new Error('stack(): repeat a face with #n for another deck');
  const rest = freshShoe().filter((c) => !used.has(c));
  // The engine deals from the END of the shoe.
  return { ...state, shoe: [...rest, ...[...want].reverse()] };
}

/** Send `next` until the round is settled. */
export function finish(state: GameState): GameState {
  let s = state;
  while (s.phase !== 'settled') {
    if (s.toAct !== null) s = act(s, { kind: 'stand' });
    else s = next(s);
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
  // Now and then somebody lends or repays, whatever else is going on.
  if (s.phase !== 'idle' && s.phase !== 'gameover' && s.players.length > 1 && rng() < 0.04) {
    const from = Math.floor(rng() * s.players.length);
    const spare = maxTransfer(s, from);
    const debt = s.debts.find((d) => d.borrower === from);
    if (debt && spare > 0 && rng() < 0.5) {
      return { move: { kind: 'repay', to: debt.lender, amount: Math.min(debt.amount, spare, 1 + Math.floor(rng() * 100)) }, uid: uidOf(from) };
    }
    if (spare > 0) {
      const to = (from + 1 + Math.floor(rng() * (s.players.length - 1))) % s.players.length;
      return { move: { kind: 'loan', to, amount: Math.min(spare, 1 + Math.floor(rng() * 200)) }, uid: uidOf(from) };
    }
  }
  if (s.phase === 'gameover') return { move: { kind: 'rematch', seed: [Math.floor(rng() * 1e9)] }, uid: anyone };
  if (s.phase === 'idle' || s.phase === 'settled') {
    return { move: { kind: 'deal', seed: [Math.floor(rng() * 1e9)] }, uid: anyone };
  }
  const legal = legalActions(s);
  if (!legal) return { move: { kind: 'next', from: s.phase, dealerCards: s.dealer.length }, uid: anyone };

  const actor = uidOf(legal.seat);
  const roll = rng();
  // Occasionally somebody else acts for the player on turn.
  if (roll < 0.03 && s.players.length > 1) return { move: { kind: 'away' }, uid: uidOf((legal.seat + 1) % s.players.length) };
  if (legal.kind === 'bet') {
    if (roll < 0.08) return { move: { kind: 'bet', amount: 0 }, uid: actor };
    if (roll < 0.1 && s.players[legal.seat].stack - s.config.minBet >= 5) return { move: { kind: 'tip', amount: 5 }, uid: actor };
    const steps = (legal.maxBet - legal.minBet) / legal.step;
    const pick = rng();
    const amount = pick < 0.15 ? legal.maxBet : legal.minBet + legal.step * Math.floor(rng() * (steps + 1));
    return { move: { kind: 'bet', amount }, uid: actor };
  }
  if (legal.canSurrender && roll < 0.08) return { move: { kind: 'surrender' }, uid: actor };
  if (legal.canSplit && roll < 0.6) return { move: { kind: 'split' }, uid: actor };
  if (legal.canDouble && roll < 0.3) return { move: { kind: 'double' }, uid: actor };
  return { move: { kind: roll < 0.65 ? 'hit' : 'stand' }, uid: actor };
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
    check(p.stack >= 0 && Number.isInteger(p.stack), label, 'negative or fractional stack');
    check(p.hands.length <= RULES.MAX_HANDS, label, 'too many hands');
    for (const h of p.hands) {
      check(h.bet > 0 && h.bet % RULES.BET_STEP === 0, label, 'bet off the step');
      check(Number.isInteger(h.paid), label, 'fractional payout');
      if (s.phase === 'playing' || s.phase === 'dealer') check(h.cards.length >= 2, label, 'hand short of cards');
    }
  }
  // Debts are positive, between two different seats, one entry per pair.
  for (const d of s.debts) check(d.amount > 0 && d.lender !== d.borrower, label, 'bad debt');
  check(new Set(s.debts.map((d) => `${d.lender}>${d.borrower}`)).size === s.debts.length, label, 'duplicate debt');
  // No physical card in two places.
  const all = [...s.shoe, ...s.dealer, ...s.players.flatMap((p) => p.hands.flatMap((h) => h.cards))];
  check(new Set(all).size === all.length, label, 'a card is in two places');
  // The denormalized turn field never drifts.
  check(s.turnUid === (s.toAct === null ? ANY_PLAYER : s.players[s.toAct].uid), label, 'turnUid drifted');
  if (s.toAct !== null) {
    const p = s.players[s.toAct];
    if (s.phase === 'betting') check(p.hands.length === 0 && p.stack >= s.config.minBet, label, 'bettor cannot bet');
    else check(s.phase === 'playing' && !p.hands[p.active].done, label, 'player on turn cannot act');
  }
  if (s.phase === 'playing' || s.phase === 'dealer') check(s.dealer.length >= 2, label, 'dealer short of cards');
  if (s.phase === 'dealer' && s.dealer.length > 2) {
    const before = s.dealer.slice(0, -1);
    check(handValue(before).total < 17 || dealerSoft17(before), label, 'dealer drew on a hard 17+');
  }
  if (s.phase === 'settled') {
    const r = s.result!;
    s.players.forEach((p, i) => {
      const net = p.hands.reduce((a, h) => a + h.paid - h.bet, 0);
      check(net === r.net[i], label, 'net disagrees with the hands');
      check(p.hands.every((h) => h.outcome !== null), label, 'unsettled hand');
    });
  }
  // And the state survives the database round-trip unchanged.
  check(same(normalize(wireDamage(s)), s), label, 'did not survive the wire round-trip');
}
