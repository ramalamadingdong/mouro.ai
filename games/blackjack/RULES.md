# `database.rules.json` — what it enforces and why

Evaluated by the mouro.ai realtime server (`../../server`) on every read and
write; it ships with the server, there is no separate rules deploy. Rules files
cannot hold comments, so the reasoning lives here. `npm test --prefix
../../server` ("blackjack rules") exercises this file against a live server.

The room, seat, meta and presence rules are **Hold'em's, unchanged** (which
are yahtzee's). `../yahtzee/RULES.md` explains them at length — in particular
the one fact everything hangs on: **`.write` cascades downward, `.validate`
does not run on ancestors or on deletes**, so every grant restates its node's
complete shape, and every node a non-host can write is a scalar. Only what
differs is described here. The file was generated from Hold'em's by swapping
the `state` subtree and widening every seat list from 6 to 8.

## Schema

```
rooms/<CODE>/                 CODE = ^[A-HJKMNP-Z2-9]{5}$
  meta/      { host, status: 'waiting'|'playing', createdAt, updatedAt }
  seats/<uid>     "<joinedAt>|<name>"        packed string, written by that uid while 'waiting'
  presence/<uid>  <last-seen ms>             exists = connected; removed by onDisconnect
  state/                                      the engine's GameState, one transaction per move
    version, phase, handNo, house             house may be negative (-10,000,000..10,000,000)
    config/   { startingStack, minBet, maxBet, rounds }
    players/<0..7>/ { uid, name, isHuman, stack, active, sitOut,
                      hands/<0..3>/{ cards/[0..10], bet, done, doubled, split, paid, outcome },
                      lastAction/{kind, amount} }
    shoe/[0..311 cards]   dealer/[0..10 cards]     a card is an integer 0..311 (six decks)
    toAct          seat on turn — ABSENT when nobody is
    turnUid        players[toAct].uid, or '*' when toAct is absent
    result/   { dealerTotal, dealerBlackjack, net/[per seat, may be negative] }
    winner         seat, only in 'gameover'
    lastMove/ { by, kind, seat }
```

Reads: as Hold'em. **A `playing` room is unreadable to outsiders — but every
seated player can read all of `state`, the hole card and the shoe included.**
That is the accepted trust model (see AGENTS.md).

## `state` — who may write

All of these must hold (all in the `.write`, so a deep write cannot dodge them):

1. **Shape**: `version, config, players, phase, turnUid, handNo, house,
   lastMove` present; `version` a number 0..1,000,000.
2. **Turn consistency** in the NEW state: either `turnUid === '*'` and there is
   no `toAct`, or `toAct` is 0..7 and `turnUid === players[toAct].uid`.
3. **Membership**: the writer has a seat in `seats`, or is the host.
4. **Authority**, read from the PRE-write state:
   - no state yet → the **host** only, and the move must be a `deal`;
   - otherwise the writer is `data.turnUid` (**it is their turn**); or
   - the writer is one of `data.players[0..7].uid` and `data.turnUid === '*'`
     and the move is a dealer move (`deal | next | rematch`) — **any seated
     player may be the dealer**; or
   - the writer is one of `data.players[0..7].uid` and the move is a `loan`
     or `repay` — **any seated player may lend or pay back, any time**; or
   - the writer is one of `data.players[0..7].uid`, the move is `away`,
     somebody is on turn, and **`presence/<data.turnUid>` does not exist**.
5. **`lastMove.by === auth.uid`**.
6. **`version` strictly increases**.

Every child of `state` is named, typed and bounded, and unknown keys are
refused. Nodes the wire prunes (`toAct`, `result`, `winner`, `hands`,
`cards`, `dealer`, `outcome`, `lastAction`) are optional.

## What these rules do NOT enforce

| Not enforced | What it means |
|---|---|
| **Secrecy of the hole card and the shoe between seated players.** | By design: client-authoritative. |
| **Blackjack.** | The rules bound shape and authority, never legality. The defence is `normalize()` on every other client, which rejects a state whose chips (with the house's bank) do not add up to `players × startingStack`, or that holds any card twice. Anything subtler (re-ordering the shoe in your favour) is undetectable. Casual play between friends. |
| **What a dealer or `away` write actually changes.** | Rule 4 checks the *label* (`lastMove.kind`), not the diff. |
| **What a `loan`/`repay` write moves.** | Like `next` and `away`, the rules check the label, not the diff: a hostile client could stamp a "loan" that takes chips from someone else. `normalize()` still rejects conjured chips. Casual play between friends. |
| **The 30-second grace before `away`.** | The rules can see that a presence node is absent, not for how long. |
| **The 8-player cap.** | Rules cannot count children; `joinRoom()` checks it. Extra seats are simply not dealt in (`seatOrder` truncates). |
| **Rate limiting, `updatedAt` honesty, host abandonment.** | As in yahtzee: the host can close a waiting room, and a room nobody touches is reaped after 24h. |

## Disconnects, in order of what actually happens

1. A player's socket drops → the server removes `presence/<uid>`. Other tables
   see "Away" on that seat.
2. If it is not their turn, nothing else happens. The dealer steps and new
   rounds are sent by whoever is connected.
3. If it IS their turn, the other clients each start a timer (30s, plus 1.5s
   per rank so the lowest connected seat goes first).
4. When a timer fires, that client submits `away`: the absent player sits the
   round out (betting) or stands (playing), and `sitOut` is set.
5. While `sitOut` is set, step 3's wait is 2.5s. The player's own next move
   clears it. An absent player bets nothing, so they lose nothing while gone.
