/**
 * The computer players. A table with N opponents seats the first N. Their
 * faces are drawn by `components/avatar.tsx` from the same ids. Data only.
 */

export interface Cat {
  id: string;
  name: string;
  /** One line for the setup screen. */
  blurb: string;
}

export const CATS: readonly Cat[] = [
  { id: 'marmalade', name: 'Marmalade', blurb: 'Orange tabby. Plays the first card that fits and purrs about it.' },
  { id: 'shadow', name: 'Shadow', blurb: 'Black cat. Keeps the eights tucked under a paw until you are nearly out.' },
  { id: 'tiger', name: 'Tiger', blurb: 'Grey tabby. Watches the pile and counts what is gone.' },
];

export const CAT_UID_PREFIX = 'cat-';

export function catById(id: string): Cat | undefined {
  return CATS.find((cat) => cat.id === id);
}
