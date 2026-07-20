# Yahtzee — layout and data model

The starter prompt asked me to propose this and check it before implementing.
You set the session to an autonomous loop instead, so I made the calls below and
built the pure engine against them. **Everything here is still cheap to change**
— the engine is 5 files and 64 tests, and nothing is deployed.

Flag anything you'd rather have different and I'll rework it.

## Product decisions I made for you

| Question | Call | Why |
|---|---|---|
| Player count | **1–4** | Yahtzee is naturally N-handed. Solo is just N=1, which falls out of the same reducer. |
| Multiplayer shape | Room code + invite **link**, host creates, others join | Mirrors the gin rummy flow you already like. The link is the upgrade — gin rummy shares a bare 5-character code with no URL and makes the recipient retype it. |
| Offline mode | **Pass-and-play** on one device (1–4 seats) | Same store shape as online, so one screen component drives both. |
| Computer opponent | **Not yet** | Gin rummy has one. A decent Yahtzee AI is tractable (expected-value keep selection) but it's a separate chunk of work — say the word. |
| Identity recovery | **Not yet built** | See the open question at the bottom; it's the one thing worth deciding before real games accumulate. |

## The core data model

Two deliberate divergences from the gin rummy engine:

**1. A seat is an integer index, not `'p0' | 'p1'`.** Gin rummy is strictly
two-handed so a string union was fine. Yahtzee seats up to four, and an index
makes `cards[seat]` and the turn arithmetic (`(turn + 1) % players.length`) fall
out for free.

**2. Holding dice is not a move.** Moves run inside an RTDB transaction with
`applyLocally: false`, so each one costs a full round-trip. Toggling a die
across the network would feel terrible. So `roll` carries the indices it keeps,
and the "which dice are held" highlight is local UI state published to a sibling
node for the opponent to watch.

```ts
type Move =
  | { kind: 'roll'; keep: number[]; seed: number[] }  // keep = indices of current dice
  | { kind: 'score'; category: Category }
  | { kind: 'rematch' };

interface GameState {
  version: number;              // monotonic; the rules enforce it increases
  players: Player[];            // index = seat, length 1..4
  phase: 'roll' | 'decide' | 'over';
  turn: Seat;                   // = index into players
  turnUid: string;              // denormalized players[turn].uid — the rules read this
  round: number;                // 1..13, then 14 once over
  dice: number[];               // 5 faces of 1..6, or [] before the turn's first roll
  rollsUsed: number;            // 0..3
  cards: ScoreCard[];           // index = seat; Record<Category, number | null>
  yahtzeeBonus: number[];       // index = seat; count of bonus Yahtzees
  result: MatchResult | null;   // non-null exactly when phase === 'over'
  lastMove: LastMove | null;
}
```

`ScoreCard` cells are `number | null` where **null is open and 0 is used** — a
scratched category. That is the falsy-but-valid trap your notes warned about,
and it now has three tests and a `Number.isFinite` guard on every read.

`rematch` carries no seed, unlike gin rummy's — a new Yahtzee game starts with
no dice on the table, so there is nothing to shuffle.

## Layout

```
src/
  engine/            pure TS — no React, no Firebase, no DOM   ✅ built
    types.ts         contract + RULES tunables + category tables
    rng.ts           cyrb128 → sfc32, seeded, engine-agnostic
    scoring.ts       what each box is worth for a set of dice
    reducer.ts       applyMove / legalMoves / legalCategories / initialGameState
    serialize.ts     normalize(raw: unknown): GameState | null
    __tests__/       scoring, reducer, serialize, fuzz            64 tests
  fb/                config.ts, firebase.ts, auth.ts, rooms.ts, presence.ts
  store/             gameStore.ts (online), localStore.ts (pass-and-play), settingsStore.ts
  theme/             tokens.ts (as const) + tokens.css (:root custom properties)
  components/        dice, scorecard, room code input, modals
  routes/            Home, Lobby, Game, Local, Join
  util/              seed.ts (crypto.getRandomValues + room codes)
firebase/database.rules.json
scripts/deploy-web.sh
.github/workflows/deploy-web.yml
```

## What's built and verified

The engine, end to end. `npm run typecheck` is clean and `npm test` is green:
**64 tests, including a 2,000-game fuzz suite.**

The fuzz test is the one worth knowing about. Every game is a pure function of
its index, so any failure reproduces exactly. It drives every decision from
`legalMoves` / `legalCategories`, plays 1–4 handed tables, and after **every
single move** asserts:

- no move the engine called legal is ever rejected
- `version` strictly increases; `turnUid` never drifts from `players[turn]`
- dice are always 0 or 5 faces, each 1–6
- each seat's filled-box count exactly matches its position in the round
- the final result reconciles with the scorecards it claims to total
- **and the state survives a round-trip through simulated RTDB damage** —
  nulls pruned, empty collections dropped, arrays turned into integer-keyed
  objects — and normalizes back byte-identical

That last one already earned its keep: it's what made me read seat-indexed
arrays by explicit index instead of sorted key.

Two rules I'd double-check against how you actually play, since they're the
fiddly part of Yahtzee and I picked the official interpretation:

- A **second Yahtzee pays the 100 bonus only if the Yahtzee box holds 50.** If
  you scratched Yahtzee to 0 earlier, joker rules still apply but no bonus.
- **Joker rules**: a further Yahtzee is forced into its matching upper box if
  open; else any open lower box (full house 25 / small 30 / large 40); else it
  scratches an upper box.

## Still to build

Firebase layer + rules → stores → theme → UI → deploy scripts.

Nothing touches your server. The nginx block and both deploy paths get written
but **not run** — deploying is yours to trigger.

## The one open question worth your answer

iOS Safari evicts localStorage after ~7 days of non-use for sites not installed
to the home screen. Identity is an anonymous uid held locally, so a casual
visitor silently becomes a stranger — losing their seat in any game in progress.
Installed PWAs are exempt.

For Yahtzee this matters less than it would for gin rummy: games are short and
single-session. My inclination is **do nothing** beyond prompting to install,
rather than building a nickname+PIN recovery flow for a game you finish in ten
minutes. But it's your call, and it's much cheaper to decide now than after
games exist that can't be re-attributed.
