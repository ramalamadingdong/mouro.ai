/**
 * Crypto-backed randomness for the app shell.
 *
 * This is deliberately the ONLY place `crypto.getRandomValues` is called. The
 * engine (`src/engine/`) is pure and takes its randomness as an explicit
 * `seed: number[]` inside the move that consumes it, which is what makes every
 * game replayable from `initial state + ordered move log`. Keeping the DOM
 * crypto API out here is also what lets the engine run in plain Node under
 * Vitest and in the replay pipeline.
 */

/**
 * A fresh seed for one `{ kind: 'roll' }` move.
 *
 * Eight 16-bit values (~128 bits) is far more entropy than five dice need, but
 * `makeRng` hashes the whole array into 128 bits of sfc32 state, so feeding it
 * fewer words just leaves that state partly determined by the constant
 * initialisers. Uint16 rather than Uint32 because the seed is JSON-encoded into
 * the RTDB transaction payload on every roll and shorter integers keep it small.
 */
export function randomSeed(): number[] {
  return Array.from(crypto.getRandomValues(new Uint16Array(8)));
}

/**
 * Room-code alphabet: digits and capitals with `0 O 1 I L` removed, because a
 * code gets read aloud or copied off a phone screen and those five are the pairs
 * people transcribe wrong. 31 characters ^ 5 = ~28.6M codes.
 *
 * DUPLICATED as a character class in `firebase/database.rules.json`
 * (`^[A-HJKMNP-Z2-9]{5}$`) — the rules cannot import TypeScript, so if this
 * string changes the rules regex must change in the same commit or valid codes
 * start getting rejected at write time with no client-side warning.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Characters in a room code. Also duplicated in the rules regex quantifier. */
export const CODE_LENGTH = 5;

/**
 * `CODE_ALPHABET.length` (31) does not divide 256, so the largest multiple of it
 * below 256 is 248. A byte >= 248 would, under `byte % 31`, land on one of the
 * first 8 letters and make those letters ~1.5x more likely than the rest — the
 * gin rummy codebase has exactly that bug. We discard those bytes instead
 * (rejection sampling), which costs a few extra random bytes and buys a flat
 * distribution.
 */
const REJECT_AT = 256 - (256 % CODE_ALPHABET.length);

/** The digits within CODE_ALPHABET. See `hasDigit` for why they are singled out. */
export const CODE_DIGITS = '23456789';

/** A uniformly random room code. */
export function randomRoomCode(): string {
  for (;;) {
    let code = '';
    // Draw in batches: one syscall per character would be wasteful, and asking
    // for a few extra bytes covers the rare rejected draw without a second trip.
    while (code.length < CODE_LENGTH) {
      const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2));
      for (const byte of bytes) {
        if (byte >= REJECT_AT) continue; // biased tail — throw it away, do not fold it in
        code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
        if (code.length === CODE_LENGTH) break;
      }
    }
    // Redraw until the code contains a digit. See `hasDigit` — this is what
    // makes the code eligible for OS autofill out of the invite message, and
    // ~22% of raw draws ((23/31)^5) are all letters. It removes 6.4M of the
    // 28.6M possible codes, leaving 22.2M, which is not a constraint that will
    // ever be felt.
    if (hasDigit(code)) return code;
  }
}

/**
 * True when the code contains at least one digit.
 *
 * Not cosmetic. The origin-bound one-time-code format that drives OS autofill —
 * the `@host #CODE` line at the end of the shared invite — requires a 4-10
 * character alphanumeric code CONTAINING AT LEAST ONE NUMBER. A pure-letter code
 * like `ABCDE` falls outside the format, so the phone would offer to autofill
 * some invites and silently not others: a feature that works inconsistently for
 * reasons the player cannot see is worse than one that does not exist.
 */
export function hasDigit(value: string): boolean {
  for (const ch of value) if (CODE_DIGITS.includes(ch)) return true;
  return false;
}

/**
 * Exact match for a well-formed room code.
 *
 * The character class is the literal expansion of CODE_ALPHABET and is the same
 * regex enforced in `firebase/database.rules.json`; keep the two in step.
 */
export function isRoomCode(s: string): boolean {
  return /^[A-HJKMNP-Z2-9]{5}$/.test(s);
}

/**
 * Separators that mean "the code is what comes AFTER this". Covers a label
 * ("Room code: AB3CD"), an invite path (".../join/AB3CD"), and a query
 * parameter ("?code=AB3CD"). A hyphen is deliberately NOT here — people type
 * codes as "ab3-cd" and we want to keep both halves.
 */
const CODE_PREFIX_SEPARATORS = ':/=?#';

/** Uppercase, then keep only alphabet characters, stopping at CODE_LENGTH. */
function keepAlphabetChars(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}

/**
 * Coerce arbitrary pasted text toward a room code.
 *
 * People paste "Room code: ab3-cd", a whole invite URL, or type with caps lock
 * off. Rejecting the whole string on the first stray character makes the join
 * field feel broken, so we never reject — we filter and clamp. The result is
 * NOT guaranteed to be a valid code; callers still gate on `isRoomCode`.
 *
 * The subtlety that costs you an afternoon: you cannot just filter the whole
 * string. Every letter of the word "code" is in CODE_ALPHABET (O is not, but
 * C, D and E are), so filtering "code: ab3-cd" outright yields "CDEAB" — a
 * plausible-looking code that is not the one on the sender's screen, which then
 * fails to join a room that demonstrably exists. Same for the "https" in a
 * pasted invite link. So we first cut everything up to the last label/path/query
 * separator and only then filter.
 */
export function sanitizeRoomCode(raw: string): string {
  // Trailing separators and space would otherwise make the tail empty, e.g. a
  // link copied with its trailing slash.
  let s = raw.trim();
  while (s.length > 0 && CODE_PREFIX_SEPARATORS.includes(s[s.length - 1])) {
    s = s.slice(0, -1).trim();
  }

  let cut = -1;
  for (let i = 0; i < s.length; i++) {
    if (CODE_PREFIX_SEPARATORS.includes(s[i])) cut = i;
  }

  const tail = s.slice(cut + 1);

  /*
   * A label can also arrive with no punctuation at all ("join AB3CD", "Room
   * code AB3CD"), and "join" contributes J and N. So also try cutting at the
   * last run of whitespace — but ONLY accept that cut if it yields a complete
   * code. Without that guard, someone typing the code spaced out ("A B 3 C D")
   * would have everything before the final space thrown away and be left with
   * "D".
   */
  const lastSpace = tail.search(/\s\S*$/);
  if (lastSpace !== -1) {
    const afterSpace = keepAlphabetChars(tail.slice(lastSpace + 1));
    if (afterSpace.length === CODE_LENGTH) return afterSpace;
  }

  const fromTail = keepAlphabetChars(tail);
  // Safety net: if the tail holds nothing usable (a bare "AB3CD:" say), fall
  // back to the whole string so trimming can never do worse than not trimming.
  return fromTail.length > 0 ? fromTail : keepAlphabetChars(s);
}

/**
 * Pull a room code out of whatever landed in the code field: keystrokes, a
 * whole pasted invite message, an invite link, or a code the phone's keyboard
 * offers from a text message.
 *
 * `sanitizeRoomCode` already copes with a label or a link on ONE line, by
 * cutting at the last separator. A full invite is three lines ending in
 * `@host #CODE`, and other apps wrap it in their own text, so look for the
 * code itself first:
 *
 *   1. after an explicit marker — "#AB3CD", ".../join/AB3CD", "code AB3CD";
 *   2. otherwise a standalone five-character word that is a valid code AND
 *      contains a digit, which is what tells a code from an ordinary word and
 *      is something every generated code has (see `hasDigit`).
 *
 * Anything else is plain typing and goes to `sanitizeRoomCode` — unless it is
 * far too long to be someone typing a code, in which case there is no code in
 * it and an empty field is more honest than a guess.
 */
export function extractRoomCode(raw: string): string {
  const upper = raw.toUpperCase();

  const marked = /(?:#|\/JOIN\/|\bCODE\b[\s:=]*)([A-Z0-9]{5})(?![A-Z0-9])/g;
  for (let m = marked.exec(upper); m !== null; m = marked.exec(upper)) {
    if (isRoomCode(m[1]) && hasDigit(m[1])) return m[1];
  }

  for (const word of upper.split(/[^A-Z0-9]+/)) {
    if (isRoomCode(word) && hasDigit(word)) return word;
  }

  return upper.trim().length > CODE_LENGTH * 3 ? '' : sanitizeRoomCode(raw);
}
