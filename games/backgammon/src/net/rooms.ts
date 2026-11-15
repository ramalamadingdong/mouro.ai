/**
 * Room lifecycle + move submission against the Realtime Database. Every write
 * here is shaped to satisfy the `bgRooms` security rules exactly — a write that
 * violates them is rejected at runtime.
 *
 * This app shares a Firebase project with the gin rummy app, which is why every
 * path is prefixed `bg`. The two games never touch each other's nodes.
 *
 * Data model (bgRooms/<CODE>):
 *   meta:     { host, hostName, guest?, guestName?, status, createdAt, updatedAt,
 *               target? }  // target = host-chosen MATCH LENGTH IN POINTS
 *   presence: { <uid>: { online, lastSeen } }
 *   state:    <GameState>   // written whole via transaction; ABSENT until started
 *   rematch:  { <uid>: true }
 *   emotes:   { <uid>: { emoji, n } }  // latest reaction each player sent; `n`
 *             bumps per send so the peer re-pops the same emoji. Ephemeral, kept
 *             OUT of `state` so it never touches the move transaction.
 *   draft:    { <uid>: { v, s } }  // the turn that player is STAGING right now,
 *             so the opponent can watch it take shape. `v` is the state version
 *             it was staged against (a draft for any other version is stale and
 *             ignored — nothing ever has to clear it); `s` is the steps, packed
 *             as "from:to,from:to" in the stager's own frame. Cosmetic only: a
 *             turn still counts only when it is committed through `state`.
 *
 * Separate archive (bgMatches/<matchId>), OUTSIDE bgRooms/ so it survives the
 * 24h room reaper (see `matchIdFor`):
 *   meta:     { code, createdAt, startedAt }
 *   players:  { p0: <uid>, p1: <uid> }
 *   initial:  <GameState>            // the opening position (version 0)
 *   log:      { <version>: { seat, move } }  // every accepted move, in order
 * `initial` + the ordered `log` deterministically replays the whole match: the
 * opening position is fixed and every roll carries its own seed inside the move.
 */
import { get, onValue, ref, remove, runTransaction, serverTimestamp, set, update } from '@mouro/realtime';
import { applyMove, initialMatchState, normalize } from '@/engine';
import type { GameState, Move, Step } from '@/engine/types';
import { packSteps } from '@/util/draft';
import { getCurrentUid } from '@/net/auth';
import { db } from '@/net/realtime';
import { randomRoomCode } from '@/util/seed';

export interface RoomMeta {
  host: string;
  hostName: string;
  guest?: string;
  guestName?: string;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  updatedAt: number;
  /** Host-chosen match length in POINTS. Absent → engine default. */
  target?: number;
}

export interface PresenceEntry {
  online: boolean;
  lastSeen: number;
}

/** A player's latest reaction. `n` bumps each send so the peer re-pops it. */
export interface EmoteEntry {
  emoji: string;
  n: number;
}

/** A player's in-progress turn, as published to the opponent. See `publishDraft`. */
export interface DraftEntry {
  v: number;
  s: string;
}

export interface RoomSnapshot {
  code: string;
  meta: RoomMeta;
  state: GameState | null;
  presence: Record<string, PresenceEntry>;
  rematch: Record<string, boolean>;
  emotes: Record<string, EmoteEntry>;
  drafts: Record<string, DraftEntry>;
}

const DAY_MS = 86400000;

/**
 * Stable archive id for a match at `bgMatches/<matchId>`. Room codes are
 * recycled (the 24h reaper + create-collision sweep free them), so the code
 * alone is not unique across time — we pair it with the room's immutable
 * `createdAt` so a later match reusing the code writes to a DISTINCT node. Both
 * the starter and every mover derive the same id from data they already hold, so
 * no extra read or stored pointer is needed.
 */
export function matchIdFor(code: string, createdAt: number): string {
  return `${code}-${createdAt}`;
}

/** True for a Realtime Database permission-denied rejection. */
function isPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = (err as Error)?.message ?? '';
  return code === 'PERMISSION_DENIED' || /permission[_ ]?denied/i.test(msg);
}

/**
 * Create a room with a fresh crypto code. Uses a create-if-null transaction so
 * two hosts can never claim the same code; on collision it opportunistically
 * clears a stale room and retries with a new code (max 5 attempts).
 *
 * NOTE: we deliberately do NOT arm an onDisconnect().remove() on the waiting
 * room. On mobile the RTDB socket drops on any brief background (e.g. the OS
 * Share sheet that pops up to send the code!) or network blip, which would fire
 * onDisconnect and delete a perfectly good room out from under the host — the
 * guest then sees "Room not found". Abandoned rooms are instead reaped by the
 * 24h stale-cleanup rule and the create-collision sweep.
 */
export async function createRoom(hostName: string): Promise<string> {
  const uid = getCurrentUid();
  if (!uid) throw new Error('Not authenticated');

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomRoomCode();
    const roomRef = ref(db, `bgRooms/${code}`);
    const now = Date.now();
    const meta: RoomMeta = {
      host: uid,
      hostName,
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
    };

    const result = await runTransaction(
      roomRef,
      (cur) => {
        if (cur !== null) return; // abort: code taken
        return { meta };
      },
      { applyLocally: false },
    );

    if (result.committed) return code;

    // Collision — try to reap it if it's stale, then loop to a new code.
    await deleteRoomIfStale(code);
  }

  throw new Error('Could not create a room, please try again');
}

/**
 * Claim the empty guest seat. Reads meta for a friendly pre-check, then writes
 * the guest fields with a plain update().
 *
 * We deliberately do NOT use a transaction here. A guest joins on a COLD cache,
 * and an RTDB transaction that aborts on a null first read (which happens before
 * the client has synced the location) never fetches the real room — it reported
 * "Room not found" for a room that plainly exists. The security rules enforce
 * single-guest atomicity instead: the guest-claim `.write` rule only allows the
 * write while `status === 'waiting'` and no guest exists, so a second claimant
 * (or a claim after the host has started) is denied.
 */
export async function joinRoom(code: string, guestName: string): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) throw new Error('Not authenticated');

  const metaRef = ref(db, `bgRooms/${code}/meta`);

  let meta: RoomMeta | null;
  try {
    const snap = await get(metaRef);
    meta = snap.val() as RoomMeta | null;
  } catch (err) {
    // A non-member read is denied once the room has left 'waiting' (a missing
    // room and a waiting room are both readable), so this means it started.
    if (isPermissionDenied(err)) throw new Error('Game already started');
    throw err;
  }

  if (!meta) throw new Error('Room not found');
  if (meta.status !== 'waiting') throw new Error('Game already started');
  if (meta.guest) throw new Error('Room is full');

  try {
    await update(metaRef, { guest: uid, guestName, updatedAt: Date.now() });
  } catch (err) {
    if (isPermissionDenied(err)) {
      throw new Error('Could not join — the room just filled up or the game started.');
    }
    throw err;
  }
}

/**
 * Live subscription to a room. Normalizes the raw state child (repairing RTDB
 * pruning) and defaults missing children to {}. Calls back with null if the room
 * is gone. Returns an unsubscribe function.
 */
export function subscribeRoom(code: string, cb: (room: RoomSnapshot | null) => void): () => void {
  const roomRef = ref(db, `bgRooms/${code}`);
  return onValue(
    roomRef,
    (snap) => {
      const val = snap.val() as {
        meta?: RoomMeta;
        state?: unknown;
        presence?: Record<string, PresenceEntry>;
        rematch?: Record<string, boolean>;
        emotes?: Record<string, EmoteEntry>;
        draft?: Record<string, DraftEntry>;
      } | null;
      if (!val || !val.meta) {
        cb(null);
        return;
      }
      cb({
        code,
        meta: val.meta,
        state: normalize(val.state),
        presence: val.presence ?? {},
        rematch: val.rematch ?? {},
        emotes: val.emotes ?? {},
        drafts: val.draft ?? {},
      });
    },
    () => {
      // Read denied/cancelled (e.g. resuming into a room that is now
      // 'playing'/'finished' where we are not a member). Report the room as
      // unavailable rather than freezing on a stale snapshot.
      cb(null);
    },
  );
}

/**
 * Submit a move via a transaction on bgRooms/<code>/state. Normalizes the
 * current value, runs the PURE REDUCER INSIDE THE TRANSACTION, and writes the
 * new state (or aborts). Returns {ok} rather than throwing so callers can
 * surface rejection reasons.
 *
 * `applyLocally: false` matters: with it on, RTDB would optimistically show the
 * new state locally and then snap back if the server rejected it, which for a
 * board game means checkers visibly jumping around.
 *
 * When `matchId` is supplied the accepted move is also appended (best-effort) to
 * `bgMatches/<matchId>/log/<version>`. The key is the NEW state version, which
 * makes the write idempotent (a retried move maps to the same key and the
 * append-only rule denies the overwrite) and gives a replayer a strictly
 * ordered, gap-detectable stream. Archiving never blocks or fails a move.
 */
export async function submitMove(
  code: string,
  move: Move,
  matchId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const uid = getCurrentUid();
  if (!uid) return { ok: false, error: 'Not authenticated' };

  const stateRef = ref(db, `bgRooms/${code}/state`);
  let moveError: string | null = null;

  try {
    const result = await runTransaction(
      stateRef,
      (cur) => {
        const s = normalize(cur);
        if (!s) return; // abort: no valid state
        const r = applyMove(s, move, uid);
        if (!r.ok) {
          moveError = r.error;
          return; // abort: illegal move
        }
        return r.state;
      },
      { applyLocally: false },
    );

    if (!result.committed) {
      return { ok: false, error: moveError ?? 'Move rejected' };
    }

    // Fire-and-forget bookkeeping: freshen updatedAt now that play is underway.
    update(ref(db, `bgRooms/${code}/meta`), { updatedAt: serverTimestamp() }).catch(() => {});

    if (matchId) {
      const committed = result.snapshot.val() as GameState | null;
      const version = committed?.version;
      const seat = committed?.lastMove?.seat;
      if (typeof version === 'number' && seat) {
        set(ref(db, `bgMatches/${matchId}/log/${version}`), { seat, move }).catch(() => {});
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'Move failed' };
  }
}

/**
 * Host-only: when a guest is present and no state exists yet, write the opening
 * position into bgRooms/<code>/state (create-if-null transaction) and flip
 * meta.status to 'playing'. No-op for the guest or once started.
 *
 * The first state write must satisfy the rule `lastMove/by === auth.uid`, so we
 * stamp an initial lastMove attributed to the host (lastMove is a UI heuristic
 * only and never feeds game logic).
 */
export async function startMatchIfNeeded(code: string, room: RoomSnapshot): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;

  const { meta, state } = room;
  if (meta.host !== uid) return; // only the host starts
  if (!meta.guest) return; // need a guest first
  if (state) return; // already started

  const opening = initialMatchState({
    hostUid: meta.host,
    guestUid: meta.guest,
    hostName: meta.hostName,
    guestName: meta.guestName ?? 'Guest',
    target: meta.target,
  });
  const initial: GameState = {
    ...opening,
    lastMove: { by: uid, seat: 'p0', kind: 'nextGame', at: Date.now() },
  };

  const stateRef = ref(db, `bgRooms/${code}/state`);
  const result = await runTransaction(
    stateRef,
    (cur) => {
      if (cur !== null) return; // someone already started
      return initial;
    },
    { applyLocally: false },
  );

  if (result.committed) {
    await update(ref(db, `bgRooms/${code}/meta`), {
      status: 'playing',
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    // Fire-and-forget archive: `initial` plus the move stream replays the match.
    const matchId = matchIdFor(code, meta.createdAt);
    update(ref(db, `bgMatches/${matchId}`), {
      meta: { code, createdAt: meta.createdAt, startedAt: serverTimestamp() },
      players: { p0: meta.host, p1: meta.guest },
      initial,
    }).catch(() => {});
  }
}

/**
 * Record this player's rematch vote. When both members have voted, submit the
 * `rematch` move (a transaction; safe if both clients race — the loser's apply
 * is rejected because the phase is no longer matchOver).
 */
export async function voteRematch(code: string): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;

  await set(ref(db, `bgRooms/${code}/rematch/${uid}`), true);

  const metaSnap = await get(ref(db, `bgRooms/${code}/meta`));
  const meta = metaSnap.val() as RoomMeta | null;
  if (!meta || !meta.guest) return;

  const votesSnap = await get(ref(db, `bgRooms/${code}/rematch`));
  const votes = (votesSnap.val() ?? {}) as Record<string, boolean>;
  if (votes[meta.host] && votes[meta.guest]) {
    await submitMove(code, { kind: 'rematch' }, matchIdFor(code, meta.createdAt));
  }
}

/**
 * Host-only: set the match length (in points) before the match starts. The
 * security rules permit only a member to write meta and bound the value; a
 * non-host or an out-of-range value is rejected. Best-effort — a denied write
 * (e.g. rules not yet deployed) is swallowed and the start falls back to the
 * default match length.
 */
export async function setRoomTarget(code: string, target: number): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  try {
    await update(ref(db, `bgRooms/${code}/meta`), { target, updatedAt: Date.now() });
  } catch {
    // permission denied / offline — falls back to the default at start.
  }
}

/**
 * Broadcast a reaction to the room: write emotes/<uid> = { emoji, n } so the
 * OPPONENT's client re-pops it (n bumps each send to retrigger an identical
 * emoji). Ephemeral and fire-and-forget.
 */
export async function sendEmote(code: string, emoji: string): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  try {
    await set(ref(db, `bgRooms/${code}/emotes/${uid}`), { emoji, n: Date.now() });
  } catch {
    // permission denied / offline — reactions are cosmetic, ignore.
  }
}

/**
 * Publish the turn this player is staging, so the opponent sees the checkers
 * move as they are tried rather than all at once on commit. Fire-and-forget:
 * if it fails the opponent simply sees the turn when it is committed, as before.
 */
export async function publishDraft(code: string, version: number, steps: Step[]): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  try {
    await set(ref(db, `bgRooms/${code}/draft/${uid}`), { v: version, s: packSteps(steps) });
  } catch {
    // permission denied / offline — cosmetic, ignore.
  }
}

/**
 * Opportunistic cleanup: delete the room if its last update is older than a day.
 * Read/delete may be denied for a non-member on a non-waiting room — that's
 * fine, it's swallowed.
 */
export async function deleteRoomIfStale(code: string): Promise<void> {
  try {
    const roomRef = ref(db, `bgRooms/${code}`);
    const snap = await get(roomRef);
    const val = snap.val() as { meta?: RoomMeta } | null;
    if (!val || !val.meta) return;
    if (Date.now() - val.meta.updatedAt > DAY_MS) {
      await remove(roomRef);
    }
  } catch {
    // read/delete denied or offline — ignore
  }
}
