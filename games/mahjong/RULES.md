# `database.rules.json` — what it enforces and why

Evaluated by the mouro.ai realtime server (`../../server`) on every read and
write; it ships with the server. Rules files cannot hold comments, so the
reasoning lives here. `npm test --prefix ../../server` ("mahjong rules")
exercises this file against a live server.

The room, seat, meta and presence rules are **Dots and Boxes' (and Hold'em's), unchanged**, which
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
    version, phase ('turn'|'claim'|'scored'|'gameover'), dealer, wind, handNo, gameNo
    config/   { minFaan 0..10, rounds 1..4 }
    players/<0..3>/ { uid, name, isHuman, sitOut, score,
                      hand ≤14, melds ≤24, flowers ≤8, discards ≤40 }   tile strings
    wall      tile string ≤ 144            drawn  '' or one tile
    via       'draw'|'kong'|'claim'
    toAct     seat on turn — ABSENT unless phase is 'turn'
    turnUid   players[toAct].uid, or '*'
    claim/    { tile, from, rob, asks: 4 chars of . ? x w k p l m h }   only in 'claim'
    result/   { winner -1..3, from -1..3, faan, lines, pay "a,b,c,d" }  only between hands
    lastMove/ { by, kind: start|discard|kong|win|claim|away|next|rematch, seat, event?, eventSeat?, tile? }
```

Tiles are the characters `a`–`z`, `A`–`P` (see `src/engine/tiles.ts`); melds
add commas. Cats in an online room carry **the host's uid**, so the host's
client is the one that may move for them; no rule needs to know about cats.

## `state` — who may write

All in the `.write`, so a deep write cannot dodge them:

1. **Shape**: the required children are present; `version` 1..1,000,000.
2. **Turn consistency** in the new state: `turnUid === '*'` with no `toAct`,
   or `toAct` 0..3 and `turnUid === players[toAct].uid`.
3. **Membership**: the writer is seated or is the host.
4. **Authority**, read from the PRE-write state:
   - no state yet → the **host**, stamping `start`;
   - the writer is on turn (`data.turnUid`) and stamps `discard`, `kong` or
     `win`;
   - nobody is on turn (`'*'`: a tile on offer, or between hands) and any
     seated player stamps `claim`, `away`, `next` or `rematch`;
   - somebody else is on turn, **their presence node is absent**, and a
     seated player stamps `away`.
5. **`lastMove.by === auth.uid`**.
6. **`version` strictly increases** — no replay, and a partial deep write
   always fails.

Every child is typed and bounded, and unknown keys are refused.

## What these rules do NOT enforce

| Not enforced | What it means |
|---|---|
| **Secrecy.** | Every seated player can read every hand and the wall. Each client simply does not draw what is not its own (same trust model as Hold'em). |
| **Mahjong.** | The player on turn can write any well-formed state. The defence is `normalize()` on every other client, which rejects a state unless all 144 tiles are present exactly once, hand sizes add up and scores sum to zero. Swapping tiles with the wall, or answering a claim for someone else while a tile is on offer, is not detected. Casual play between friends. |
| **Who answers while a tile is on offer.** | With `turnUid === '*'` any seated player may write a `claim`; the reducer refuses a claim for a seat that is not the sender's, but a modified client could ignore that. |
| **What an `away`, `next` or `rematch` write changes.** | Rule 4 checks the label, not the diff. |
| **The 30-second grace before `away`.** | For the player on turn the rules see that presence is absent, not for how long; for a pending claim they see nothing at all. The grace is the honest client's manners. |
| **The 4-player cap.** | Rules cannot count children; `joinRoom()` checks it and `seatOrder` truncates. |
