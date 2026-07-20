/**
 * The wire codec for held dice: `number[]` inside the app, ONE INTEGER on RTDB.
 *
 * `rooms/<code>/holds/<uid>` is a bitmask 0..31 (bit i set = die i is held),
 * not a list, because a security rule cannot bound an array. Every rule on an
 * array's elements is an ANCESTOR rule for a write aimed one level deeper, and
 * `.validate` never runs on ancestors — so `set('holds/<uid>/0/junk', <10MB>)`
 * used to land in a subtree with no rules at all. A single number closes that:
 * `newData.isNumber()` is unsatisfiable for any write below the node, because
 * writing a child would make the node an object.
 *
 * The app keeps thinking in die indices; encode/decode happens only at the
 * Firebase boundary (`setMyHolds` / `subscribeRoom`).
 *
 * A real behavioural win comes with it: "no dice held" used to be `[]`, which
 * RTDB prunes to null — i.e. a DELETE, indistinguishable from "this player has
 * never published holds". As a mask it is the number `0`, which stores like any
 * other value. The empty-vs-absent ambiguity is gone from the wire format.
 */
import { RULES } from '@/engine';

/** Every bit the rules accept: dice 0..RULES.DICE-1, i.e. 0..31 for 5 dice. */
export const HOLDS_MASK_MAX = (1 << RULES.DICE) - 1;

/** Pack die indices into the mask. Out-of-range and duplicate indices vanish. */
export function holdsToMask(indices: number[]): number {
  let mask = 0;
  for (const i of indices) {
    if (Number.isInteger(i) && i >= 0 && i < RULES.DICE) mask |= 1 << i;
  }
  return mask;
}

/**
 * Unpack a mask into sorted die indices.
 *
 * Hostile input is the normal case here: the mask arrives from another client
 * over a node any authenticated user can write, and although the rules bound it
 * to 0..31 they cannot make it an integer (`4.5` passes a numeric range test).
 * So anything non-finite is treated as "nothing held", and bits at or above
 * RULES.DICE are ignored rather than trusted — a hold index the engine never
 * heard of would be handed straight back to `applyMove` as `keep`.
 */
export function maskToHolds(mask: number): number[] {
  if (!Number.isFinite(mask)) return [];
  const bits = Math.trunc(mask);
  // A negative mask has every bit set under `&`, so -1 would decode as "all
  // five dice held" — the one garbage value that decodes to something plausible.
  if (bits < 0) return [];
  const out: number[] = [];
  for (let i = 0; i < RULES.DICE; i++) {
    if ((bits & (1 << i)) !== 0) out.push(i);
  }
  return out;
}
