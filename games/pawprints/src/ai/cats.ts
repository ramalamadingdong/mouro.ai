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
  { id: 'marmalade', name: 'Marmalade', blurb: 'Orange tabby. Walks straight at the middle of the quilt.' },
  { id: 'shadow', name: 'Shadow', blurb: 'Black cat. Quietly sits in the gap you were about to fill.' },
  { id: 'tiger', name: 'Tiger', blurb: 'Grey tabby. Leaves two trails at once and waits to see.' },
];

export const CAT_UID_PREFIX = 'cat-';

export function catById(id: string): Cat | undefined {
  return CATS.find((cat) => cat.id === id);
}
