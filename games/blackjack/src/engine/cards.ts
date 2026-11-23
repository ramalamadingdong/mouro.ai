/** Card helpers. See `Card` in types.ts for the integer encoding. */
import { SHOE_SIZE, type Card } from './types';

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';

export const rankOf = (card: Card): number => (card % 52) >> 2;
export const suitOf = (card: Card): number => card & 3;

/** Blackjack value of one card: 2–10, faces 10, Ace 11 (hand totals soften it). */
export function cardValue(card: Card): number {
  const rank = rankOf(card);
  if (rank === 12) return 11;
  return Math.min(10, rank + 2);
}

/**
 * 'As', 'Td', '2c' → card (from deck 0). Throws on nonsense: it is only used
 * by tests and fixtures. A `#n` suffix picks the copy from deck n ('As#3').
 */
export function parseCard(text: string): Card {
  const [face, copy = '0'] = text.split('#');
  const rank = RANK_CHARS.indexOf(face[0]?.toUpperCase() ?? '');
  const suit = SUIT_CHARS.indexOf(face[1]?.toLowerCase() ?? '');
  const deck = Number(copy);
  if (face.length !== 2 || rank < 0 || suit < 0 || !Number.isInteger(deck) || deck < 0 || deck * 52 >= SHOE_SIZE) {
    throw new Error(`Not a card: "${text}"`);
  }
  return deck * 52 + rank * 4 + suit;
}

/** 'As Kd 7c' → cards. */
export function parseCards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card)] + SUIT_CHARS[suitOf(card)];
}

/** A fresh ordered shoe, 0..SHOE_SIZE-1. */
export function freshShoe(): Card[] {
  return Array.from({ length: SHOE_SIZE }, (_, i) => i);
}

/** In-place Fisher–Yates. Returns the same array for chaining. */
export function shuffle(cards: Card[], rng: () => number): Card[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

export interface HandValue {
  total: number;
  /** An Ace is still counted as 11. */
  soft: boolean;
}

/** Best blackjack total of some cards: Aces count 11 while that does not bust. */
export function handValue(cards: readonly Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (v === 11) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

/** Two cards making 21. (Whether it counts as a blackjack after a split is the caller's call.) */
export function isNatural(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}
