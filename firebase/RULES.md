# `database.rules.json` — what it enforces and why

RTDB rules files reject `//` comments, so the reasoning lives here. This file is
the **only server-side enforcement in the product**. There are no Cloud
Functions (Spark plan), so anything not expressed in the rules is trusted to the
client.

Deploy with `firebase deploy --only database`. There is no emulator run in this
project, so read changes critically before shipping — a broken rule fails
denied-everywhere and looks like a bug in the app.

---

## The one fact that makes these rules readable

**`.write` cascades downward and grants everything below it. `.validate` does
not run on ancestors, and does not run at all on a delete.**

Consequences, all of which have bitten this file:

1. A write aimed at `rooms/X/presence/me/online/whatever` is evaluated against
   the `.write` rules on that path **and its ancestors**, but against `.validate`
   only **at that node and below**. Every `.validate` on `presence/$uid`,
   `presence`, `rooms/$code` — the ones carrying the length caps, the shape
   checks and `$other: false` — is skipped entirely. Under the previous rules
   that subtree had no applicable constraint at all, so
   `set('rooms/X/presence/<uid>/online/junk', <10MB>)` was accepted.
2. Any cap expressed as a `.validate` is bypassable by writing one level deeper
   than the cap. The previous version of this document claimed `holds` was
   "bounded hard". **That was never true.**
3. `.validate` is skipped for `null`, so **any leaf can be deleted regardless of
   its validate**. Deleting `meta/createdAt` used to disarm the 24h reaper
   permanently: the stale clause needs both timestamps to be numbers, and a room
   missing one can never satisfy it, so the room and its code leaked forever.
4. A *stricter* rule on a child of a granted node is dead weight — the ancestor
   already allowed the write.

**Therefore: every node's authorization AND its complete shape are asserted
inside the `.write` that grants it.** `newData.isNumber()`, `hasChildren([...])`,
`isBoolean()` and the `$code` regex are restated in each `.write`, not delegated
to a `.validate`. This is what makes a deep write unsatisfiable: writing a child
of `holds/$uid` makes that node an object, and the `.write` at `holds/$uid`
demands `newData.isNumber()`. There is no path to a rule-free subtree.

The `.validate` rules that remain are a second layer for ordinary well-formed
writes, plus `$deep: { ".validate": false }` on each leaf as belt-and-braces
against a deep write the `.write` layer somehow admits.

### Other rule-engine facts relied on here

- `root` and `data` are the **pre-write** database; `newData` is post-write,
  merged with untouched siblings. A multi-path `update()` is evaluated **per
  leaf path** against the *same* pre-write `root` — which is why a joiner
  writing `seats/<self>` and `meta/updatedAt` in one call is still "unseated" as
  far as the `meta/updatedAt` rule can see.
- **Rules cannot count children.** There is no way to say "at most 4 seats".
- `now` is server time in ms. `serverTimestamp()` is resolved before rules run,
  so `newData.isNumber()` holds for it.

---

## `rooms/$code`

`$code` is `^[A-HJKMNP-Z2-9]{5}$` — the alphabet from `src/util/seed.ts` with
`0 O 1 I L` removed. **The regex is repeated in the `.write` of every node a
client writes directly** (`meta/status`, `meta/updatedAt`, `seats/$uid`,
`presence/$uid`, `holds/$uid`, `rematch/$uid`) because the ancestor `.validate`
on `rooms/$code` does not run for writes below it. Without that repetition a
deep write conjures a room under a malformed key, which no rule can delete.

### `.read`

Granted to a seated player, the host, **anyone while `meta.status ===
'waiting'`**, and — critically — **when the room does not exist**.

That last clause is not a nicety. Without it, reading a nonexistent room returns
`PERMISSION_DENIED` rather than `null`, and the client physically cannot tell
"no such room" from "not allowed" — so "Room not found. Check the code." becomes
unwritable and every typo surfaces as a security error. `joinRoom()` depends on
exactly this to phrase its two different failures.

### `.write` — whole-room create and whole-room delete, nothing else

- **Create** (`!data.exists()`): the code must match the regex, you must name
  yourself host, `meta` must carry all four of `host / status / createdAt /
  updatedAt`, and the new room **must not contain `state`, `presence`, `holds`
  or `rematch`**. Those exclusions matter because this grant cascades over the
  whole room: without them a creator could install a hand-authored game state
  that bypasses every check in the `state` rule, or pre-seed cosmetic nodes for
  other uids. `createRoom()` writes exactly `meta` + its own seat, so nothing
  legitimate is lost. (`seats` is not excluded — `seats/$uid`'s own validate
  requires `$uid === auth.uid`, so a creator still cannot fabricate other
  participants, and participants can read the room.)
- **Delete** (`!newData.exists()`): by **the host**, or by **anyone once both
  `meta.createdAt` and `meta.updatedAt` are more than 24h old**.

  The delete clause previously read `host || seats.hasChild(auth.uid) ||
  stale`, which let anyone who obtained a shared code join a lobby and then
  destroy the live game for everyone once it started.

That stale clause is the **entire garbage collector**. There is no cron and no
Cloud Function.

**The reaper does not read the room first, and must not.** A non-participant may
only read a room that is *missing* or *`waiting`*, so an abandoned **`playing`**
room denies the read — and the old "get meta, then decide" version bailed there
and never attempted the delete, even though the stale clause needs no read at
all. `deleteRoomIfStale()` now fires the delete unconditionally and swallows the
denial; the rule re-checks both timestamps and is the sole arbiter of staleness.

**The client must actually call it.** It used to be called only on a
create-collision, which against 28.6M codes essentially never happens — the
collector was decorative and rooms accumulated forever. It is now also called
when a room the user opens decodes as stale (`joinRoom`, and the bound-room
snapshot handler in `gameStore`) and on `leaveRoom`. All best-effort, none
blocking, no timers or polling.

### `meta`

There is **no `.write` on `meta` itself**. `host` and `createdAt` are therefore
writable only as part of a whole-room create or delete; there is no grant that
reaches them otherwise. `status` and `updatedAt` each carry their own narrow
grant.

- `host` — immutable (`newData.val() === data.val()`), and unreachable by any
  leaf-level grant. Both matter: validate is skipped on a delete, so a grant
  that reached this leaf would let a guest delete `meta/host` and re-claim it
  (validate passes when `!data.exists()`), promoting themselves to host.
- `createdAt` — immutable once set; on create it must be within ±24h of `now`,
  so a creator cannot pre-age a room into instant reapability or push it out of
  the reaper's reach. It is half the staleness clock.
- `status` — **a two-state machine, host-only, one-way.** Its `.write` admits
  exactly one transition: `waiting → playing`, by the host, on an existing
  value. Creation as `waiting` comes through the room-level create grant.

  Previously a seated player could set a live game back to `waiting`. That is
  not cosmetic: it reopens `seats/$uid` to arbitrary joiners *and* re-arms the
  `.read` rule's `waiting` disjunct, making an in-progress room world-readable.
  `finished` is gone from the enum and from `RoomMeta`; nothing ever wrote it,
  and an unreachable third value is pure attack surface.
- `updatedAt` — its own **looser** grant: any authenticated user may bump it
  while the room is `waiting`, and a participant or the host may bump it at any
  time. The loose case exists because a joiner writes `seats/<self>` and
  `meta/updatedAt` in one `update()`, and at that instant `root` still shows
  them unseated. It requires the `$code` regex, `meta.exists()` and
  `newData.isNumber()` in the `.write`, so it cannot conjure a room or a
  non-numeric node, and the validate bounds it to `now ± 24h`.

`$other: false` on `meta` refuses unknown keys for ordinary writes.

### `seats/$uid`

- Writable **only by `$uid`**. Creating or changing a seat additionally requires
  `meta` to exist, `status === 'waiting'`, and the complete `{ name, joinedAt }`
  shape with `name` a non-empty string ≤ 24 chars — all asserted in the
  `.write`, so no deeper write can dodge them.
- **Deleting your own seat is unconditional**, at any point in the game. That is
  deliberate: it is what lets `leaveRoom()` clean up mid-match. The dealt
  `state` holds its own copy of the player list, so leaving does not disturb the
  game — it only gives up the leaver's write access.

### `state` — the heart of it

All of these must hold:

1. **Shape.** `hasChildren(['version','players','phase','turn','turnUid',
   'round','rollsUsed'])`, in the `.write`, so a deep write into `state` (which
   would leave those siblings intact but is aimed below them) is still
   evaluated against the full requirement at this node.
2. **Denormalization consistency.**
   `newData.turnUid === newData.players[newData.turn].uid`. The engine derives
   `turnUid` in `commit()`; this stops a client shipping a state whose
   denormalized field disagrees with its own player table, which is what the
   *next* writer's authorization is read from.
3. **Participant.** Seated, or the host.
4. **Authority.** First write is host-only. Afterwards the writer must be
   `data.turnUid` — read from the **pre-write** state, so a client cannot
   authorize itself by rewriting the field — **or** the game must be `over` and
   the write must be a genuine rematch: `lastMove.kind === 'rematch'`,
   `round === 1`, `rollsUsed === 0`, no `result`. That last set of conditions is
   what stops "the game is over" from being a general-purpose write window.
5. **`newData.lastMove.by === auth.uid`** — you cannot write a state claiming
   somebody else moved. This holds on the create branch too, with one narrow
   exemption: `initialGameState()` sets `lastMove: null` and RTDB prunes nulls,
   so a state with **no** `lastMove` must stay writable or dealing is
   impossible. Present-but-forged is refused. (`startGame()` stamps a real
   `lastMove` attributed to the host, so the honest path never needs the
   exemption.)
6. **`newData.version > data.version`** — strictly monotonic. Blocks both
   rollback and replay, and is what makes the `runTransaction` retry loop
   correct: the loser of a race fails the rule, re-reads and re-applies.

Every child is named and bounded, and `state` is closed with `$other: false`:
`version >= 0`; `turnUid` a string ≤ 128; `phase` one of three literals; `turn`
0..3; `round` 1..14 (14 is terminal, `RULES.ROUNDS + 1`); `rollsUsed` 0..3;
`dice/$i` key 0..4 with a value 1..6; `players/$seat` key 0..3 with `uid` ≤ 128
and `name` ≤ 24 (**the same cap `seats/$uid/name` enforces** — names were once
capped at the door and uncapped once copied into `state`); `cards/$seat/$category`
a known category name with a value 0..50 (a Yahtzee is 50, and `0` is a legal
*used* box); `yahtzeeBonus/$seat` 0..13; `result.scores` / `result.winners`;
`lastMove` with `by`, `kind`, `seat`, `at`, and optional `category` / `points`.

Nodes RTDB **prunes** are deliberately absent from `hasChildren`: a fresh game
has `dice: []`, an all-null `cards` and `result: null`, all of which vanish on
the wire. Requiring them would make a new game unwritable.

These are bounds on *size and shape*, never on legality. See the gaps table.

### `presence/$uid`, `holds/$uid`, `rematch/$uid`

All three carry the entire test in `.write`, and every conjunct is load-bearing:

```
auth != null && auth.uid === $uid
  && $code.matches(/^[A-HJKMNP-Z2-9]{5}$/)
  && ( !newData.exists()                       // unconditional self-cleanup
       || (   root...child($code).child('meta').exists()
           && (seats.hasChild($uid) || meta/host === $uid)
           && <the node's complete shape>) )
```

The membership test used to sit in `.validate`, where a write to a *child* path
never evaluated it — see the top of this file. The `$code` regex and
`meta.exists()` are repeated here for the same reason: without them these nodes
could **materialise `rooms/<arbitrary key>` with no `meta` at all**, which
permanently burned that code (`createRoom`'s transaction aborts on any non-null
value, and the stale-delete clause needs `meta` timestamps that never existed).

The `!newData.exists()` disjunct is new: it lets a player drop their own
cosmetic nodes even after they have stopped being a member. `leaveRoom()`
nonetheless deletes presence/holds/rematch **before** `seats/<uid>`, because
under the membership-first form that ordering was the difference between a
lobby leaver being cleaned up and being stranded as `online: true` forever.

- `presence`: exactly `{ online: boolean, lastSeen: number }`. `onDisconnect`
  handlers are evaluated at disconnect time under the same auth, so they satisfy
  the same rule; if the room was deleted first the queued write simply fails,
  which is the desired outcome.

  A membership race made this worse than it looked: presence is announced on the
  `.info/connected` edge, which on a join fires before `seats/<uid>` lands, so
  the announce was denied and **never retried** — the player showed offline for
  the whole session, not "briefly". `gameStore` now re-announces the first time
  a snapshot shows us as a member.

- `holds`: **ONE NUMBER, 0..31** — a bitmask, bit *i* meaning die *i* is held.
  It is not an array, and cannot be: an array's element rules are ancestors of
  any deeper write, so nothing about an array node can be bounded (the old
  `holds` was `^[0-4]$`-keyed with enumerated values and was bypassable by
  writing one level down). `newData.isNumber() && val >= 0 && val <= 31` is
  unsatisfiable for a deep write, because writing a child makes the node an
  object.

  The app still speaks `number[]` internally; `src/util/holds.ts` encodes and
  decodes at the Firebase boundary only. A side benefit: "no dice held" was an
  empty array, which RTDB prunes to `null` — a *delete*, indistinguishable from
  "never published". As a mask it is the number `0`, which stores cleanly, and
  an entire empty-vs-absent ambiguity leaves the wire format.

  The rules still cannot require an *integer* (`4.5` passes a numeric range
  test), so `maskToHolds` truncates, refuses negatives and ignores bits ≥ 5.

- `rematch`: must be literally `true`. A vote is a tombstone; there is no "no"
  vote. It gets the full treatment **even though it is currently a leaf** and so
  happens to be safe today — relying on "nobody can write below it" is exactly
  the fragility that produced the presence/holds hole.

`$other: false` at the room level refuses any node not named above.

---

## `matches/` — removed

There used to be an analytics archive at `matches/$mid`. It is gone, from the
rules and from `src/fb/rooms.ts` (`matchIdFor`, `openArchive`, `appendToLog`).
Nothing read it, and it was not fixable in place:

- **Squattable.** `$mid` was `matchIdFor(code, createdAt)`, and both halves are
  visible to anyone who can read a `waiting` room — which is everyone with the
  code. Worse, authorization was self-asserted: the write rules looked for the
  caller's uid under `players` via `newData.parent()`, i.e. **inside the very
  payload being written**. Write a `players` naming yourself, and every check
  passed.
- **Undeletable.** Every child required `!data.exists()`, which a delete also
  fails. Nothing — no client, no rule — could ever remove an entry.
- **Unreadable.** `.read: false` globally, with no service-account reader in the
  repo and no admin script written.
- **Unbounded.** Write-only, undeletable, and outside the 24h room reaper by
  design: a storage-exhaustion vector against a free Spark project.

**Replay analytics remains entirely possible without it.** The engine keeps
every seed inside the move that consumes it (`{ kind: 'roll', keep, seed }`), so
a game is fully reconstructible from *initial state + ordered move log*.

Re-adding it means, at minimum: a key derived from something **unguessable**
(not from data any reader of the room already has); authorization read from
`root` (`rooms/$code/seats`) and never from the payload; the archive's own
`.write` asserting the complete shape of each node, as everything else here now
does; deletion permitted and a reaper that reaches it; a bound on entry size and
count; and a reader that actually exists before the first byte is written. It
should be designed against those five points, not resurrected.

---

## What these rules do NOT enforce

| Not enforced | Why, and what it means in practice |
|---|---|
| **The 4-player cap.** | Rules cannot count children, so `RULES.MAX_PLAYERS` is a client-side check in `joinRoom()` only. A determined caller can seat a fifth player; `normalize()` then rejects the resulting state and the room is unusable. Denial of service against a room you were invited to, not an exploit. |
| **Turn ROTATION.** | The rules check that the writer is the *pre-write* `turnUid` and that `turnUid` agrees with `players[turn]` — but `turn` is attacker-chosen data in the payload. Nothing forces it to advance. **The player on turn can keep the turn forever**, or hand it to whomever they like. The engine rotates correctly; the server cannot tell whether it was consulted. |
| **Scorecard arithmetic.** | A player legitimately on turn can write any cards, any totals, any winner. Bounds (0..50 per box, 0..2000 per total) limit the *size*, not the *truth*. The real defence is that every client runs `normalize()`, which re-derives the breakdown from the cards and rejects a state whose totals or per-seat filled-box count do not reconcile. **Cheating is detectable by the opponent's client, not preventable by the server.** |
| **Confidentiality of a `waiting` room.** | Any authenticated user who has — or **guesses** — the 5-character code can read the entire room while `status === 'waiting'`: every player's name, and **any `state` already dealt**. `startGame()` deals before flipping the status, so that window is real, if short. 28.6M codes is a lock against casual guessing, not against a determined enumerator on an unrate-limited read. |
| **Rate limiting.** | Not expressible in RTDB rules. Spark-plan quota is the only backstop. |
| **`meta/updatedAt` honesty.** | Anyone may bump it on a `waiting` room, and the validate accepts up to `now + 24h`. Worst case is a room outliving its expiry — the reaper needs *both* timestamps old, so an attacker can keep a room alive but cannot delete a live one early. |
| **Host abandonment.** | The host may delete their room at any time, including mid-game. This is what makes a lobby closable; the cost is that a host can end a game for everyone. A non-host stuck in an abandoned room waits out the 24h reaper. |
