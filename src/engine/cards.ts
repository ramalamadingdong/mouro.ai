/**
 * Card primitives for the gin rummy engine.
 *
 * A card is an integer 0..51:
 *   suit = Math.floor(id / 13)   // 0=♣ 1=♦ 2=♥ 3=♠
 *   rank = id % 13               // 0=Ace .. 12=King (Ace LOW only)
 *   pip  = Math.min(rank + 1, 10)
 */
import type { CardId } from './types';

/** Suit symbols indexed by suit number (0♣ 1♦ 2♥ 3♠). */
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;

/** Rank labels indexed by rank number (0=Ace .. 12=King). */
export const RANK_LABELS = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
] as const;

/** ASCII suit letters (for tests/debug). */
const SUIT_ASCII = ['C', 'D', 'H', 'S'] as const;

/** ASCII rank letters; T=10 (for tests/debug). */
const RANK_ASCII = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K',
] as const;

/** Suit of a card: 0..3 (0♣ 1♦ 2♥ 3♠). */
export function suitOf(c: CardId): number {
  return Math.floor(c / 13);
}

/** Rank of a card: 0..12 (0=Ace .. 12=King). */
export function rankOf(c: CardId): number {
  return c % 13;
}

/** Pip value: A=1, 2..9 face value, 10/J/Q/K = 10. */
export function pipValue(c: CardId): number {
  return Math.min(rankOf(c) + 1, 10);
}

/** True for diamonds or hearts. */
export function isRed(c: CardId): boolean {
  const s = suitOf(c);
  return s === 1 || s === 2;
}

/** Human-readable string, e.g. "A♠", "10♥", "K♣". */
export function cardToString(c: CardId): string {
  return RANK_LABELS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)];
}

/** ASCII string, e.g. "AS", "TH", "KC" (T=10). */
export function cardToAscii(c: CardId): string {
  return RANK_ASCII[rankOf(c)] + SUIT_ASCII[suitOf(c)];
}

/** The full 52-card deck as [0,1,...,51]. */
export function makeDeck(): CardId[] {
  const deck: CardId[] = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  return deck;
}

/** New array sorted by rank, then suit. */
export function sortByRank(hand: CardId[]): CardId[] {
  return hand.slice().sort((a, b) => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b));
}

/** New array sorted by suit, then rank. */
export function sortBySuit(hand: CardId[]): CardId[] {
  return hand.slice().sort((a, b) => suitOf(a) - suitOf(b) || rankOf(a) - rankOf(b));
}

/** Build a card id from suit and rank. */
export function cardId(suit: number, rank: number): CardId {
  return suit * 13 + rank;
}
