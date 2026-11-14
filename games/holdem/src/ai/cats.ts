/**
 * The five computer players. The order is fixed: it is the left-to-right order
 * of the cats in the painting used as the app icon, and a table with N
 * opponents seats the first N.
 *
 * This file is data only (no DOM, no engine imports) so the pure decision code
 * and the UI's avatars can both read it.
 */

export interface Personality {
  /** Preflop: Chen score needed to open from early position at a full table. Lower = looser. */
  openThreshold: number;
  /** Added to the price a call is worth: positive calls lighter, negative needs a better hand. */
  callLooseness: number;
  /** 0..1: how often a good hand bets/raises instead of checking/calling, and how big. */
  aggression: number;
  /** 0..1: base chance of betting with nothing when checked to. */
  bluff: number;
  /** 0..1: chance of just calling/checking a monster to set a trap. */
  slowplay: number;
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
    id: 'shadow',
    name: 'Shadow',
    blurb: 'Black cat. Waits for a real hand, then means it.',
    style: 'Tight',
    personality: { openThreshold: 9, callLooseness: -0.04, aggression: 0.55, bluff: 0.03, slowplay: 0.1 },
  },
  {
    id: 'marmalade',
    name: 'Marmalade',
    blurb: 'Orange tabby. Plays too many hands and bets all of them.',
    style: 'Loose-aggressive',
    personality: { openThreshold: 6, callLooseness: 0.04, aggression: 0.9, bluff: 0.16, slowplay: 0.05 },
  },
  {
    id: 'tiger',
    name: 'Tiger',
    blurb: 'Grey tabby. Sensible, steady, hard to push around.',
    style: 'Solid',
    personality: { openThreshold: 8, callLooseness: 0, aggression: 0.65, bluff: 0.07, slowplay: 0.15 },
  },
  {
    id: 'professor',
    name: 'Professor',
    blurb: 'Tuxedo cat with glasses. Traps, check-raises, the odd bluff.',
    style: 'Tricky',
    personality: { openThreshold: 7.5, callLooseness: 0.01, aggression: 0.7, bluff: 0.12, slowplay: 0.4 },
  },
  {
    id: 'patches',
    name: 'Patches',
    blurb: 'Calico. Cannot bear to fold; rarely raises.',
    style: 'Calling station',
    personality: { openThreshold: 7, callLooseness: 0.12, aggression: 0.2, bluff: 0.02, slowplay: 0.2 },
  },
];

export function catById(id: string | null): Cat | undefined {
  return CATS.find((cat) => cat.id === id);
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Skill {
  /** Monte-Carlo rollouts per postflop decision. */
  rollouts: number;
  /** Uniform error (±) added to the equity estimate: a weak player misjudges their hand. */
  equityNoise: number;
  /** Uniform error (±) on the preflop Chen score. */
  preflopNoise: number;
  /** 0..1: how much a big bet is read as a strong hand (equity vs RANDOM hands flatters us). */
  respect: number;
  /** Chance of ignoring the maths and just checking/calling. */
  autopilot: number;
}

/**
 * Difficulty changes how WELL the cats play, never their personalities: the
 * same Marmalade is loose at every level, but on Easy she also misreads her
 * hand and pays off big bets.
 */
export const SKILL: Record<Difficulty, Skill> = {
  easy: { rollouts: 80, equityNoise: 0.13, preflopNoise: 2, respect: 0, autopilot: 0.12 },
  medium: { rollouts: 200, equityNoise: 0.05, preflopNoise: 0.75, respect: 0.5, autopilot: 0.03 },
  hard: { rollouts: 400, equityNoise: 0.015, preflopNoise: 0, respect: 1, autopilot: 0 },
};
