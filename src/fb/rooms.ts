/**
 * The room protocol: everything that reads or writes `rooms/<code>`.
 *
 * Shape of a room (mirrors firebase/database.rules.json exactly):
 *
 *   rooms/<CODE>/
 *     meta      { host, status, createdAt, updatedAt }
 *     seats/<uid>     "<joinedAt>|<name>"     <- membership; seat ORDER is derived
 *     state           GameState               <- the only node moves touch
 *     presence/<uid>  { online, lastSeen }    <- cosmetic
 *     holds/<uid>     number (bitmask 0..31)  <- cosmetic (which dice are held)
 *     rematch/<uid>   true                    <- vote tombstone
 *
 * Three rules of the road that the rest of the app depends on:
 *
 *  1. COSMETIC DATA LIVES IN SIBLING NODES. Holds and presence change many
 *     times per turn. If they lived inside `state` every toggle would cost a
 *     transaction round-trip and would bloat the payload every move carries.
 *  2. THERE IS NO SEAT-CLAIMING PROTOCOL. `seats` is an unordered map; the
 *     seat INDEX is computed by `seatOrder()`, which is a pure function of the
 *     map. Two clients therefore agree on seating without exchanging a single
 *     message, and a lost race cannot produce two players holding seat 1.
 *  3. EVERY STATE WRITE GOES THROUGH `submitMove`, which runs the pure reducer
 *     inside an RTDB transaction. Nothing else may write `state`.
 */
import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import {
  RULES,
  applyMove,
  initialGameState,
  normalize,
  type GameState,
  type Move,
  type Player,
} from '@/engine';
import { db } from '@/fb/firebase';
import { ensureAnonymousAuth, getCurrentUid } from '@/fb/auth';
import { randomRoomCode } from '@/util/seed';
import { holdsToMask, maskToHolds } from '@/util/holds';
import { MAX_NAME_LENGTH, packSeat, unpackSeat } from '@/util/seat';

// ── Wire types ───────────────────────────────────────────────────────────────

/** One membership record. The key is the uid; the seat index is NOT stored. */
export interface RoomSeat {
  name: string;
  joinedAt: number;
}

export interface RoomMeta {
  host: string;
  // No 'finished': nothing ever wrote it, and an unwritten status value is pure
  // attack surface — the rules now enforce `waiting -> playing` as the ONLY
  // legal transition, so a third value could never be reached anyway.
  status: 'waiting' | 'playing';
  createdAt: number;
  updatedAt: number;
}

export interface PresenceEntry {
  online: boolean;
  lastSeen: number;
}

/**
 * One decoded snapshot of an entire room. Collections are always present (empty
 * objects rather than undefined) so callers never have to null-check them —
 * RTDB prunes empty collections on the wire, and every consumer forgetting that
 * individually is a bug factory.
 */
export interface RoomSnapshot {
  meta: RoomMeta | null;
  seats: Record<string, RoomSeat>;
  state: GameState | null;
  presence: Record<string, PresenceEntry>;
  holds: Record<string, number[]>;
  rematch: Record<string, boolean>;
}

// ── Small constants ──────────────────────────────────────────────────────────

/** How many fresh codes to try before giving up on a create. */
const CREATE_ATTEMPTS = 5;

/** The idle window after which the rules let anyone delete a room. */
const ROOM_STALE_MS = 86_400_000;

/**
 * Does this room look reapable?
 *
 * A TRIGGER, NOT AN ARBITER. The rule re-checks both timestamps against server
 * time and is the only thing that decides; this exists so a client that already
 * holds a snapshot can notice a dead room and take a free swing at deleting it.
 * Being wrong in either direction is harmless — a false positive is a denied
 * delete, a false negative is a room that waits for the next passer-by.
 *
 * Zero means "the timestamp did not decode" (a pending serverTimestamp), which
 * must never read as "epoch, therefore ancient".
 */
export function isRoomStale(meta: RoomMeta | null): boolean {
  if (!meta || meta.createdAt <= 0 || meta.updatedAt <= 0) return false;
  const now = Date.now();
  return now - meta.createdAt > ROOM_STALE_MS && now - meta.updatedAt > ROOM_STALE_MS;
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * The acting uid, waiting for anonymous sign-in only if it has not landed yet.
 *
 * The synchronous cache in auth.ts covers the overwhelmingly common case (the
 * session was restored before the user could click anything); the await is the
 * cold-load path, where a room action fires within the first second of the page.
 */
async function requireUid(): Promise<string> {
  const uid = getCurrentUid();
  if (uid) return uid;
  return ensureAnonymousAuth();
}

/** True when a Firebase error is the rules engine refusing the operation. */
function isPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = (err as Error | null)?.message ?? '';
  return code === 'PERMISSION_DENIED' || message.includes('PERMISSION_DENIED');
}

/**
 * A name fit to carry around the app. `packSeat` applies the same trim, the
 * same cap and the same 'Player' substitution when it writes; this exists for
 * the copies that never go through it — `state.players[].name`, whose own
 * validate still caps at MAX_NAME_LENGTH.
 */
function cleanName(raw: string): string {
  const trimmed = Array.from(raw.trim()).slice(0, MAX_NAME_LENGTH).join('');
  // The rule requires a non-empty name, so an all-whitespace one would be
  // rejected by the server with an opaque PERMISSION_DENIED. Substitute instead.
  return trimmed.length > 0 ? trimmed : 'Player';
}

function decodeMeta(v: unknown): RoomMeta | null {
  if (!isObj(v)) return null;
  const { host, status, createdAt, updatedAt } = v;
  if (typeof host !== 'string' || host.length === 0) return null;
  if (status !== 'waiting' && status !== 'playing') return null;
  return {
    host,
    status,
    // A pending serverTimestamp() reads back as a non-number for one local tick.
    // Treating that as 0 (rather than rejecting the meta) keeps the room usable;
    // 0 only ever makes the staleness check MORE conservative.
    createdAt: Number.isFinite(Number(createdAt)) ? Number(createdAt) : 0,
    updatedAt: Number.isFinite(Number(updatedAt)) ? Number(updatedAt) : 0,
  };
}

/**
 * Decode the seats map.
 *
 * On the wire each entry is a PACKED STRING (see util/seat.ts for why it is not
 * an object). The decoded `RoomSeat` is unchanged, so scalarizing the wire
 * format moved no consumer — `seatOrder`, the lobby list and `startGame` all
 * still read `{ name, joinedAt }`.
 *
 * TWO SHAPES ARE ACCEPTED. Rules validate WRITES only, never reads, so rooms
 * created before this change still hold `{ name, joinedAt }` objects and remain
 * perfectly readable. The legacy branch below exists for exactly those rooms and
 * can be deleted once none can survive — the 24h reaper bounds that, so any
 * time after a day past deployment.
 */
function decodeSeats(v: unknown): Record<string, RoomSeat> {
  const out: Record<string, RoomSeat> = {};
  if (!isObj(v)) return out;
  for (const [uid, entry] of Object.entries(v)) {
    const packed = unpackSeat(entry);
    if (packed) {
      out[uid] = packed;
      continue;
    }
    // Legacy: a room seated under the pre-scalar wire format.
    if (!isObj(entry)) continue;
    const name = typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : 'Player';
    const joinedAt = Number(entry.joinedAt);
    out[uid] = { name, joinedAt: Number.isFinite(joinedAt) ? joinedAt : 0 };
  }
  return out;
}

/**
 * Decode the presence map.
 *
 * On the wire each entry is a BARE NUMBER (see presence.ts for why it is not an
 * object). Presence is therefore existence: a node means online, and the value
 * is only "last seen". The decoded shape keeps the `{online, lastSeen}` object
 * the UI already renders, so scalarizing the wire format moved no consumer.
 *
 * A non-numeric entry is treated as absent rather than as online — the rules
 * make one impossible, but this decoder is the boundary that must not trust
 * them.
 */
function decodePresence(v: unknown): Record<string, PresenceEntry> {
  const out: Record<string, PresenceEntry> = {};
  if (!isObj(v)) return out;
  for (const [uid, entry] of Object.entries(v)) {
    const lastSeen = Number(entry);
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) continue;
    out[uid] = { online: true, lastSeen };
  }
  return out;
}

/**
 * Decode the holds map. Each value is a bitmask on the wire (see util/holds.ts)
 * and a die-index array everywhere above this line, so the whole app — store,
 * table, engine — never sees a bit. `maskToHolds` is the only thing that trusts
 * the number, and it trusts it as little as possible.
 */
function decodeHolds(v: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!isObj(v)) return out;
  for (const [uid, entry] of Object.entries(v)) out[uid] = maskToHolds(Number(entry));
  return out;
}

function decodeRematch(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObj(v)) return out;
  // The rules only ever allow the literal `true`; anything else is treated as
  // "no vote" rather than trusted, because a vote triggers a whole new game.
  for (const [uid, entry] of Object.entries(v)) out[uid] = entry === true;
  return out;
}

function decodeRoom(raw: unknown): RoomSnapshot | null {
  if (!isObj(raw)) return null;
  return {
    meta: decodeMeta(raw.meta),
    seats: decodeSeats(raw.seats),
    // A room can legitimately exist with no state (the lobby, before the host
    // deals) and normalize() returns null for wire damage too. Both cases are
    // "no usable game", which is exactly what the UI needs to know.
    state: normalize(raw.state),
    presence: decodePresence(raw.presence),
    holds: decodeHolds(raw.holds),
    rematch: decodeRematch(raw.rematch),
  };
}

// ── Seat assignment ──────────────────────────────────────────────────────────

/**
 * The seating order — THE ENTIRE SEAT-ASSIGNMENT PROTOCOL.
 *
 * Host first (seat 0 acts first, and the rules make the host the only one who
 * may deal), then everyone else by join time. `uid` breaks a joinedAt tie, and
 * that tiebreak is not paranoia: `joinedAt` is `Date.now()` from each joiner's
 * own clock, so two people tapping Join together really can collide. Because
 * this is a pure function of the seats map, every client computes the same
 * array from the same snapshot with no coordination — which is why there is no
 * seat-claiming handshake and no race to lose.
 *
 * Capped at RULES.MAX_PLAYERS because the rules engine cannot count children;
 * an over-seated room would otherwise produce a state `normalize()` rejects.
 */
export function seatOrder(seats: Record<string, RoomSeat>, host: string): string[] {
  const others = Object.keys(seats).filter((uid) => uid !== host);
  others.sort((a, b) => {
    const byTime = seats[a].joinedAt - seats[b].joinedAt;
    return byTime !== 0 ? byTime : a < b ? -1 : a > b ? 1 : 0;
  });
  // The host is only seated if they actually hold a seat record — `leaveRoom`
  // during play can drop a seat while `meta.host` stays put (it is immutable).
  const ordered = host in seats ? [host, ...others] : others;
  return ordered.slice(0, RULES.MAX_PLAYERS);
}

// ── Create / join ────────────────────────────────────────────────────────────

/**
 * Create a room and seat the host in it. Returns the new code.
 *
 * Each attempt is a CREATE-IF-NULL transaction: the callback aborts (returns
 * undefined) the instant it sees existing data, so two hosts who happen to
 * generate the same code cannot overwrite one another. The room-level write
 * rule independently requires `!data.exists()` and `meta.host === auth.uid`,
 * so the transaction is belt-and-braces on a guarantee the server already
 * makes — but it is what turns a collision into a retry instead of an error.
 *
 * DO NOT ARM `onDisconnect().remove()` ON THE WAITING ROOM. It is tempting
 * (an abandoned lobby cleans itself up!) and it is wrong: the RTDB socket drops
 * on any brief background or network blip — locking the phone, switching wifi,
 * a tunnel — and the queued delete would fire and destroy a perfectly good room
 * out from under the host, leaving the person they invited staring at "Room not
 * found". Abandoned rooms are instead reaped lazily by the 24h stale rule plus
 * the opportunistic sweep on collision below.
 */
export async function createRoom(hostName: string): Promise<string> {
  const uid = await requireUid();
  const name = cleanName(hostName);
  /** Attempts that were refused outright rather than merely colliding. */
  let permissionDenials = 0;

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = randomRoomCode();
    const now = Date.now();
    // Date.now(), not serverTimestamp(): sentinel values are not supported
    // inside a transaction callback, and `createdAt` is half the staleness
    // clock, which must be a settled number the moment the room exists.
    const room = {
      meta: { host: uid, status: 'waiting' as const, createdAt: now, updatedAt: now },
      // Packed, like every other seat write: the rule now demands a string.
      seats: { [uid]: packSeat(now, name) },
    };

    let result;
    try {
      result = await runTransaction(
        ref(db, `rooms/${code}`),
        (cur: unknown) => {
          if (cur !== null) return; // occupied — abort and try another code
          return room;
        },
        // See submitMove for the full reasoning on applyLocally: false.
        { applyLocally: false },
      );
    } catch (err) {
      if (isPermissionDenied(err)) {
        // NOT necessarily a rules problem — most often it is a COLLISION.
        // runTransaction needs READ access to the path, and `.read` denies a
        // non-participant on a room whose status is 'playing'. So colliding with
        // a live game throws denied instead of returning committed:false. Treat
        // it as the collision it almost always is: sweep in case the room is
        // ancient, then draw another code. Only if every attempt fails this way
        // do we conclude the rules really are missing (the throw below).
        permissionDenials++;
        await deleteRoomIfStale(code);
        continue;
      }
      throw new Error('Could not reach the server to create a room. Check your connection and try again.');
    }

    if (result.committed) return code;

    // Collision: the code is taken. Sweep it if it is ancient, which is the
    // only garbage collection this system has, then draw a new code. Failure
    // here is expected and ignored — most collisions are with a live room.
    await deleteRoomIfStale(code);
  }

  // Every attempt denied is the signature of undeployed rules or disabled
  // anonymous auth; a mix of denials and clean collisions is just bad luck.
  if (permissionDenials === CREATE_ATTEMPTS) {
    throw new Error(
      'Firebase refused to create the room. Deploy the database rules (firebase deploy --only database) and make sure Anonymous sign-in is enabled, then try again.',
    );
  }

  throw new Error(
    'Could not find a free room code after several tries. That is very unlikely — check your connection and try again.',
  );
}

/**
 * Join an existing room.
 *
 * THIS MUST NOT BE A TRANSACTION, and the reason cost real debugging time: a
 * joiner arrives on a COLD CACHE with nothing for `rooms/<code>` locally. RTDB
 * runs a transaction callback optimistically against that empty cache first,
 * and if the callback ABORTS on that null first read the SDK never round-trips
 * to the server at all — so it reports "Room not found" for a room that plainly
 * exists on the other person's screen. Any transaction whose guard is "the room
 * must already exist" has this bug by construction.
 *
 * So instead: one `get()` for friendly pre-checks, then a plain write. That is
 * not a weaker guarantee, because the atomicity that matters is enforced by the
 * security rule — `seats/$uid` is writable only by `$uid` and only while
 * `status === 'waiting'`. A plain write is therefore both correct and race-safe;
 * the worst outcome of losing a race is joining a room that fills up, which the
 * seat cap in `seatOrder` and `startGame` handles.
 *
 * `meta/updatedAt` rides along in the same multi-path update, which is exactly
 * why that leaf has its own looser write rule: at this instant `root` still
 * shows the joiner as unseated, so a participants-only rule would reject every
 * single join.
 */
export async function joinRoom(code: string, name: string): Promise<void> {
  const uid = await requireUid();

  let snap;
  try {
    snap = await get(ref(db, `rooms/${code}`));
  } catch (err) {
    // A MISSING room and a WAITING room are both readable by anyone (see
    // RULES.md — that is deliberate, so "not found" stays distinguishable from
    // "not allowed"). Therefore a denied read means neither: the room exists
    // and has left `waiting`, i.e. the game already started.
    if (isPermissionDenied(err)) {
      throw new Error('That game has already started, so it is not accepting new players.');
    }
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const room = decodeRoom(snap.val());
  if (!room || !room.meta) {
    throw new Error('Room not found. Check the code with whoever invited you — codes are five characters.');
  }
  if (room.meta.status !== 'waiting') {
    throw new Error('That game has already started, so it is not accepting new players.');
  }
  if (isRoomStale(room.meta)) {
    // The server considers this room garbage: ANY client may delete it, so
    // joining it means sitting in a lobby that can evaporate under us. Take the
    // free swing at reaping it (fire-and-forget) and report it as gone, which
    // is what it effectively is. Nothing else in the system sweeps a code the
    // client has actually looked at.
    void deleteRoomIfStale(code);
    throw new Error('That room expired after sitting idle for a day. Ask for a new code, or start your own room.');
  }
  // Rejoining your own seat is always fine and must not count against the cap.
  const alreadySeated = uid in room.seats;
  if (!alreadySeated && Object.keys(room.seats).length >= RULES.MAX_PLAYERS) {
    // Checked here and only here: RTDB rules cannot count children, so this cap
    // is client-side by necessity (documented in firebase/RULES.md).
    throw new Error(`That game is full — ${RULES.MAX_PLAYERS} players is the maximum.`);
  }

  try {
    await update(ref(db, `rooms/${code}`), {
      [`seats/${uid}`]: packSeat(Date.now(), name),
      'meta/updatedAt': serverTimestamp(),
    });
  } catch (err) {
    if (isPermissionDenied(err)) {
      // The only way to get here after the checks above is losing a race with
      // the host pressing Start.
      throw new Error('That game just started, so it is not accepting new players.');
    }
    throw new Error('Could not join the room. Check your connection and try again.');
  }
}

// ── Subscription ─────────────────────────────────────────────────────────────

/**
 * Watch a whole room. One listener for everything, because the room node is
 * small and a per-child listener set would deliver a torn view — e.g. new seats
 * paired with a stale `state`, which `seatOrder` would then disagree about.
 *
 * `cb(null)` means "no readable room": either it does not exist, or it exists
 * and we are not allowed in. Those look identical from here by design; the
 * distinction is made in `joinRoom`, which has the context to explain it.
 */
export function subscribeRoom(code: string, cb: (r: RoomSnapshot | null) => void): () => void {
  return onValue(
    ref(db, `rooms/${code}`),
    (snap) => {
      cb(snap.exists() ? decodeRoom(snap.val()) : null);
    },
    (err) => {
      console.warn(`[rooms] lost access to room ${code}:`, err);
      cb(null);
    },
  );
}

// ── Starting the game ────────────────────────────────────────────────────────

/**
 * Deal the first game. HOST ONLY, and only from a waiting room that has no
 * state yet.
 *
 * The create-if-null transaction is what makes a double-tap (or two tabs open
 * on the host's phone) safe: the second call sees a state and aborts rather
 * than dealing a fresh game over a live one.
 */
export async function startGame(code: string, room: RoomSnapshot): Promise<void> {
  const uid = await requireUid();
  const meta = room.meta;
  if (!meta) throw new Error('That room no longer exists.');
  if (meta.host !== uid) throw new Error('Only the host can start the game.');
  if (meta.status !== 'waiting') throw new Error('That game has already started.');
  if (room.state) throw new Error('That game has already started.');

  const order = seatOrder(room.seats, meta.host);
  if (order.length < 1) throw new Error('Nobody is seated yet, so there is no game to start.');

  const players: Player[] = order.map((seatUid) => ({
    uid: seatUid,
    name: room.seats[seatUid]?.name ?? 'Player',
  }));
  const initial = initialGameState(players);

  // Stamp an opening lastMove attributed to the host. The state write rule now
  // asserts `lastMove.by === auth.uid` on the CREATE branch too (it only skips
  // the check when lastMove is absent entirely, because `initialGameState`
  // leaves it null and RTDB prunes nulls — requiring it would make dealing
  // impossible). Stamping it means the invariant "every state carries the uid of
  // whoever wrote it" holds without exception. 'rematch' is the honest kind:
  // this is a fresh game with no dice on the table.
  initial.lastMove = { by: uid, seat: 0, kind: 'rematch', at: Date.now() };

  const result = await runTransaction(
    ref(db, `rooms/${code}/state`),
    (cur: unknown) => {
      if (cur !== null) return; // someone already dealt — abort
      return initial;
    },
    { applyLocally: false },
  );

  if (!result.committed) {
    throw new Error('That game was already started by someone else.');
  }

  // Close the join window. Done AFTER the deal rather than before so a failed
  // deal cannot strand the room in `playing` with no game in it; the cost is a
  // sub-second window in which a late joiner can take a seat that is not in the
  // dealt game. They see a room they are not part of and can be re-invited,
  // which is a far better failure than a lobby nobody can start.
  await update(ref(db, `rooms/${code}/meta`), {
    status: 'playing',
    updatedAt: serverTimestamp(),
  });
}

// ── Moves ────────────────────────────────────────────────────────────────────

/**
 * Submit a move. THE core write path — everything about a turn goes through
 * here.
 *
 * Three decisions worth understanding before touching this:
 *
 * (a) `applyLocally: false`, here and on every other transaction in this file.
 *     By default the SDK optimistically applies the candidate value to local
 *     listeners the moment the callback returns, then rolls it back if the
 *     commit is refused. For a board game that shows up as a speculative board:
 *     dice land, the scorecard fills, and then the whole thing SNAPS BACK a
 *     beat later when the server says no. The cost of disabling it is a full
 *     round-trip of latency per move, which is what the `pendingMove` flag in
 *     the store exists to cover (disable the controls, show it is in flight).
 *
 * (b) A transaction callback can only signal "abort" by returning `undefined`,
 *     which throws away WHY it aborted — and "not your turn" versus "that box
 *     is already used" is precisely what the player needs to be told. So the
 *     reducer's message is captured into an enclosing holder and read back
 *     after `result.committed` comes back false.
 *
 *     The holder is an object rather than a bare `let` for a TypeScript reason:
 *     control-flow analysis does not track assignments made inside a callback,
 *     so a `let moveError: string | null = null` would still be narrowed to
 *     `null` at the point we try to read it, and comparing it to a string is a
 *     compile error. Property access on an object is re-widened after any
 *     intervening function call, so this reads correctly.
 *
 * (c) Returns `{ ok, error }` instead of throwing. A rejected move is a normal,
 *     expected outcome (you tapped a used box; your opponent's move landed
 *     first), not an exception — and the caller needs the reason as prose it can
 *     put on screen.
 */
export async function submitMove(
  code: string,
  move: Move,
): Promise<{ ok: boolean; error?: string }> {
  let uid: string;
  try {
    uid = await requireUid();
  } catch {
    return { ok: false, error: 'You are not signed in yet. Wait a moment and try again.' };
  }

  const moveError: { reason: string | null } = { reason: null };

  let result;
  try {
    result = await runTransaction(
      ref(db, `rooms/${code}/state`),
      (cur: unknown) => {
        const s = normalize(cur);
        // No readable game yet. The callback runs once against an empty local
        // cache before the server data arrives, so this abort is normal on the
        // first pass and the SDK retries with real data.
        if (!s) return;

        const r = applyMove(s, move, uid);
        if (!r.ok) {
          moveError.reason = r.error;
          return; // abort — the reason is in the holder
        }
        return r.state;
      },
      { applyLocally: false },
    );
  } catch (err) {
    if (isPermissionDenied(err)) {
      // The rules refused it. In practice this is the version-monotonicity or
      // turnUid clause: someone else's move landed between our read and write.
      return { ok: false, error: 'That move was refused by the server — the game moved on. It should catch up in a moment.' };
    }
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }

  if (!result.committed) {
    return {
      ok: false,
      error: moveError.reason ?? 'That move could not be applied. The game may have moved on since you tapped.',
    };
  }

  // Everything below is fire-and-forget: the move is already committed and the
  // opponent has already seen it. Nothing here may delay or fail the move.
  void freshenUpdatedAt(code);

  return { ok: true };
}

/** Keep the room out of the 24h reaper's sights while it is being played. */
async function freshenUpdatedAt(code: string): Promise<void> {
  try {
    await set(ref(db, `rooms/${code}/meta/updatedAt`), serverTimestamp());
  } catch {
    // Cosmetic. A room being actively played is not going to hit 24h idle.
  }
}

// The per-move replay log that used to live here wrote `matches/<mid>/log/<v>`.
// It is gone along with the rest of the archive; replay analytics is still
// possible at any time because the engine keeps every seed inside the move that
// consumes it, so `initial state + ordered move log` is reconstructible. See
// firebase/RULES.md for why this particular implementation was not salvageable.

// ── Cosmetic state ───────────────────────────────────────────────────────────

/**
 * Publish which dice this player is holding, so opponents can watch them think.
 *
 * Deliberately OUTSIDE `state` and outside the move transaction: holding is not
 * a move (see DESIGN.md), it changes several times a turn, and routing it
 * through `applyMove` would put a full transaction round-trip behind every die
 * tap. Errors are swallowed because a lost hold update is invisible to the
 * player who made it and self-corrects on the next tap.
 *
 * The argument stays a die-index array — the UI must not have to think in bits —
 * and is packed into the mask the rules require right here, at the boundary.
 * Clearing holds now writes the number `0` rather than an empty array that RTDB
 * would prune into a delete, so "holding nothing" is a value like any other.
 */
export async function setMyHolds(code: string, holds: number[]): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  try {
    await set(ref(db, `rooms/${code}/holds/${uid}`), holdsToMask(holds));
  } catch {
    // Cosmetic only.
  }
}

// ── Rematch ──────────────────────────────────────────────────────────────────

/**
 * Vote to play again, and start the new game once everyone has.
 *
 * Votes are tombstones under `rematch/<uid>` (the rules require the literal
 * `true`; there is no "no" vote — you just do not press the button). Every
 * client independently checks whether the vote is unanimous and every one of
 * them may submit the rematch. That race is safe by construction: the first
 * `{ kind: 'rematch' }` to land moves the phase out of `over`, and the reducer
 * rejects every straggler with "the game is not over yet".
 */
export async function voteRematch(code: string): Promise<void> {
  const uid = await requireUid();

  let snap;
  try {
    snap = await get(ref(db, `rooms/${code}`));
  } catch {
    return; // no readable room; nothing sensible to do
  }
  const room = decodeRoom(snap.val());
  if (!room || !room.meta) return;

  // A vote only means anything while the game is over. If a new game is already
  // running, drop our own stale vote instead — leftover tombstones from the
  // previous game would otherwise make the NEXT rematch unanimous before the
  // other players had agreed to it.
  if (!room.state || room.state.phase !== 'over') {
    await clearMyVote(code, uid);
    return;
  }

  try {
    await set(ref(db, `rooms/${code}/rematch/${uid}`), true);
  } catch {
    return; // could not record the vote; the button can be pressed again
  }

  const votes = { ...room.rematch, [uid]: true };
  const seated = seatOrder(room.seats, room.meta.host);
  const unanimous = seated.length > 0 && seated.every((seatUid) => votes[seatUid] === true);
  if (!unanimous) return;

  const submitted = await submitMove(code, { kind: 'rematch' });
  // Retire our own tombstone once the new game is dealt. We cannot clear the
  // others' — `rematch/$uid` is writable only by `$uid` — so each client retires
  // its own on its next call, via the phase check above.
  if (submitted.ok) await clearMyVote(code, uid);
}

async function clearMyVote(code: string, uid: string): Promise<void> {
  try {
    await remove(ref(db, `rooms/${code}/rematch/${uid}`));
  } catch {
    // Best effort; a stale vote is corrected on the next pass.
  }
}

// ── Leaving and cleanup ──────────────────────────────────────────────────────

/**
 * Leave a room, taking everything of ours with us.
 *
 * A host leaving a game that has not started deletes the whole room, because
 * a lobby with no host can never be started — nobody else is allowed to deal.
 * Once play has begun the room survives so the remaining players can finish:
 * the leaver gives up their seat (and therefore their write access), but the
 * dealt `state` keeps its own copy of the player list, so the game they walked
 * out of is unchanged.
 */
export async function leaveRoom(code: string): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;

  // Cancel any armed disconnect handler first. An onDisconnect queued against
  // a room we are walking away from would otherwise fire later and resurrect a
  // presence node under a room we have left — or under a room that has since
  // been deleted and recreated by someone else with the same code.
  try {
    await onDisconnect(ref(db, `rooms/${code}/presence/${uid}`)).cancel();
  } catch {
    // Nothing armed, or offline. Either way there is nothing to undo.
  }

  let snap;
  try {
    snap = await get(ref(db, `rooms/${code}`));
  } catch {
    snap = null;
  }
  const room = snap ? decodeRoom(snap.val()) : null;

  if (room?.meta && room.meta.host === uid && room.meta.status === 'waiting') {
    try {
      await remove(ref(db, `rooms/${code}`));
      return;
    } catch {
      // Fall through and at least clean up our own nodes.
    }
  }

  // COSMETIC NODES FIRST, SEAT LAST. Doing all four concurrently was a
  // deterministic bug: the write grant on presence/holds/rematch requires the
  // caller to still be seated (or be the host), so whenever the seat delete
  // landed first the other three were refused — silently, since these failures
  // are swallowed. A guest who left a lobby stayed `presence: { online: true }`
  // to everyone else until the 24h reaper took the room. The rules now also
  // permit an unconditional self-delete of those nodes, so this ordering is no
  // longer the only thing standing between us and the bug — but "give up your
  // membership last" is the correct shape regardless and costs one await.
  await Promise.all(
    [
      `rooms/${code}/presence/${uid}`,
      `rooms/${code}/holds/${uid}`,
      `rooms/${code}/rematch/${uid}`,
    ].map((path) => removeQuietly(path)),
  );
  // Permitted at any time — `seats/$uid` allows its own uid to delete it
  // unconditionally. The dealt `state` keeps its copy of the players, so a
  // mid-game leaver's seat stays in the game they are walking out of; only
  // their membership (and with it their write access) goes.
  await removeQuietly(`rooms/${code}/seats/${uid}`);

  // Opportunistic sweep on the way out. If this room has been idle for 24h the
  // server will take it; otherwise the delete is denied, which is the normal
  // outcome and is swallowed. Not awaited: leaving must not wait on cleanup.
  void deleteRoomIfStale(code);
}

/** Delete a path we do not care about failing to delete. */
async function removeQuietly(path: string): Promise<void> {
  try {
    await remove(ref(db, path));
  } catch {
    // Every caller here is best-effort cleanup; see leaveRoom for which of
    // these the rules refuse on purpose.
  }
}

/**
 * Attempt to delete a room, which the server permits only if it has been idle
 * for over 24 hours.
 *
 * This is the entire garbage collector. There is no cron and no Cloud Function
 * (Spark plan), so it must be called from every place a client already holds a
 * code it can see is dead. It used to be called ONLY on a create-collision,
 * which happens roughly never against 28.6M codes — so in practice the
 * collector never ran and rooms accumulated forever on a free plan. The call
 * sites are now: create-collision, opening a room that decodes as stale
 * (`joinRoom`, and the bound-room snapshot in gameStore), and `leaveRoom`.
 * All are best-effort and none of them block anything the user is waiting on.
 * No timers, no polling — that would be a background write loop on a quota'd
 * database for the sake of someone else's abandoned lobby.
 *
 * THE DELETE IS ATTEMPTED UNCONDITIONALLY, AND THAT IS THE FIX FOR A REAL BUG.
 * This used to `get(rooms/<code>/meta)` first and bail when the read failed.
 * That looked load-bearing but was only an optimisation to save a doomed write
 * — and it silently disabled the reaper on exactly the rooms that need it. A
 * non-participant may only READ a room that is missing or `waiting`, so an
 * ABANDONED `playing` room denies the read, the bail fires, and the delete is
 * never even tried — even though the rule's 24h stale clause would have allowed
 * it, needing no read at all. Every abandoned in-progress game leaked forever
 * and burned its code.
 *
 * The rule re-checks both `createdAt` and `updatedAt` itself, so it is the sole
 * arbiter of staleness; duplicating that arithmetic here would only reintroduce
 * a way for the two to disagree.
 */
export async function deleteRoomIfStale(code: string): Promise<void> {
  try {
    await remove(ref(db, `rooms/${code}`));
  } catch (err) {
    if (isPermissionDenied(err)) return; // room is alive — the expected outcome
    // Anything else is a transport problem. Reaping is opportunistic; the next
    // client to collide with this code will try again.
  }
}
