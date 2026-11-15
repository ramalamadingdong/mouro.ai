/**
 * The computer players. A table with N opponents seats the first N. Their
 * faces are drawn by `components/avatar.tsx` from the same ids. Data only.
 */
import type { Coat } from '@/engine';

export interface Cat {
  id: string;
  name: string;
  /** The coat its face is drawn in. */
  coat: Coat;
  /** One line for the setup screen. */
  blurb: string;
}

export const CATS: readonly Cat[] = [
  { id: 'miso', name: 'Miso', coat: 'g', blurb: 'Ginger. Keeps a tidy café and likes a matching set.' },
  { id: 'duchess', name: 'Duchess', coat: 's', blurb: 'Smoke grey. Always has an eye on the cat you wanted.' },
  { id: 'pudding', name: 'Pudding', coat: 'w', blurb: 'Snow white. Half asleep, but somehow fills her rows.' },
];

export const CAT_UID_PREFIX = 'cat-';

export function catById(id: string): Cat | undefined {
  return CATS.find((cat) => cat.id === id);
}
