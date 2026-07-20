# Player-strategy analytics

Turn archived games into an ML-ready feature table for classifying **how each
person plays** (aggressive knocker vs. hold-for-gin, disciplined vs. greedy
drawing, how long they sit on high cards, etc.).

## How it works

The app archives every online game under `matches/<matchId>` in Realtime
Database (written by `src/fb/rooms.ts`):

```
matches/<code>-<createdAt>/
  meta:     { code, createdAt, startedAt }
  players:  { p0: <uid>, p1: <uid> }
  initial:  <GameState>            # the round-1 deal (version 0)
  log:      { <version>: { seat, move } }   # every accepted move, in order
```

The engine (`src/engine`) is a **pure, deterministic reducer**, so `initial` plus
the ordered `log` **replays the entire match** — we re-run `applyMove` move by
move and recompute the hands, deadwood, and discard pile at every decision. That
means we can derive *any* feature later without having logged it; only the move
stream is stored (a few hundred bytes to ~2 KB per match).

> Identity note: a player is keyed by their anonymous Firebase `uid`, which is
> stable **per install** — not across reinstalls or devices. Fine for a group of
> friends; if you need durable cross-device identity, add a persistent
> nickname/PIN and re-key on that before you accumulate data you can't
> re-attribute.

## Try it without real data (demo)

```bash
npm run analytics:demo
```

This synthesizes 8 games with three distinct policies (an eager knocker, a
hold-for-gin player, a balanced one), then extracts features. The per-player
summary should show the policies pulling apart — the ginner holds longer and
knocks with far less deadwood than the aggressive player.

Outputs land in `scripts/analytics/out/` (git-ignored):
- `features.csv` — one row per decision (the training table)
- `players.csv` — one row per player (aggregate tendencies / sanity check)

## Run it on real games

### 1. Deploy the security rules (once)

`firebase/database.rules.json` gained a `matches` node: players may append to
their own match's log; **reads are denied to clients** (`.read: false`), so the
archive is owner-only. Deploy it:

```bash
firebase deploy --only database
```

Until deployed, the client's archive writes are silently denied (capture is
best-effort and never blocks gameplay) — so deploy before you expect data.

### 2. Export the `matches` node

Reads are admin-only, so export with owner credentials — either works:

- **Console:** Realtime Database → pick the `matches` node → ⋮ → *Export JSON*.
- **REST with a token:**
  ```bash
  # token from: firebase login:ci   (or a service-account access token)
  curl "https://<your-db>.firebaseio.com/matches.json?auth=<TOKEN>" -o matches.json
  ```

### 3. Extract features

```bash
npm run extract:features -- matches.json
# custom paths:
npm run extract:features -- matches.json --out out/features.csv --summary out/players.csv
```

The input may be the `matches` node directly, or a full DB export containing a
top-level `matches` key.

## Feature columns (`features.csv`)

One row per **decision** (`upcard` / `draw` / `discard` / `knock` / `biggin`);
`nextRound`/`rematch` re-deals are replayed but not emitted.

| column | meaning |
|---|---|
| `matchId`, `code`, `round`, `version` | game / position identity |
| `seat`, `playerUid`, `playerName` | who acted |
| `phase`, `moveKind`, `decision` | what kind of decision |
| `turnInRound` | this player's turn number in the round (→ *turns held before knocking*) |
| `stockBefore` | cards left in the stock |
| `discardTopBefore`, `discardTopPipBefore` | the face-up discard the player saw |
| `handSizeBefore`, `deadwoodBefore` | hand size / best deadwood before acting |
| `drawSource`, `tookDiscard` | stock vs. discard/upcard; 1 = took the visible card |
| `takenCard`, `takenPip` | the card taken from discard/upcard (blank for blind stock draws) |
| `discardTopHelped` | 1 if taking the visible card would have reduced best deadwood (→ *grabbed junk / passed a useful card*) |
| `discardedCard`, `discardedPip` | the card thrown |
| `deadwoodAfterDiscard` | resulting best deadwood |
| `discardHoldTurns` | turns the thrown card was held (→ *high-card hold time*; filter `discardedPip` high) |
| `declinedKnock`, `declinedGin` | on a plain discard, was a knock/gin available but passed up? (→ *hold-for-gin*) |
| `knockType`, `deadwoodAtKnock` | outcome of a knock/gin (`knock`/`gin`/`undercut`/`bigGin`; knocker deadwood) |
| `roundWinner`, `roundPoints`, `scoreP0`, `scoreP1` | round/match outcome |

## Summary columns (`players.csv`)

Aggregated per player across all games: `drawTakeRate`, `takeWhenUsefulRate`,
`grabWhenUselessRate`, `avgDiscardPip`, `avgDiscardHoldTurns`,
`avgHighCardHoldTurns`, `holdForGinRate`, `knocks` / `gins` / `bigGins`, and
`avgDeadwoodAtKnock`. These make good starting features (or labels) for a
classifier; `features.csv` is the full per-decision table to train on.

## Caveats

- **Client-authoritative:** a determined player could spoof *their own* log.
  Irrelevant among friends; relevant only if you ever compete on the model.
- **Best-effort capture:** a rare dropped log write leaves a version gap; the
  extractor stops that one match at the gap (reported as `truncated`) rather than
  desyncing the replay. Whole-match loss just means fewer rows, never wrong rows.
- **Consent:** you're profiling how people play — tell your friends.
