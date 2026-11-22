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
  { id: 'marmalade', name: 'Marmalade', blurb: 'Orange tabby. Pounces on every pung in sight.' },
  { id: 'shadow', name: 'Shadow', blurb: 'Black cat. Quiet, patient, keeps her hand hidden.' },
  { id: 'tiger', name: 'Tiger', blurb: 'Grey tabby. Steady paws, rarely throws you a winner.' },
];

export const CAT_UID_PREFIX = 'cat-';

export function catById(id: string): Cat | undefined {
  return CATS.find((cat) => cat.id === id);
}
