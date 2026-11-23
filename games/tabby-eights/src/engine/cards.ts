/**
 * Cards as two-character strings, and hands as strings of them. Pure helpers;
 * nothing here knows about turns.
 */
import { RANKS, SUITS, WILD, type Rank, type Suit } from './types';

export const SUIT_NAMES: Record<Suit, { one: string; many: string }> = {
  f: { one: 'fish', many: 'fish' },
  y: { one: 'yarn ball', many: 'yarn' },
  m: { one: 'mouse', many: 'mice' },
  b: { one: 'bell', many: 'bells' },
};

const RANK_NAMES: Record<Rank, string> = {
  A: 'ace',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  T: 'ten',
  J: 'jack',
  Q: 'queen',
  K: 'king',
};

/** One card: suit letter then rank letter. */
export const CARD_RE = /^[fymb][A2-9TJQK]$/;
/** Any run of cards, including none. Mirrored in database.rules.json. */
export const CARDS_RE = /^(?:[fymb][A2-9TJQK])*$/;

export const isSuit = (v: unknown): v is Suit => typeof v === 'string' && (SUITS as readonly string[]).includes(v);
export const isCard = (v: unknown): v is string => typeof v === 'string' && CARD_RE.test(v);

export const suitOf = (card: string): Suit => card[0] as Suit;
export const rankOf = (card: string): Rank => card[1] as Rank;
export const isWild = (card: string): boolean => card[1] === WILD;

/** "the eight of fish", "the queen of mice". */
export function cardName(card: string): string {
  return `the ${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)].many}`;
}

/** What a card is worth left in a hand at the end of a round: eights 50, pictures 10, ace 1, else its number. */
export function cardPoints(card: string): number {
  const r = rankOf(card);
  if (r === WILD) return 50;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  if (r === 'A') return 1;
  return Number(r);
}

/** "fAy8" → ["fA", "y8"]. */
export function split(cards: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < cards.length; i += 2) out.push(cards.slice(i, i + 2));
  return out;
}

export function handPoints(hand: string): number {
  return split(hand).reduce((sum, c) => sum + cardPoints(c), 0);
}

/** The cards of `hand` with one copy of `card` taken out, or null if it is not there. */
export function without(hand: string, card: string): string | null {
  for (let i = 0; i + 1 < hand.length; i += 2) {
    if (hand.slice(i, i + 2) === card) return hand.slice(0, i) + hand.slice(i + 2);
  }
  return null;
}

/** All 52 cards in a fixed order. */
export function freshDeck(): string[] {
  const out: string[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(s + r);
  return out;
}

/** Fisher–Yates on a copy. */
export function shuffle(cards: readonly string[], rng: () => number): string[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** For display: by suit (fish, yarn, mice, bells), then by rank, eights last of all. */
export function sortHand(cards: readonly string[]): string[] {
  const key = (c: string) =>
    (isWild(c) ? 100 : 0) + SUITS.indexOf(suitOf(c)) * 20 + RANKS.indexOf(rankOf(c));
  return cards.slice().sort((a, b) => key(a) - key(b));
}
