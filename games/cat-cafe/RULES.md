# `database.rules.json` — what it enforces and why

Evaluated by the mouro.ai realtime server (`../../server`) on every read and
write; it ships with the server. Rules files cannot hold comments, so the
reasoning lives here. `npm test --prefix ../../server` ("cat-cafe rules")
exercises this file against a live server.

The room, seat, meta and presence rules are **Dots and Boxes's, unchanged**,
which are Hold'em's and yahtzee's — `../yahtzee/RULES.md` explains them at length, in particular:
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
    picks     0..48, picks made this game (round and turn derive from it)
    players/<0..3>/ { uid, name, isHuman, sitOut }
    market    the door: 2 chars per slot, tile ([gstw][0-9]) or '..' (8–12 chars)
    floors/<0..3>   5 chars per seated cat: tile + orientation + x + y (≤ 60)
                    ABSENT while that floor is empty
    toAct     seat on turn — ABSENT when the game is over
    turnUid   players[toAct].uid, or '*'
    lastMove/ { by, kind: start|seat|pass|away|rematch, seat, tile?, cat? }
```

## `state` — who may write

All in the `.write`, so a deep write cannot dodge them:

1. **Shape**: the required children are present; `version` 1..1,000,000.
2. **Turn consistency** in the new state: `turnUid === '*'` with no `toAct`,
   or `toAct` 0..3 and `turnUid === players[toAct].uid`.
3. **Membership**: the writer is seated or is the host.
4. **Authority**, read from the PRE-write state:
   - no state yet → the **host**, stamping `start`;
   - the writer is on turn (`data.turnUid`) and stamps `seat` or `pass`;
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
| **Cat Café.** | The player on turn can write any well-formed state. The defence is `normalize()` on every other client, which rejects cats that overlap or leave the floor, more cats than turns, a door that does not match the pick count, and a phase or turn that disagrees with `picks`. Editing your own earlier cats, or taking a cat that was not at the door, is not detected. Casual play between friends. |
| **Which cats come to the door.** | Whoever ends a round draws the next cats on their own device. A modified client could choose them. |
| **What an `away` or `rematch` write changes.** | Rule 4 checks the label, not the diff. |
| **The 30-second grace before `away`.** | The rules see that presence is absent, not for how long. The grace is the honest client's manners. |
| **The 4-player cap.** | Rules cannot count children; `joinRoom()` checks it and `seatOrder` truncates. |
