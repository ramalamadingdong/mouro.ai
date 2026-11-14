# `database.rules.json` — what it enforces and why

Evaluated by the mouro.ai realtime server (`../../server`) on every read and
write; it ships with the server, there is no separate rules deploy. Rules files
cannot hold comments, so the reasoning lives here. `npm test --prefix
../../server` ("holdem rules") exercises this file against a live server.

The room, seat, meta and presence rules are **yahtzee's, unchanged** (minus its
`holds` and `rematch` nodes). `../yahtzee/RULES.md` explains them at length —
in particular the one fact everything hangs on: **`.write` cascades downward,
`.validate` does not run on ancestors or on deletes**, so every grant restates
its node's complete shape, and every node a non-host can write is a scalar.
Only what differs is described here.

## Schema

```
rooms/<CODE>/                 CODE = ^[A-HJKMNP-Z2-9]{5}$
  meta/      { host, status: 'waiting'|'playing', createdAt, updatedAt }
  seats/<uid>     "<joinedAt>|<name>"        packed string, written by that uid while 'waiting'
  presence/<uid>  <last-seen ms>             exists = connected; removed by onDisconnect
  state/                                      the engine's GameState, one transaction per move
    version, phase, handNo, button, smallBlind, bigBlind, currentBet, minRaise
    config/   { startingStack, baseBigBlind, blindUpEvery }
    players/<0..5>/ { uid, name, isHuman, stack, bet, committed, hole/[2 cards],
                      inHand, folded, allIn, acted, sitOut, lastAction/{kind, amount} }
    deck/[cards]   board/[0..5 cards]         a card is an integer 0..51
    toAct          seat on turn — ABSENT when nobody is
    turnUid        players[toAct].uid, or '*' when toAct is absent
    result/   { showdown, pots/[{amount, eligible, winners, payouts}], hands/<seat>, won/[..] }
    winner         seat, only in 'gameover'
    lastMove/ { by, kind, seat }
```

Reads: a room is readable by its host, its seated players, anyone while it is
`waiting` (so a joiner can see it), and when it does not exist (so "not found"
is distinguishable from "not allowed"). **A `playing` room is unreadable to
outsiders — but every seated player can read all of `state`, hole cards and
deck included.** That is the accepted trust model (see AGENTS.md).

## `state` — who may write

All of these must hold (all in the `.write`, so a deep write cannot dodge them):

1. **Shape**: `version, config, players, phase, turnUid, handNo, button,
   lastMove` present; `version` a number 0..1,000,000.
2. **Turn consistency** in the NEW state: either `turnUid === '*'` and there is
   no `toAct`, or `toAct` is 0..5 and `turnUid === players[toAct].uid`. This is
   what the *next* writer's authority is read from.
3. **Membership**: the writer has a seat in `seats`, or is the host. (A player
   who leaves deletes their seat and so gives up their write access.)
4. **Authority**, read from the PRE-write state so a client cannot grant it to
   itself:
   - no state yet → the **host** only, and the move must be a `deal`;
   - otherwise the writer is `data.turnUid` (**it is their turn**); or
   - the writer is one of `data.players[*].uid` and `data.turnUid === '*'` and
     the move is a dealer move (`lastMove.kind` ∈ `deal | next | rematch`) —
     **between betting rounds and between hands, any seated player may deal**;
     or
   - the writer is one of `data.players[*].uid`, `lastMove.kind === 'away'`,
     somebody is on turn, and **`presence/<data.turnUid>` does not exist** —
     acting for a player whose connection is gone.
5. **`lastMove.by === auth.uid`**: you cannot write a state claiming somebody
   else moved.
6. **`version` strictly increases**: blocks rollback and replay, makes the
   transaction retry loop correct, and is why a partial deep write into
   `state` always fails (it leaves `version` where it was).

Every child of `state` is named, typed and bounded (chips 0..10,000,000, cards
0..51, seat keys `0..5`, names ≤ 24 chars, enumerated `phase` / `lastAction.kind`
/ `lastMove.kind`), and unknown keys are refused. Nodes the wire prunes
(`toAct`, `result`, `winner`, `board`, `hole`, `lastAction`) are optional.

## What these rules do NOT enforce

| Not enforced | What it means |
|---|---|
| **Secrecy of hole cards and the deck between seated players.** | By design: client-authoritative. A modified client can read everyone's cards and the cards to come. |
| **Poker.** | The rules bound shape and authority, never legality. The player on turn can write any state that passes the shape checks — a bet they cannot afford, a different deck, a turn that does not rotate. The defence is `normalize()` on every other client, which rejects a state whose chips do not sum to `players × startingStack` or whose 52 cards are not each present once; anything subtler (peeking, re-dealing a legal deck in your favour) is undetectable. Casual play between friends. |
| **What a dealer or `away` write actually changes.** | Rule 4 checks the *label* (`lastMove.kind`), not the diff. In the `'*'` window any seated player can write an arbitrary well-formed state stamped `next`; with a player disconnected, any other player can write one stamped `away`. Same class of trust as the row above. |
| **The 30-second grace before `away`.** | The rules can see that a presence node is absent, not for how long — presence is deleted on disconnect, leaving no "since". The grace (`AWAY.graceMs`) is the honest client's manners. A hostile client could fold a player the instant their connection blinks. |
| **The 6-player cap.** | Rules cannot count children; `joinRoom()` checks it. Extra seats are simply not dealt in (`seatOrder` truncates). |
| **Rate limiting, `updatedAt` honesty, host abandonment.** | As in yahtzee: the host can close a waiting room, and a room nobody touches is reaped after 24h. |

## Disconnects, in order of what actually happens

1. A player's socket drops → the server runs their `onDisconnect` and removes
   `presence/<uid>`. Other tables see "Away" on that seat.
2. If it is not their turn, nothing else happens. Streets and new hands are
   dealt by whoever is connected.
3. If it IS their turn, the other clients each start a timer (30s, plus 1.5s
   per rank so the lowest connected seat goes first). If the presence node
   comes back, the timers are cancelled.
4. When a timer fires, that client submits `away`. The engine checks for the
   absent player if that is free, folds them otherwise, and sets `sitOut`.
5. While `sitOut` is set, step 3's wait is 2.5s instead of 30s. The player's
   own next move clears it. Their blinds are still posted, so an abandoned
   seat eventually busts and the game ends normally.
