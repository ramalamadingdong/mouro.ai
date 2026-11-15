/**
 * Wire format for a staged (not yet committed) turn, published so the opponent
 * can watch it. See `publishDraft` in net/rooms.ts. Pure, so it can be tested
 * without the network layer.
 */
import type { Step } from '@/engine/types';

/** Pack staged steps for the wire. A string, because RTDB prunes empty arrays. */
export function packSteps(steps: Step[]): string {
  return steps.map((s) => `${s.from}:${s.to}`).join(',');
}

/**
 * Unpack a draft from the wire. Anything malformed yields no steps — this is
 * another client's data, and the worst a bad value may do is show nothing.
 * (Legality is not checked here: `previewDraft` ignores an illegal sequence.)
 */
export function unpackSteps(packed: unknown): Step[] {
  if (typeof packed !== 'string' || packed === '') return [];
  if (!/^-?\d{1,2}:-?\d{1,2}(,-?\d{1,2}:-?\d{1,2}){0,3}$/.test(packed)) return [];
  return packed.split(',').map((pair) => {
    const [from, to] = pair.split(':').map(Number);
    return { from, to };
  });
}
