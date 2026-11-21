# Road Trip — realtime rules only

The game itself is a static page, `site/games/road-trip/index.html`
(`/games/road-trip/`). This folder holds just its `database.rules.json`, for
the `road-trip` namespace in `server/games.json`.

Only the **Categories** word game uses a room: one phone becomes a shared
"car screen" and the others join with its five-letter code as remotes. A room
holds the word game only — letter, category, timer, player names and scores.
Town trivia and photo guess never use the server, so a player's location is
never stored or visible to anyone else. Keep it that way.

Who can do what (tested in `server/test/realtime.test.js`):

- Only the screen (the host) creates a room, and it starts with no state and no members.
- A phone joins by writing its own uid under `members` (it has to know the code).
- Only the host and members can read the room or write `state`; every write
  names its writer in `by` and raises `version`.
- The host can close (delete) the room; anyone may delete one idle for a day,
  and the server's reaper does so hourly.
