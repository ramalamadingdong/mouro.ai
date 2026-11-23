/**
 * How a computer cat takes its turn. Depends only on the engine, and only on
 * what a player at the table can see: its own hand, the pile, the suit to
 * follow and how many cards everyone holds. It never looks at another hand or
 * at the stock.
 *
 *  - easy    plays a random card that fits (eights included, naming a random
 *            suit now and then), draws when it has nothing.
 *  - medium  keeps its eights for when nothing else fits, plays the card that
 *            leaves it the most cards of the suit it lands on, sheds pictures
 *            before small cards, and names the suit it holds most of.
 *  - hard    medium, plus card counting: it prefers suits that are mostly
 *            gone from the game (in the pile or its own hand), so the next
 *            player is less likely to follow; and when the next player is
 *            down to one or two cards it spends an eight to change the suit
 *            and sheds its costliest cards; heads-up, when the other player
 *            has just drawn and passed, it keeps to the suit they lack.
 *
 * `rng` is passed in so tests can be deterministic; the app passes Math.random.
 */
import {
  SUITS,
  canDraw,
  cardPoints,
  favouriteSuit,
  isWild,
  playable,
  split,
  suitOf,
  without,
  type GameState,
  type Move,
  type Suit,
} from '@/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** A turn without the seed: the app shell adds one to `draw` (randomness lives outside the AI). */
export type Decision = { kind: 'play'; card: string; suit?: Suit } | { kind: 'draw' } | { kind: 'pass' };

const pick = <T,>(list: readonly T[], rng: () => number): T => list[Math.floor(rng() * list.length) % list.length];

function suitCount(hand: string, suit: Suit): number {
  return split(hand).filter((c) => !isWild(c) && suitOf(c) === suit).length;
}

/** How many of each suit a player can see accounted for: in the pile or in their own hand. */
function seen(state: GameState, hand: string): Record<Suit, number> {
  const out = { f: 0, y: 0, m: 0, b: 0 } as Record<Suit, number>;
  for (const c of [...split(state.pile), ...split(hand)]) if (!isWild(c)) out[suitOf(c)] += 1;
  return out;
}

function nameSuit(state: GameState, rest: string, level: Difficulty, rng: () => number): Suit {
  if (level === 'easy') return rng() < 0.5 ? pick(SUITS, rng) : favouriteSuit(rest);
  if (level === 'medium' || rest.length === 0) return favouriteSuit(rest);
  const known = seen(state, rest);
  let best: Suit = SUITS[0];
  let bestScore = -Infinity;
  for (const s of SUITS) {
    const score = suitCount(rest, s) * 3 + known[s];
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** The decision for the cat on turn. The state must have someone on turn. */
export function decide(state: GameState, difficulty: Difficulty, rng: () => number): Decision {
  const seat = state.toAct ?? 0;
  const hand = state.players[seat].hand;
  const options = playable(state);

  if (options.length === 0) {
    if (canDraw(state)) return { kind: 'draw' };
    return { kind: 'pass' };
  }

  const play = (card: string): Decision => {
    if (!isWild(card)) return { kind: 'play', card };
    const rest = without(hand, card) ?? '';
    return { kind: 'play', card, suit: nameSuit(state, rest, difficulty, rng) };
  };

  if (difficulty === 'easy') {
    // Now and then it would rather draw than think.
    if (canDraw(state) && !state.drew && rng() < 0.12) return { kind: 'draw' };
    return play(pick(options, rng));
  }

  const plain = options.filter((c) => !isWild(c));
  const eights = options.filter(isWild);
  const nextHand = state.players[(seat + 1) % state.players.length].hand.length / 2;

  if (difficulty === 'hard' && eights.length > 0 && nextHand <= 2 && hand.length > 2) {
    // The next player is nearly out: change the suit to one they are least likely to hold.
    return play(eights[0]);
  }
  if (plain.length === 0) return play(eights[0]);

  const known = difficulty === 'hard' ? seen(state, hand) : null;
  const last = state.lastMove;
  const passedOn =
    state.players.length === 2 && (last.kind === 'pass' || (last.kind === 'away' && last.card === null)) && last.seat !== seat;
  const nextLacks: Suit | null = passedOn ? state.suit : null;
  let best = plain[0];
  let bestScore = -Infinity;
  for (const card of plain) {
    const rest = without(hand, card) ?? '';
    const suit = suitOf(card);
    let score = suitCount(rest, suit) * 10 + cardPoints(card);
    if (known) {
      score += known[suit] * 10;
      // The player before us just drew and passed on this suit: they have none, so keep it.
      if (nextLacks === suit) score += 40;
      // Somebody is nearly out: shed the cards that would cost the most.
      if (nextHand <= 2) score += cardPoints(card) * 2;
    }
    score += rng() * 0.5;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return play(best);
}

/** Turns a decision into a move, with the seed a draw needs. */
export function toMove(decision: Decision, seed: number[]): Move {
  return decision.kind === 'draw' ? { kind: 'draw', seed } : decision;
}
