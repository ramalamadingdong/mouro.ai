# Database rules — read-only mirror

`database.rules.json` in this folder is a **copy**. It is here so the rules that
govern this app are readable next to the code that depends on them, and so CI can
detect drift.

## The live file lives in the gin rummy repo

This app shares its Firebase project with the gin rummy app at `../gin-rummey`,
under new top-level nodes `bgRooms/` and `bgMatches/`. That repo owns the single
deployed rules file:

```
../gin-rummey/firebase/database.rules.json
```

To change the rules: edit that file, then

```bash
cd ../gin-rummey
firebase deploy --only database
```

…and copy it back here (`npm run check:rules` tells you if it has drifted).

## Do not add firebase.json here

There is deliberately no `firebase.json` or `.firebaserc` in this repo. A
`firebase deploy --only database` run from here would push THIS copy over the
live rules — and if it were stale, it would lock every gin rummy player out of
their rooms. The one-owner rule is the whole safeguard.

## What the rules can and cannot enforce

They enforce the four things a Realtime Database rule can actually see:

- **membership** — only the host and guest may write to a room
- **turn** — `state/turnUid` must equal the writer's uid, except in the terminal
  `gameOver` / `matchOver` phases, where either player may act
- **monotonic version** — `newData.version > data.version`, so a stale client
  cannot overwrite a newer state
- **attribution** — `lastMove/by` must be the writer

They cannot enforce the rules of backgammon. A rule expression cannot sum an
array, so it cannot even check that fifteen checkers are still on each side.
That check lives in `normalize()` on both clients, which is the best a
Spark-plan, Cloud-Functions-free backend can do. It is the same trade the gin
rummy app makes, and it is fine for casual play between friends.
