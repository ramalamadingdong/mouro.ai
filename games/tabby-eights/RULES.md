# `database.rules.json` — what it enforces and why

Evaluated by the mouro.ai realtime server (`../../server`) on every read and
write; it ships with the server. Rules files cannot hold comments, so the
reasoning lives here. `npm test --prefix ../../server` ("tabby-eights rules")
exercises this file against a live server.

The room, seat, meta and presence rules are **Pawprints' (Dots', Hold'em's),
unchanged**, which are yahtzee's — `../yahtzee/RULES.md` explains them at
length, in particular: **`.write` cascades downward and `.validate` does not
run on ancestors or on deletes**, so every grant restates its node's complete
shape, and every node a non-host can write is a scalar. Only `state` differs.

## Schema

```
rooms/<CODE>/                 CODE = ^[A-HJKMNP-Z2-9]{5}$
  meta/      { host, status: 'waiting'|'playing', createdAt, updatedAt }
  seats/<uid>     "<joinedAt>|<name>"
  presence/<uid>  <last-seen ms>          exists = connected
  state/
    version, phase ('playing'|'roundover'|'gameover'), starter, round, gameNo
    config/   { target }                  1..500 points
    players/<0..3>/ { uid, name, isHuman, sitOut, hand?, score }
                hand: cards run together, ≤ 104 chars; score 0..100000
    stock?    cards run together, ≤ 104 chars
    pile      cards run together, 2..104 chars (the top card is last)
    suit      ^[fymb]$  — the suit to follow
    drew      boolean   — the player on turn has drawn this turn
    passes    0..4
    toAct     seat on turn — ABSENT between rounds and when the game is over
    turnUid   players[toAct].uid, or '*'
    lastMove/ { by, kind: start|play|draw|pass|away|deal|rematch, seat, card?, suit? }
```

A card is a suit letter (`f` fish, `y` yarn, `m` mice, `b` bells) and a rank
letter (`A 2-9 T J Q K`); every card string matches `^([fymb][A2-9TJQK])*$`.
`hand` and `stock` are optional because they are often empty.

## `state` — who may write

All in the `.write`, so a deep write cannot dodge them:

1. **Shape**: the required children are present; `version` 1..1,000,000.
2. **Turn consistency** in the new state: `turnUid === '*'` with no `toAct`,
   or `toAct` 0..3 and `turnUid === players[toAct].uid`.
3. **Fixed table**: once the state exists, the four seat uids and the target
   never change.
4. **Membership**: the writer is seated or is the host.
5. **Authority**, read from the PRE-write state:
   - no state yet → the **host**, stamping `start`;
   - the writer is on turn (`data.turnUid`) and stamps `play`, `draw` or
     `pass`;
   - nobody is on turn (`'*'`): in `roundover` any seated player stamps
     `deal`; in `gameover` any seated player stamps `rematch`;
   - somebody else is on turn, **their presence node is absent**, and a
     seated player stamps `away`.
6. **A `draw` keeps the turn** (`toAct` unchanged): you draw, then play or
   pass.
7. **`lastMove.by === auth.uid`**.
8. **`version` strictly increases** — no replay, and a partial deep write
   always fails.

Every child is typed and bounded, and unknown keys are refused.

## What these rules do NOT enforce

| Not enforced | What it means |
|---|---|
| **Hidden cards.** | Every seated player can read every hand and the stock. Each client only draws its own hand face up. A modified client could peek. Same trade as Hold'em: casual play between friends, no money, and hiding cards properly needs server-side dealing. |
| **Crazy eights.** | The player on turn can write any well-formed state. The defence is `normalize()` on every other client, which refuses a state where any of the 52 cards is missing or doubled, the suit to follow does not match a non-eight top card, a finished round has nobody out, or the scores disagree with the phase. Playing a card that does not match the pile is not detected. |
| **What an `away`, `deal` or `rematch` write changes.** | Rules check the label, not the diff. |
| **The 30-second grace before `away`.** | The rules see that presence is absent, not for how long. The grace is the honest client's manners. |
| **The 4-player cap.** | Rules cannot count children; `joinRoom()` checks it and `seatOrder` truncates. |
