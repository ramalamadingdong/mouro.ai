# `database.rules.json` — what it enforces and why

Evaluated by the mouro.ai realtime server (`../../server`) on every read and
write; it ships with the server. Rules files cannot hold comments, so the
reasoning lives here. `npm test --prefix ../../server` ("dots rules")
exercises this file against a live server.

The room, seat, meta and presence rules are **Hold'em's, unchanged**, which
are yahtzee's — `../yahtzee/RULES.md` explains them at length, in particular:
**`.write` cascades downward and `.validate` does not run on ancestors or on
deletes**, so every grant restates its node's complete shape, and every node a
non-host can write is a scalar. Only `state` differs.

## Schema

```
rooms/<CODE>/                 CODE = ^[A-HJKMNP-Z2-9]{5}$
  meta/      { host, status: 'waiting'|'playing', createdAt, updatedAt }
  seats/<uid>     "<joinedAt>|<name>"
  presence/<uid>  <last-seen ms>          exists = connected
  state/
    version, phase ('playing'|'gameover'), starter, gameNo
    config/   { cols, rows }              1..8 each
    players/<0..3>/ { uid, name, isHuman, sitOut }
    edges     string of '.' or seat digit, one per line (≤ 144)
    boxes     string of '.' or seat digit, one per box  (≤ 64)
    toAct     seat on turn — ABSENT when the game is over
    turnUid   players[toAct].uid, or '*'
    lastMove/ { by, kind: start|line|away|rematch, seat, edge?, closed? }
```

## `state` — who may write

All in the `.write`, so a deep write cannot dodge them:

1. **Shape**: the required children are present; `version` 1..1,000,000.
2. **Turn consistency** in the new state: `turnUid === '*'` with no `toAct`,
   or `toAct` 0..3 and `turnUid === players[toAct].uid`.
3. **Membership**: the writer is seated or is the host.
4. **Authority**, read from the PRE-write state:
   - no state yet → the **host**, stamping `start`;
   - the writer is on turn (`data.turnUid`) and stamps `line`;
   - nobody is on turn (`'*'`, game over) and any seated player stamps
     `rematch`;
   - somebody else is on turn, **their presence node is absent**, and a
     seated player stamps `away`.
5. **`lastMove.by === auth.uid`**.
6. **`version` strictly increases** — no replay, and a partial deep write
   always fails.

Every child is typed and bounded, and unknown keys are refused.

## What these rules do NOT enforce

| Not enforced | What it means |
|---|---|
| **Dots and Boxes.** | The player on turn can write any well-formed board. The defence is `normalize()` on every other client, which rejects a board where a claimed box is open, a closed box is unclaimed, or a mark names no seat. Drawing two lines at once, or claiming a box for yourself that you closed out of turn, is not detected. Casual play between friends. |
| **What an `away` or `rematch` write changes.** | Rule 4 checks the label, not the diff. |
| **The 30-second grace before `away`.** | The rules see that presence is absent, not for how long. The grace is the honest client's manners. |
| **The 4-player cap.** | Rules cannot count children; `joinRoom()` checks it and `seatOrder` truncates. |
