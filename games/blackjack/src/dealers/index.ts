/**
 * The dealers. Each is a cat (drawn in `components/avatar.tsx` by `avatarId`)
 * with a voice (every line they say). Online, the table votes for one in the
 * lobby; against the cats, you pick one. The chosen id is stored in the
 * game's `config.dealer`, so every client at a table hears the same dealer.
 */
import { DUCHESS } from './duchess';
import { LOU } from './lou';
import { NANA } from './nana';
import type { Voice } from './types';
import { UNIT9 } from './unit9';

export interface Dealer {
  id: string;
  name: string;
  /** "her card", "his card", "its card". */
  their: string;
  style: string;
  blurb: string;
  voice: Voice;
}

export const DEALERS: readonly Dealer[] = [
  {
    id: 'duchess',
    name: 'Duchess',
    their: 'her',
    style: 'Mean diva',
    blurb: 'Roasts every bad play, gloats when she wins, sulks when she busts.',
    voice: DUCHESS,
  },
  {
    id: 'nana',
    name: 'Nana Mittens',
    their: 'her',
    style: 'Sweet grandma',
    blurb: 'Cheers you on, offers cookies, gets passive-aggressive if you dawdle.',
    voice: NANA,
  },
  {
    id: 'lou',
    name: 'Lucky Lou',
    their: 'his',
    style: 'Lounge showman',
    blurb: 'Every hand is a show. Corny jokes, big energy, ring-a-ding-ding.',
    voice: LOU,
  },
  {
    id: 'unit9',
    name: 'Unit 9',
    their: 'its',
    style: 'Robot',
    blurb: 'Deadpan, statistical, logs every mistake you make.',
    voice: UNIT9,
  },
];

export const DEFAULT_DEALER = 'duchess';

export function dealerById(id: string | null | undefined): Dealer {
  return DEALERS.find((d) => d.id === id) ?? DEALERS[0];
}

/**
 * The table's dealer: the most votes among the players actually seated (and
 * the host). A tie goes to the host's choice if it is one of the tied, then
 * to the first in the dealer list; no votes at all means the default dealer.
 */
export function tallyVotes(votes: Record<string, string>, seats: Record<string, unknown>, host: string): string {
  const counts = new Map<string, number>();
  for (const [uid, id] of Object.entries(votes)) {
    if (DEALERS.some((d) => d.id === id) && (uid in seats || uid === host)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return DEFAULT_DEALER;
  const top = Math.max(...counts.values());
  const tied = DEALERS.map((d) => d.id).filter((id) => counts.get(id) === top);
  const hostVote = votes[host];
  return hostVote !== undefined && tied.includes(hostVote) ? hostVote : tied[0];
}

export type { Voice } from './types';
