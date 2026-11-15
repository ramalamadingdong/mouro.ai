/**
 * Room operations for online play. Adapted from the yahtzee app, which is the
 * repo's reference for an N-player room; the room code, seat and presence
 * conventions are identical so the two stay recognisable side by side.
 *
 * Shape of a room (mirrors database.rules.json exactly — see RULES.md):
 *
 *   rooms/<CODE>/
 *     meta/           { host, status: 'waiting' | 'playing', createdAt, updatedAt }
 *     seats/<uid>     "<joinedAt>|<name>"     <- one packed string (util/seat.ts)
 *     state/          the engine's GameState  <- written only through submitMove
 *     presence/<uid>  number (last-seen ms)   <- exists = connected
 *
 * Things with specific reasons:
 *
 *  1. EVERY MOVE IS A TRANSACTION WITH `applyLocally: false`. The reducer runs
 *     inside it against the server's current state, and the screen only ever
 *     shows states the server accepted. Without it a refused line would
 *     appear, then vanish.
 *
 *  2. Presence lives in a sibling node, never inside `state`, so a flapping
 *     connection never contends with a move transaction.
 */
import { get, onDisconnect, onValue, ref, remove, runTransaction, serverTimestamp, set, update } from '@mouro/realtime';
import { RULES, applyMove, createGame, normalize, type GameState, type Move } from '@/engine';
import { db } from '@/net/realtime';
import { ensureAnonymousAuth, getCurrentUid } from '@/net/auth';
import { randomRoomCode } from '@/util/seed';
import { MAX_NAME_LENGTH, packSeat, unpackSeat } from '@/util/seat';

/** One membership record. The key is the uid; the seat index is NOT stored. */
export interface RoomSeat {
  name: string;
  joinedAt: number;
}

export interface RoomMeta {
  host: string;
  status: 'waiting' | 'playing';
  createdAt: number;
  updatedAt: number;
}

export interface RoomSnapshot {
  meta: RoomMeta | null;
  seats: Record<string, RoomSeat>;
  state: GameState | null;
  /** uid → last-seen ms. A uid that is missing is not connected. */
  presence: Record<string, number>;
}

/** What the host chooses in the lobby. */
export interface RoomOptions {
  /** Boxes per side. */
  size: number;
}

/** How many fresh codes to try before giving up on a create. */
const CREATE_ATTEMPTS = 5;

/** The idle window after which the rules let anyone delete a room. */
const ROOM_STALE_MS = 86_400_000;

export function isRoomStale(meta: RoomMeta | null): boolean {
  if (!meta || meta.createdAt <= 0 || meta.updatedAt <= 0) return false;
  const now = Date.now();
  return now - meta.createdAt > ROOM_STALE_MS && now - meta.updatedAt > ROOM_STALE_MS;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function requireUid(): Promise<string> {
  return getCurrentUid() ?? ensureAnonymousAuth();
}

/** True when an error is the rules engine refusing the operation. */
function isPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = (err as Error | null)?.message ?? '';
  return code === 'PERMISSION_DENIED' || message.includes('PERMISSION_DENIED');
}

/** By code point, so an emoji or accented letter is never cut in half. */
function cleanName(raw: string): string {
  const trimmed = Array.from(raw.trim()).slice(0, MAX_NAME_LENGTH).join('');
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
    createdAt: Number.isFinite(Number(createdAt)) ? Number(createdAt) : 0,
    updatedAt: Number.isFinite(Number(updatedAt)) ? Number(updatedAt) : 0,
  };
}

function decodeSeats(v: unknown): Record<string, RoomSeat> {
  const out: Record<string, RoomSeat> = {};
  if (!isObj(v)) return out;
  for (const [uid, entry] of Object.entries(v)) {
    const seat = unpackSeat(entry);
    if (seat) out[uid] = seat;
  }
  return out;
}

function decodePresence(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [uid, entry] of Object.entries(v)) {
    const lastSeen = Number(entry);
    if (Number.isFinite(lastSeen) && lastSeen > 0) out[uid] = lastSeen;
  }
  return out;
}

function decodeRoom(raw: unknown): RoomSnapshot | null {
  if (!isObj(raw)) return null;
  return {
    meta: decodeMeta(raw.meta),
    seats: decodeSeats(raw.seats),
    // normalize() returns null for a state that fails its integrity checks,
    // which the table shows as "no game" rather than rendering a forgery.
    state: normalize(raw.state),
    presence: decodePresence(raw.presence),
  };
}

/**
 * The order players sit in: host first, then by join time (uid as the
 * tie-break, so every client computes the same order). Capped at
 * RULES.MAX_PLAYERS because the rules engine cannot count children — the cap
 * is enforced here and in joinRoom only.
 */
export function seatOrder(seats: Record<string, RoomSeat>, host: string): string[] {
  const others = Object.keys(seats).filter((uid) => uid !== host);
  others.sort((a, b) => {
    const byTime = seats[a].joinedAt - seats[b].joinedAt;
    return byTime !== 0 ? byTime : a < b ? -1 : a > b ? 1 : 0;
  });
  const ordered = host in seats ? [host, ...others] : others;
  return ordered.slice(0, RULES.MAX_PLAYERS);
}

/** Create a room with the caller as host and first seat. Returns its code. */
export async function createRoom(hostName: string): Promise<string> {
  const uid = await requireUid();
  const name = cleanName(hostName);
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = randomRoomCode();
    const now = Date.now();
    const room = {
      meta: { host: uid, status: 'waiting' as const, createdAt: now, updatedAt: now },
      seats: { [uid]: packSeat(now, name) },
    };
    let result;
    try {
      result = await runTransaction(
        ref(db, `rooms/${code}`),
        (cur: unknown) => (cur === null ? room : undefined), // occupied → abort, try another code
        { applyLocally: false },
      );
    } catch (err) {
      if (isPermissionDenied(err)) {
        // Almost always a code that is taken by a room we cannot read. If it
        // is a dead one, this frees the code for somebody later.
        await deleteRoomIfStale(code);
        continue;
      }
      throw new Error('Could not reach the server to create a room. Check your connection and try again.');
    }
    if (result.committed) return code;
    await deleteRoomIfStale(code);
  }
  throw new Error('Could not find a free room code after several tries. Check your connection and try again.');
}

/** Take a seat in a waiting room. Idempotent for a player who is already seated. */
export async function joinRoom(code: string, name: string): Promise<void> {
  const uid = await requireUid();
  let snap;
  try {
    snap = await get(ref(db, `rooms/${code}`));
  } catch (err) {
    // A room that is 'playing' is unreadable to a non-member (see RULES.md),
    // which is how "already started" is told apart from "not found".
    if (isPermissionDenied(err)) {
      throw new Error('That game has already started, so it is not accepting new players.');
    }
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const room = decodeRoom(snap.val());
  if (!room || !room.meta) {
    throw new Error('Room not found. Check the code with whoever invited you — codes are five characters.');
  }
  // Already seated (a reload, or the invite link opened twice): nothing to do,
  // even if the game has started — the lobby will forward to the table.
  if (uid in room.seats) return;
  if (room.meta.status !== 'waiting') {
    throw new Error('That game has already started, so it is not accepting new players.');
  }
  if (isRoomStale(room.meta)) {
    void deleteRoomIfStale(code);
    throw new Error('That room expired after sitting idle for a day. Ask for a new code, or start your own room.');
  }
  if (Object.keys(room.seats).length >= RULES.MAX_PLAYERS) {
    throw new Error(`That game is full — ${RULES.MAX_PLAYERS} players is the maximum.`);
  }
  try {
    await update(ref(db, `rooms/${code}`), {
      [`seats/${uid}`]: packSeat(Date.now(), cleanName(name)),
      'meta/updatedAt': serverTimestamp(),
    });
  } catch (err) {
    if (isPermissionDenied(err)) {
      throw new Error('That game just started, so it is not accepting new players.');
    }
    throw new Error('Could not join the room. Check your connection and try again.');
  }
}

export function subscribeRoom(code: string, cb: (room: RoomSnapshot | null) => void): () => void {
  return onValue(
    ref(db, `rooms/${code}`),
    (snap) => cb(snap.exists() ? decodeRoom(snap.val()) : null),
    (err) => {
      console.warn(`[rooms] lost access to room ${code}:`, err);
      cb(null);
    },
  );
}

/**
 * Host only: seat everyone, write the empty board, and close the room to new
 * joiners. The first state is stamped `start` by the host, which is the only
 * first write the rules accept.
 */
export async function startGame(code: string, room: RoomSnapshot, options: RoomOptions): Promise<void> {
  const uid = await requireUid();
  const meta = room.meta;
  if (!meta) throw new Error('That room no longer exists.');
  if (meta.host !== uid) throw new Error('Only the host can start the game.');
  if (meta.status !== 'waiting' || room.state) throw new Error('That game has already started.');

  const order = seatOrder(room.seats, meta.host);
  if (order.length < RULES.MIN_PLAYERS) throw new Error('Dots and Boxes needs at least two players.');

  const fresh = createGame({
    players: order.map((seatUid) => ({ uid: seatUid, name: room.seats[seatUid]?.name ?? 'Player', isHuman: true })),
    cols: options.size,
    rows: options.size,
    by: uid,
  });

  const result = await runTransaction(
    ref(db, `rooms/${code}/state`),
    (cur: unknown) => (cur === null ? fresh : undefined), // someone already started → abort
    { applyLocally: false },
  );
  if (!result.committed) throw new Error('That game was already started.');
  // State first, status second: a joiner racing the start is then refused by
  // the seat rule rather than seated at a game that has no place for them.
  await update(ref(db, `rooms/${code}/meta`), { status: 'playing', updatedAt: serverTimestamp() });
}

/**
 * Apply one move to the shared state, through the reducer, in a transaction.
 * Returns an error string instead of throwing: a refused move is an ordinary
 * outcome (someone else got there first), not an exception.
 */
export async function submitMove(code: string, move: Move): Promise<{ ok: boolean; error?: string }> {
  let uid: string;
  try {
    uid = await requireUid();
  } catch {
    return { ok: false, error: 'You are not connected yet. Wait a moment and try again.' };
  }
  let reason: string | null = null;
  let result;
  try {
    result = await runTransaction(
      ref(db, `rooms/${code}/state`),
      (cur: unknown) => {
        const state = normalize(cur);
        if (!state) return;
        const applied = applyMove(state, move, uid);
        if (!applied.ok) {
          reason = applied.error;
          return; // abort
        }
        return applied.state;
      },
      { applyLocally: false },
    );
  } catch (err) {
    if (isPermissionDenied(err)) {
      return { ok: false, error: 'The server refused that move — the game has moved on. It should catch up in a moment.' };
    }
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
  if (!result.committed) {
    return { ok: false, error: reason ?? 'That move could not be applied. The game may have moved on since you tapped.' };
  }
  void freshenUpdatedAt(code);
  return { ok: true };
}

/** Keep the room out of the 24h reaper's sights while it is being played. */
async function freshenUpdatedAt(code: string): Promise<void> {
  try {
    await set(ref(db, `rooms/${code}/meta/updatedAt`), serverTimestamp());
  } catch {
    // Best effort: a missed bump costs nothing until the room has been idle a day.
  }
}

/**
 * Leave a room. The host leaving a WAITING room closes it for everyone; in
 * every other case only the caller's own nodes go. Mid-game that gives up the
 * leaver's write access, and the others' clients will then draw their lines
 * for them (see the `away` move).
 */
export async function leaveRoom(code: string): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  try {
    await onDisconnect(ref(db, `rooms/${code}/presence/${uid}`)).cancel();
  } catch {
    // Nothing queued, or no connection: either way there is nothing to cancel.
  }
  let room: RoomSnapshot | null = null;
  try {
    room = decodeRoom((await get(ref(db, `rooms/${code}`))).val());
  } catch {
    room = null;
  }
  if (room?.meta && room.meta.host === uid && room.meta.status === 'waiting') {
    try {
      await remove(ref(db, `rooms/${code}`));
      return;
    } catch {
      // Fall through to removing just our own nodes.
    }
  }
  // Presence BEFORE the seat: the presence rule requires membership for
  // anything but a delete, and deletes are cheapest while still a member.
  await removeQuietly(`rooms/${code}/presence/${uid}`);
  await removeQuietly(`rooms/${code}/seats/${uid}`);
  void deleteRoomIfStale(code);
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await remove(ref(db, path));
  } catch {
    // Already gone, or the room is: the outcome we wanted either way.
  }
}

/**
 * Try to delete a room that has been idle for a day. Fired blind, without
 * reading first: the rule re-checks both timestamps and is the sole arbiter,
 * and a non-member cannot read a 'playing' room to decide for itself. A live
 * room simply refuses, which is the expected outcome.
 */
export async function deleteRoomIfStale(code: string): Promise<void> {
  try {
    await remove(ref(db, `rooms/${code}`));
  } catch {
    // Refused (alive) or unreachable — nothing to do in either case.
  }
}
