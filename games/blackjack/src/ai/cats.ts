/**
 * The seven computer players, and the cat who deals. The order is fixed: a
 * table with N cats seats the first N, so the eighth chair (yours) is always
 * free.
 *
 * This file is data only (no DOM, no engine imports) so the pure decision code
 * and the UI's avatars can both read it.
 */

export type Strategy =
  /** The textbook chart for this game's rules. */
  | 'basic'
  /** Never risks busting: stands on any hard 12 or more. */
  | 'never-bust'
  /** Plays like the dealer: hits below 17, stands on 17+, never doubles or splits. */
  | 'dealer'
  /** Basic strategy, but doubles and splits whenever the chart even hints at it. */
  | 'hunch';

export interface Personality {
  strategy: Strategy;
  /** Bet this fraction of the stack each round (0 = always the table minimum). */
  betFraction: number;
  /** Counts cards (Hi-Lo) and bets more when the shoe is rich in tens and Aces. */
  counts: boolean;
  /** 0..1: random wobble on the bet size. */
  betJitter: number;
  /** When it takes insurance: never (the textbook), on a high count, or every time. */
  insurance: 'never' | 'count' | 'always';
}

export interface Cat {
  id: string;
  name: string;
  /** One line for the setup screen. */
  blurb: string;
  style: string;
  personality: Personality;
}

export const CATS: readonly Cat[] = [
  {
    id: 'tiger',
    name: 'Tiger',
    blurb: 'Grey tabby. Plays the chart, bets a steady slice of the stack.',
    style: 'By the book',
    personality: { strategy: 'basic', betFraction: 0.05, counts: false, betJitter: 0.2, insurance: 'never' },
  },
  {
    id: 'marmalade',
    name: 'Marmalade',
    blurb: 'Orange tabby. Big bets, and she doubles anything that looks lucky.',
    style: 'Reckless',
    personality: { strategy: 'hunch', betFraction: 0.15, counts: false, betJitter: 0.5, insurance: 'never' },
  },
  {
    id: 'professor',
    name: 'Professor',
    blurb: 'Tuxedo cat with glasses. Counts every card, bets up (and insures) when the shoe is hot.',
    style: 'Card counter',
    personality: { strategy: 'basic', betFraction: 0, counts: true, betJitter: 0, insurance: 'count' },
  },
  {
    id: 'patches',
    name: 'Patches',
    blurb: 'Calico. Hates going bust so much she stands on twelve.',
    style: 'Never busts',
    personality: { strategy: 'never-bust', betFraction: 0.04, counts: false, betJitter: 0.3, insurance: 'never' },
  },
  {
    id: 'shadow',
    name: 'Shadow',
    blurb: 'Black cat. Minimum bet, perfect play, all night long.',
    style: 'Grinder',
    personality: { strategy: 'basic', betFraction: 0, counts: false, betJitter: 0, insurance: 'never' },
  },
  {
    id: 'smokey',
    name: 'Smokey',
    blurb: 'Blue-grey cat. Copies the dealer: hits to seventeen, no tricks.',
    style: 'Mimic',
    personality: { strategy: 'dealer', betFraction: 0.06, counts: false, betJitter: 0.25, insurance: 'never' },
  },
  {
    id: 'biscuit',
    name: 'Biscuit',
    blurb: 'Cream cat with dark points. Splits every pair and always buys insurance, just in case.',
    style: 'Superstitious',
    personality: { strategy: 'hunch', betFraction: 0.08, counts: false, betJitter: 0.4, insurance: 'always' },
  },
];

/** The house cat behind the shoe — a Las Vegas lounge-act dealer. Not a player: never in `players`. */
export const DEALER = { id: 'duchess', name: 'Duchess', uid: 'cat-duchess' } as const;

export function catById(id: string | null): Cat | undefined {
  return CATS.find((cat) => cat.id === id);
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Skill {
  /** Chance of a hit/stand decision going the wrong way. */
  mistake: number;
}

/**
 * Difficulty changes how WELL the cats play, never their personalities: the
 * same Patches stands on twelve at every level, but on Easy everyone also
 * fumbles one decision in four.
 */
export const SKILL: Record<Difficulty, Skill> = {
  easy: { mistake: 0.25 },
  medium: { mistake: 0.08 },
  hard: { mistake: 0 },
};
