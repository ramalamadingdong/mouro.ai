/**
 * Room lifecycle + move submission against Realtime Database. Every write here
 * is shaped to satisfy firebase/database.rules.json exactly — a write that
 * violates the rules is rejected at runtime.
 *
 * Data model (rooms/<CODE>):
 *   meta:     { host, hostName, guest?, guestName?, status, createdAt, updatedAt,
 *               target? }  // target = host-chosen winning score; read at deal.
 *   presence: { <uid>: { online, lastSeen } }
 *   state:    <GameState>   // written whole via transaction; ABSENT until dealt
 *   rematch:  { <uid>: true }
 *   backs:    { <uid>: "data:image/jpeg;base64,…" }  // each player's card-back
 *             photo, so the OPPONENT sees it on our face-down cards. Cosmetic,
 *             kept OUT of `state` so it never bloats the per-move transaction.
 *   emotes:   { <uid>: { emoji, n } }  // latest reaction each player sent; `n`
 *             bumps per send so the peer re-pops the same emoji. Ephemeral, kept
 *             OUT of `state` (like backs) so it never touches the move transaction.
 *
 * Separate analytics archive (matches/<matchId>), OUTSIDE rooms/ so it survives
 * the 24h room reaper (see matchIdFor):
 *   meta:     { code, createdAt, startedAt }
 *   players:  { p0: <uid>, p1: <uid> }
 *   initial:  <GameState>            // the round-1 deal (version 0)
 *   log:      { <version>: { seat, move } }  // every accepted move, in order
 * `initial` + the ordered `log` deterministically replays the whole match
 * offline (scripts/analytics/extract-features.ts) to mine per-player strategy.
 */
import {
  get,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { applyMove, initialMatchState, normalize } from '@/engine';
import type { GameState, Move } from '@/engine/types';
import { getCurrentUid } from '@/fb/auth';
import { db } from '@/fb/firebase';
import { randomRoomCode, randomSeed } from '@/util/seed';

export interface RoomMeta {
  host: string;
  hostName: string;
  guest?: string;
  guestName?: string;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  updatedAt: number;
  /** Host-chosen winning score. Absent → engine default (100). Read at deal. */
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

export interface RoomSnapshot {
  code: string;
  meta: RoomMeta;
  state: GameState | null;
  presence: Record<string, PresenceEntry>;
  rematch: Record<string, boolean>;
  /** Per-uid custom card-back photo (`data:` URI). Missing → default lattice. */
  backs: Record<string, string>;
  /** Per-uid latest reaction, for the floating emote pops. */
  emotes: Record<string, EmoteEntry>;
}

const DAY_MS = 86400000;

/**
 * Stable archive id for a match at `matches/<matchId>`. Room codes are recycled
 * (the 24h reaper + create-collision sweep free them), so the code alone is not
 * unique across time — we pair it with the room's immutable `createdAt` so a
 * later game that reuses the code writes to a DISTINCT match node. Both the
 * dealer (startRoundIfNeeded) and every mover (submitMove) derive the same id
 * from data they already hold, so no extra read or stored pointer is needed.
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
 * clears a stale room and retries with a new code (max 5 attempts). Returns the
 * room code.
 *
 * NOTE: we deliberately do NOT arm an onDisconnect().remove() on the waiting
 * room. On mobile the RTDB socket drops on any brief background (e.g. the OS
 * Share sheet that pops up to send the code!) or network blip, which would fire
 * onDisconnect and delete a perfectly good room out from under the host — the
 * guest then sees "Room not found". Abandoned rooms are instead reaped by the
 * 24h stale-cleanup rule and the create-collision sweep (deleteRoomIfStale).
 */
export async function createRoom(hostName: string): Promise<string> {
  const uid = getCurrentUid();
  if (!uid) throw new Error('Not authenticated');

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomRoomCode();
    const roomRef = ref(db, `rooms/${code}`);
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
      { applyLocally: false }
    );

    if (result.committed) {
      return code;
    }

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
 * (or a claim after the host has dealt) is denied. That makes a plain update()
 * both correct and race-safe (verified against the live database).
 */
export async function joinRoom(code: string, guestName: string): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) throw new Error('Not authenticated');

  const metaRef = ref(db, `rooms/${code}/meta`);

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
    // Lost the race: another player grabbed the seat, or the host just dealt.
    if (isPermissionDenied(err)) {
      throw new Error('Could not join — the room just filled up or the game started.');
    }
    throw err;
  }
}

/**
 * Live subscription to a room. Normalizes the raw state child (repairing RTDB
 * pruning) and defaults missing presence/rematch to {}. Calls back with null if
 * the room is gone. Returns an unsubscribe function.
 */
export function subscribeRoom(
  code: string,
  cb: (room: RoomSnapshot | null) => void
): () => void {
  const roomRef = ref(db, `rooms/${code}`);
  return onValue(
    roomRef,
    (snap) => {
      const val = snap.val() as
        | {
            meta?: RoomMeta;
            state?: unknown;
            presence?: Record<string, PresenceEntry>;
            rematch?: Record<string, boolean>;
            backs?: Record<string, string>;
            emotes?: Record<string, EmoteEntry>;
          }
        | null;
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
        backs: val.backs ?? {},
        emotes: val.emotes ?? {},
      });
    },
    () => {
      // Read denied/cancelled (e.g. resuming into a room that is now
      // 'playing'/'finished' where we are not a member). Report the room as
      // unavailable rather than freezing on a stale snapshot.
      cb(null);
    }
  );
}

/**
 * Submit a move via a transaction on rooms/<code>/state. Normalizes the current
 * value, runs the pure reducer, and writes the new state (or aborts). On success
 * bumps meta/updatedAt. Returns {ok} rather than throwing so callers can surface
 * rejection reasons.
 *
 * When `matchId` is supplied the accepted move is also appended (best-effort) to
 * `matches/<matchId>/log/<version>` for offline replay/analysis. The key is the
 * NEW state version, which makes the write idempotent (a retried move maps to
 * the same key and the append-only rule denies the overwrite) and gives the
 * extractor a strictly-ordered, gap-detectable stream. Archiving never blocks or
 * fails a move: a denied/offline log write is swallowed.
 */
export async function submitMove(
  code: string,
  move: Move,
  matchId?: string
): Promise<{ ok: boolean; error?: string }> {
  const uid = getCurrentUid();
  if (!uid) return { ok: false, error: 'Not authenticated' };

  const stateRef = ref(db, `rooms/${code}/state`);
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
      { applyLocally: false }
    );

    if (!result.committed) {
      return { ok: false, error: moveError ?? 'Move rejected' };
    }

    // Fire-and-forget bookkeeping: freshen updatedAt now that play is underway.
    update(ref(db, `rooms/${code}/meta`), {
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    // Fire-and-forget analytics: archive the move keyed by the resulting version.
    // The committed state carries the new version and the acting seat (lastMove),
    // so the log entry is a compact { seat, move } — the seed for a nextRound /
    // rematch rides inside `move`, keeping every round deterministically replayable.
    if (matchId) {
      const committed = result.snapshot.val() as GameState | null;
      const version = committed?.version;
      const seat = committed?.lastMove?.seat;
      if (typeof version === 'number' && seat) {
        set(ref(db, `matches/${matchId}/log/${version}`), { seat, move }).catch(() => {});
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'Move failed' };
  }
}

/**
 * Host-only: when a guest is present and no state exists yet, deal round 1 into
 * rooms/<code>/state (create-if-null transaction) and flip meta.status to
 * 'playing'. No-op for the guest or once dealt.
 *
 * The first state write must satisfy the rule `lastMove/by === auth.uid`, so we
 * stamp an initial lastMove attributed to the host (lastMove is a UI heuristic
 * only and never feeds game logic).
 */
export async function startRoundIfNeeded(
  code: string,
  room: RoomSnapshot
): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;

  const { meta, state } = room;
  if (meta.host !== uid) return; // only the host deals
  if (!meta.guest) return; // need a guest first
  if (state) return; // already dealt

  const dealt = initialMatchState({
    hostUid: meta.host,
    guestUid: meta.guest,
    hostName: meta.hostName,
    guestName: meta.guestName ?? 'Guest',
    seed: randomSeed(),
    // Host's chosen winning score; initialMatchState falls back to 100 if unset.
    target: meta.target,
  });
  const initial: GameState = {
    ...dealt,
    lastMove: { by: uid, seat: 'p0', kind: 'nextRound', at: Date.now() },
  };

  const stateRef = ref(db, `rooms/${code}/state`);
  const result = await runTransaction(
    stateRef,
    (cur) => {
      if (cur !== null) return; // someone already dealt
      return initial;
    },
    { applyLocally: false }
  );

  if (result.committed) {
    await update(ref(db, `rooms/${code}/meta`), {
      status: 'playing',
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    // Fire-and-forget analytics: open the replay archive for this match. We write
    // the round-1 deal as `initial` and the seat->uid map as `players` (the log's
    // append rule checks the latter). Subsequent rounds arrive as nextRound/rematch
    // moves in the log, so `initial` + the move stream replays the whole match.
    // Best-effort: a denied/offline write just means this game goes uncaptured.
    const matchId = matchIdFor(code, meta.createdAt);
    update(ref(db, `matches/${matchId}`), {
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

  await set(ref(db, `rooms/${code}/rematch/${uid}`), true);

  const metaSnap = await get(ref(db, `rooms/${code}/meta`));
  const meta = metaSnap.val() as RoomMeta | null;
  if (!meta || !meta.guest) return;

  const votesSnap = await get(ref(db, `rooms/${code}/rematch`));
  const votes = (votesSnap.val() ?? {}) as Record<string, boolean>;
  if (votes[meta.host] && votes[meta.guest]) {
    // Pass matchId so the rematch (a fresh deal carrying its own seed) is logged
    // too, keeping the archived move stream complete across rematches.
    await submitMove(code, { kind: 'rematch', seed: randomSeed() }, matchIdFor(code, meta.createdAt));
  }
}

/**
 * Publish this device's custom card-back to rooms/<code>/backs/<uid> so the
 * OPPONENT renders it on our face-down cards. Only self-contained `data:` URIs
 * are synced — a device-local file path (the rare picker fallback) would be
 * meaningless on the peer, so those (and null) clear the node instead. Cosmetic
 * and fire-and-forget: if the write is denied (rules not yet deployed) or the
 * device is offline, we simply fall back to the default back on the other side.
 */
export async function setMyCardBack(code: string, uri: string | null): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  const backRef = ref(db, `rooms/${code}/backs/${uid}`);
  const shareable = uri && uri.startsWith('data:') ? uri : null;
  try {
    if (shareable) await set(backRef, shareable);
    else await remove(backRef);
  } catch {
    // permission denied / offline — cosmetic only, ignore.
  }
}

/**
 * Host-only: set the match winning score before the round is dealt. Writes
 * meta/target (and freshens updatedAt). The security rules permit only a member
 * to write meta and bound the value; a non-host or an out-of-range value is
 * rejected. Best-effort — a denied write (e.g. rules not yet deployed) is
 * swallowed and the deal falls back to the default target.
 */
export async function setRoomTarget(code: string, target: number): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  try {
    await update(ref(db, `rooms/${code}/meta`), {
      target,
      updatedAt: Date.now(),
    });
  } catch {
    // permission denied / offline — falls back to the default target at deal.
  }
}

/**
 * Broadcast a reaction to the room: write emotes/<uid> = { emoji, n } so the
 * OPPONENT's client re-pops it (n bumps each send to retrigger an identical
 * emoji). Ephemeral and fire-and-forget — a denied write (rules not yet
 * deployed) or an offline device simply drops the reaction.
 */
export async function sendEmote(code: string, emoji: string): Promise<void> {
  const uid = getCurrentUid();
  if (!uid) return;
  try {
    await set(ref(db, `rooms/${code}/emotes/${uid}`), { emoji, n: Date.now() });
  } catch {
    // permission denied / offline — reactions are cosmetic, ignore.
  }
}

/**
 * Opportunistic cleanup: delete the room if its last update is older than a day.
 * Read/delete may be denied for a non-member on a non-waiting room — that's fine,
 * it's swallowed.
 */
export async function deleteRoomIfStale(code: string): Promise<void> {
  try {
    const roomRef = ref(db, `rooms/${code}`);
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
