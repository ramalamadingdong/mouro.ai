/** Card helpers. See `Card` in types.ts for the integer encoding. */
import type { Card } from './types';

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';

export const rankOf = (card: Card): number => card >> 2;
export const suitOf = (card: Card): number => card & 3;

/** 'As', 'Td', '2c' → card. Throws on nonsense: it is only used by tests and fixtures. */
export function parseCard(text: string): Card {
  const rank = RANK_CHARS.indexOf(text[0]?.toUpperCase() ?? '');
  const suit = SUIT_CHARS.indexOf(text[1]?.toLowerCase() ?? '');
  if (text.length !== 2 || rank < 0 || suit < 0) throw new Error(`Not a card: "${text}"`);
  return rank * 4 + suit;
}

/** 'As Kd 7c' → cards. */
export function parseCards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card)] + SUIT_CHARS[suitOf(card)];
}

/** A fresh ordered deck, 0..51. */
export function freshDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
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
