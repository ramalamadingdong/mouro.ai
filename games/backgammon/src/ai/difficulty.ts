/**
 * The difficulty knob, on its own so both the AI and the settings store can
 * name it without either importing the other. No runtime imports.
 */
export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  easy: 'Runs for home and hits what it can. Leaves blots, never doubles.',
  medium: 'Plays the whole board — points, primes and safety. Uses the cube.',
  hard: 'Weighs every reply before moving, and knows when to drop.',
};
