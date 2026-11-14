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

/**
 * Pull a room code out of whatever landed in the code field.
 *
 * The field does not only receive keystrokes. It receives a whole pasted
 * invite, an invite link, and whatever the phone's keyboard decides to offer
 * from a text message — and `sanitizeCode` on its own turns all of those into
 * the WRONG code, silently: filtering "Join my game — code AB3CD" keeps the
 * first five alphabet characters it meets and yields "JNMYG", and a pasted link
 * yields "HTTPS". So before filtering, look for the code itself:
 *
 *   1. after an explicit marker — "#AB3CD" (the autofill line of the invite),
 *      ".../join/AB3CD", or "code AB3CD" / "code: AB3CD";
 *   2. otherwise, a standalone five-character word that is a valid code AND
 *      contains a digit. The digit test is what tells a code from an ordinary
 *      five-letter word like "RUMMY", and every generated code has one (see
 *      `hasDigit`).
 *
 * Only when neither is found is this plain typing, which falls through to
 * `sanitizeCode` — unless the text is far too long to be someone typing a
 * code, in which case there is no code in it and guessing would be worse than
 * leaving the boxes empty.
 */
export function extractCode(raw: string): string {
  const upper = raw.toUpperCase();

  const marked = /(?:#|\/JOIN\/|\bCODE\b[\s:=]*)([A-Z0-9]{5})(?![A-Z0-9])/g;
  for (let m = marked.exec(upper); m !== null; m = marked.exec(upper)) {
    if (isRoomCode(m[1]) && hasDigit(m[1])) return m[1];
  }

  for (const word of upper.split(/[^A-Z0-9]+/)) {
    if (isRoomCode(word) && hasDigit(word)) return word;
  }

  return upper.trim().length > CODE_LENGTH * 3 ? '' : sanitizeCode(raw);
}
