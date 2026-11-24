# mouro.ai

Everything behind **https://mouro.ai**: the personal site, the family games,
and the small realtime server the games play through. One repo, one VPS.

A new cat-themed multiplayer game is added every week; the ledger is
[`games/WEEKLY.md`](games/WEEKLY.md). Only the newest weekly game is shown on
the games hub; earlier ones stay live at their own URL.

| Path | What | URL |
|---|---|---|
| [`site/`](site/) | Personal site (static HTML + CSS), plus the games hub, Sudoku, Cat Café (a solo tile puzzle against a computer cat) and the road trip games on the hub's second tab: Town Trivia and Photo Guess (live GPS) and Categories (optional car screen) — each a self-contained, installable page with its own look | `/`, `/projects/`, `/games/` (`#road-trip` for the second tab), `/games/sudoku/`, `/games/cat-cafe/`, `/games/road-trip/{trivia,photo,categories}/` |
| [`games/backgammon/`](games/backgammon/) | Two-player backgammon, Tawleh rules (Expo PWA, Expo Go on phones) | `/backgammon/` |
| [`games/gin-rummy/`](games/gin-rummy/) | Two-player gin rummy (Expo PWA, Expo Go on phones) | `/gin-rummy/` |
| [`games/yahtzee/`](games/yahtzee/) | 1–4 player Yahtzee (Vite PWA) | `/yahtzee/` |
| [`games/holdem/`](games/holdem/) | 2–6 player Texas Hold'em online, or solo against computer cats (Vite PWA) | `/holdem/` |
| [`games/blackjack/`](games/blackjack/) | Blackjack against a dealer cat: 2–8 players online, or solo with up to seven computer cats (Vite PWA) | `/blackjack/` |
| [`games/mahjong/`](games/mahjong/) | Japanese (Riichi) and Hong Kong mahjong, four-handed or heads-up, online (cats fill empty seats) or vs computer cats, with lessons and a coach (Vite PWA) | `/mahjong/` |
| [`games/dots/`](games/dots/) | 2–4 player Dots and Boxes online, or solo against computer cats (Vite PWA) | `/dots/` |
| [`games/pawprints/`](games/pawprints/) | Pawprints — weekly cat game, added Nov 15, 2026: 2–4 player five-in-a-row on a quilt online, or solo against computer cats (Vite PWA) | `/pawprints/` |
| [`games/tabby-eights/`](games/tabby-eights/) | Tabby Eights — weekly cat game, added Nov 23, 2026: 2–4 player crazy eights with cat suits online, or solo against computer cats (Vite PWA) | `/tabby-eights/` |
| [`server/`](server/) | Realtime server: WebSocket + SQLite, enforces each game's rules | `/rt` |
| [`packages/realtime/`](packages/realtime/) | `@mouro/realtime`, the client the games use | — |
| [`infra/`](infra/) | Caddyfile, systemd unit, VPS provisioning, deploy activation | — |

Anything that is not on the site gets `site/404.html` (Caddy `handle_errors`).

Every page, project and game has a link-preview card (1200 × 630) in
`site/static/share/`, drawn by `node scripts/render-share-cards.mjs` and
committed. A preview ignores the `#fragment`, so each project also has a share
address — `/projects/pcb-agent/`, `/projects/shooter-selector/`, … — that
carries its own card and forwards to the write-up; the same script writes those
pages. After changing a title or adding a page, edit the list in the script,
run it, and point the page's `og:image` at its card.

Old `/gin-rummey/…` links (the original spelling) redirect permanently to
`/gin-rummy/…`, so invites already sent keep working.

## How online play works

The games were written against Firebase Realtime Database. They now talk to
our own server instead, through a client with **the same API shape** — `ref`,
`get`, `set`, `update`, `onValue`, `runTransaction`, `onDisconnect`,
`serverTimestamp`, and anonymous auth. That kept each game's carefully written
room code intact; only its imports changed.

- **Storage:** one SQLite file (`/var/lib/mouro-realtime/realtime.sqlite`), one
  namespace per game (`server/games.json`), so gin rummy's and yahtzee's
  `rooms/` never collide.
- **Security:** the server evaluates each game's `database.rules.json` — the
  same Firebase-syntax rules the games always had (turn order, membership,
  version monotonicity, field validation) — on every read and write, and
  cancels live subscriptions the moment the rules stop allowing them.
- **Transactions:** compare-and-set with retry, the same model Firebase uses, so
  the games' "run the pure reducer inside the transaction" pattern is unchanged.
- **Identity:** anonymous. The server mints a uid and an HMAC-signed token; the
  client keeps it in localStorage (web) or AsyncStorage (native).
- **Housekeeping:** rooms idle for 24 hours are reaped hourly.

## Local development

```bash
npm run setup            # npm ci in the server and every game
npm run server           # realtime server on ws://localhost:8787/rt
cd games/yahtzee && VITE_REALTIME_URL=ws://localhost:8787/rt npm run dev
cd games/gin-rummy && EXPO_PUBLIC_REALTIME_URL=ws://<LAN-ip>:8787/rt npx expo start
```

Or try the whole site the way production serves it, on one port:

```bash
npm run build && npm run preview     # → http://localhost:8080
```

Before pushing:

```bash
npm run typecheck && npm test
```

`npm test` includes `server/test/`, which runs a live server against every
game's real rules file (create / join / play / deny / onDisconnect / reaper).

## Deploying

Push to `main` (or `master`). [`deploy.yml`](.github/workflows/deploy.yml) runs CI
(typecheck, tests and a production build of every game), uploads everything to
the VPS into `*.new` directories, and [`infra/activate.sh`](infra/activate.sh)
swaps them into place atomically, restarts the realtime server only if its code
changed (rolling back if the health check fails), validates the Caddyfile and
reloads Caddy. Pull requests run CI only.

### One-time VPS setup

1. Create an Ubuntu 24.04 VPS and put your SSH key on root.
2. `scp infra/provision.sh root@<vps>: && ssh root@<vps> 'bash provision.sh'`
   — creates your login user (with Claude Code installed and this repo cloned),
   a locked-down `deploy` user, the firewall, Caddy, Node 24, swap, and the
   realtime service.
3. Make a deploy key: `ssh-keygen -t ed25519 -f deploy_key -N ''` and append
   `deploy_key.pub` to `/home/deploy/.ssh/authorized_keys` on the VPS.
4. In GitHub → Settings → Environments → **production**, add secrets:
   - `DEPLOY_HOST` — the VPS hostname or IP
   - `DEPLOY_SSH_KEY` — contents of `deploy_key`
   - `DEPLOY_KNOWN_HOSTS` — output of `ssh-keyscan -t ed25519 <vps>` (pinned)
5. Point `mouro.ai` and `www.mouro.ai` DNS at the VPS. Caddy gets the
   certificate itself; behind Cloudflare, use SSL mode **Full (strict)**. The
   old Cloudflare Tunnel to the NUC can then be deleted.
6. Run the **Deploy** workflow (or push to `main`).

### On the box

```bash
sudo systemctl status mouro-realtime     # the game server
journalctl -u mouro-realtime -f          # its log
sqlite3 /var/lib/mouro-realtime/realtime.sqlite 'select db, key from nodes'
```

Back up `/var/lib/mouro-realtime/` (the database and the token-signing secret);
everything else is rebuilt by a deploy.

## Repo conventions

- The default branch is protected: changes land through pull requests with CI green.
- Each game keeps its own `package.json` and lockfile (the Expo apps are pinned
  to SDK 54 for Expo Go on iPhone; yahtzee is on newer React). There are no npm
  workspaces on purpose — hoisting would mix React versions.
- Every page and game loads the analytics tag (self-hosted Umami at `/stats`);
  how to add it is in [`CLAUDE.md`](CLAUDE.md#analytics-required-on-every-new-page-and-game),
  and `scripts/check-analytics.mjs` enforces it in CI.
- Per-project notes for coding agents live in each folder's `AGENTS.md`;
  repo-wide ones in [`CLAUDE.md`](CLAUDE.md).
