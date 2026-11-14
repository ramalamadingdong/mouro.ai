/**
 * Everything about the shape of a room code, in ONE place.
 *
 * The one copy that cannot come from here is the regex in the Realtime Database
 * rules — a rules file cannot import TypeScript. If you change the alphabet or
 * the length, change `^[A-HJKMNP-Z2-9]{5}$` in the `bgRooms` rules to match, or
 * the generator will mint codes the server refuses with an opaque
 * PERMISSION_DENIED.
 */

/**
 * Room-code alphabet: no 0/O/1/I/L, because those are the pairs people misread
 * off a screen or mishear over the phone.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** The digits within CODE_ALPHABET. See `hasDigit` for why they are singled out. */
export const CODE_DIGITS = '23456789';

export const CODE_LENGTH = 5;

/** Exactly the codes `randomRoomCode` can produce, and the rules will accept. */
export function isRoomCode(value: string): boolean {
  if (value.length !== CODE_LENGTH) return false;
  for (const ch of value) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * True when the code contains at least one digit.
 *
 * This is not cosmetic. The origin-bound one-time-code format that drives OS
 * autofill (`@host #CODE` on the last line of a text message) requires a 4-10
 * character alphanumeric code CONTAINING AT LEAST ONE NUMBER. A pure-letter code
 * like `ABCDE` is outside the format, so the phone would offer to autofill some
 * invites and silently not others — the worst kind of feature, one that works
 * inconsistently for reasons the user cannot see.
 */
export function hasDigit(value: string): boolean {
  for (const ch of value) if (CODE_DIGITS.includes(ch)) return true;
  return false;
}

/**
 * Strip a raw string down to a room code.
 *
 * FILTERS OUT disallowed characters rather than rejecting the whole string, so
 * pasting "join my game — code AB3-CD" still yields something usable instead of
 * nothing. Uppercases first, because people type codes in lower case.
 */
export function sanitizeCode(raw: string): string {
  const upper = raw.toUpperCase();
  let out = '';
  for (const ch of upper) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}
