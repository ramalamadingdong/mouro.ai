/**
 * The wire codec for a seat: `{ name, joinedAt }` inside the app, ONE STRING on
 * RTDB — `"<joinedAt>|<name>"`, e.g. `"1784571234567|Ann"`.
 *
 * WHY A STRING AND NOT THE OBJECT IT OBVIOUSLY IS: an object-valued node cannot
 * be closed by RTDB rules. `.write` cascades to every descendant, `.validate`
 * never runs on an ancestor of the written path, and there is no "only these
 * children" operator — so a grant on `seats/$uid` authorised
 * `set('seats/<self>/junk/deep', <10MB>)`, which landed in a subtree with no
 * applicable rule at all. Repeat it and the free Spark quota is gone; worse,
 * `subscribeRoom` reads the whole room, so every client in it re-downloads the
 * blob on every change.
 *
 * A SCALAR closes the hole. `newData.isString()` in the grant itself becomes
 * UNSATISFIABLE the moment the node turns into an object, which is precisely
 * what writing a child does. This is the same move already made for `holds`
 * (a bitmask integer) and `presence` (a bare number); `seats` was the last
 * object-valued node a non-host could write.
 *
 * The app above this line keeps its `{ name, joinedAt }` record, so nothing
 * downstream of `decodeSeats` — `seatOrder`, the lobby, the table — moved.
 */

/**
 * Total cap on the packed string, mirroring the rule's `length <= 120`.
 * The rule ALSO enforces `length >= 3` and a `^[0-9]{1,15}[|]` prefix; every
 * output of `packSeat` must satisfy all three or the write comes back as an
 * opaque PERMISSION_DENIED.
 *
 * WHY 120 AND NOT 40. The budget has to hold a 15-digit stamp, a delimiter, and
 * MAX_NAME_LENGTH characters — but a "character" costs up to 4 UTF-8 bytes, and
 * Firebase's `.length` is not reliably a code-unit count for non-ASCII. At 40
 * the two interpretations disagreed badly enough to be a real bug: budgeting
 * defensively in bytes meant 24 CJK characters became 8, and 24 emoji became 6.
 * The user typed a name, joined successfully, and watched it come back chopped
 * with no error.
 *
 * 15 + 1 + (24 x 4) = 112, so 120 is over the worst case under EVERY
 * interpretation. That lets the packer budget purely in code points — the unit
 * the display cap is actually expressed in — and stop guessing at the server's.
 */
export const MAX_SEAT_STRING_LENGTH = 120;

/** Digits the rule allows before the delimiter. `Date.now()` uses 13. */
export const MAX_JOINED_AT_DIGITS = 15;

/** Largest `joinedAt` expressible in that many digits. */
const MAX_JOINED_AT = 10 ** MAX_JOINED_AT_DIGITS - 1;

/** Display cap on a name, unchanged from when it was its own leaf. */
export const MAX_NAME_LENGTH = 24;

const SEAT_DELIMITER = '|';

/**
 * Truncate to a budget of CODE POINTS, never code units.
 *
 * `Array.from` iterates code points, so slicing this way cannot cut a surrogate
 * pair in half. A lone surrogate is not valid text and survives a JSON round
 * trip as U+FFFD — a name that silently corrupts itself the first time someone
 * uses an emoji.
 *
 * Budgeting in code points rather than UTF-8 bytes is safe ONLY because
 * MAX_SEAT_STRING_LENGTH is set above the worst-case byte expansion; see the
 * note there. Lower that cap and this has to go back to counting bytes — and
 * back to truncating non-Latin names.
 */
function clampToPoints(s: string, budget: number): string {
  return Array.from(s).slice(0, Math.max(0, budget)).join('');
}

/**
 * Pack a seat for the wire.
 *
 * Guarantees — asserted against the rule text in `src/util/__tests__/seat.ts`,
 * because a packer that drifts from the rule fails as a PERMISSION_DENIED with
 * no message: an integer `joinedAt` of 1..15 digits, a delimiter, a non-empty
 * name, and a total within `MAX_SEAT_STRING_LENGTH`.
 */
export function packSeat(joinedAt: number, name: string): string {
  // The rule's regex admits digits only: no sign, no exponent, no fraction.
  // A garbage timestamp degrades to 0, which `seatOrder` merely sorts first —
  // far better than a write the server refuses.
  const whole = Number.isFinite(joinedAt) ? Math.trunc(joinedAt) : 0;
  const stamp = Math.min(Math.max(whole, 0), MAX_JOINED_AT);
  const prefix = String(stamp);

  // The display cap is the binding one; the wire budget only exists to catch a
  // pathological stamp. Both are counted in code points — see clampToPoints.
  const budget = MAX_SEAT_STRING_LENGTH - prefix.length - SEAT_DELIMITER.length;
  const trimmed = clampToPoints(name.trim(), Math.min(MAX_NAME_LENGTH, budget));

  // The rule requires length >= 3, which an empty name would fail — and an
  // all-whitespace name has always been substituted rather than rejected.
  return `${prefix}${SEAT_DELIMITER}${trimmed.length > 0 ? trimmed : 'Player'}`;
}

/**
 * Decode a packed seat, or `null` if it is not one.
 *
 * A BOUNDARY, NOT A PARSER. The rules constrain what can be written here, but
 * this must not trust them: legacy rooms, a future rule change, and a client
 * that lies all arrive through this function. Anything that is not a string
 * with a numeric prefix and a delimiter is rejected outright.
 */
export function unpackSeat(raw: unknown): { name: string; joinedAt: number } | null {
  if (typeof raw !== 'string') return null;

  // FIRST delimiter only. A name may legitimately contain '|', and splitting on
  // every occurrence would truncate it at the pipe.
  const cut = raw.indexOf(SEAT_DELIMITER);
  if (cut < 1) return null; // absent, or an empty timestamp

  const prefix = raw.slice(0, cut);
  if (!/^[0-9]{1,15}$/.test(prefix)) return null;

  const name = raw.slice(cut + SEAT_DELIMITER.length);
  // Mirrors the packer's substitution, so a stored name that somehow lost its
  // text still renders as a player rather than as a blank row.
  return { name: name.length > 0 ? name : 'Player', joinedAt: Number(prefix) };
}
