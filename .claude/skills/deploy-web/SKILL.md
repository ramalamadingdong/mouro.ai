---
name: deploy-web
description: Build and deploy the Yahtzee web app to the live site at https://mouro.ai/yahtzee (the self-hosted NUC), a direct push from the local working tree that bypasses GitHub Actions. Use when the user says "deploy the site", "update mouro.ai/yahtzee", "push the web app live", "ship the web build", "redeploy yahtzee", or wants local web changes live now without committing/pushing.
---

# Deploy the web app to mouro.ai/yahtzee

Builds a fresh static Vite bundle and syncs it to the NUC that hosts mouro.ai.
There is no native app and no service worker — this static bundle is the entire
product.

## What the script does
`scripts/deploy-web.sh` runs: preflight (SSH to the NUC works; `.env` present is
a **warning, not an error**) → `typecheck` → `npm test` → `rm -rf dist && npm run
build` → guard that the bundle is sub-path aware → **atomic** swap into
`/home/rami/yahtzee/` on the NUC (extract to a sibling temp dir, then `mv`) →
verify `https://mouro.ai/yahtzee/` returns 200.

## Steps to follow
1. From the project root, run:
   ```bash
   bash scripts/deploy-web.sh
   ```
2. If typecheck fails on code **unrelated** to the deploy and the user wants to
   ship anyway, re-run with `bash scripts/deploy-web.sh --skip-typecheck`. Note
   this is less safe than it sounds: `npm run build` is `tsc -b && vite build`,
   so a type error will still fail the build. Skipping only buys you time, it
   does not bypass the compiler.
3. Confirm the script ends with `✓ Live: https://mouro.ai/yahtzee/ (HTTP 200)`.
4. Then do the hydration check below. **Do not report success without it.**

## A 200 is NOT enough — always do a real hydration check
A 200 only proves nginx found `index.html`. It does not prove the app boots. The
signature failure for this project is a page that serves perfectly and renders a
**blank white body with no console errors at all** — which almost always means
React Router's `basename` (`'/yahtzee'`, no trailing slash) and Vite's `base`
(`'/yahtzee/'`, both slashes) disagree, so the router matches nothing and mounts
nothing. Assets load fine, so every network-level check passes.

So after deploying, headless-load the LIVE url and assert both that there are
**no console/page errors** and that **real app content actually rendered**.

Reproducible approach — install into a **temp dir OUTSIDE the repo** (never add
puppeteer to this project's dependencies) and drive system Chrome:

```bash
cd "$(mktemp -d)"          # NOT the repo
npm init -y
npm i puppeteer-core
```

Then a short script that:
- launches via `executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'`
  (puppeteer-core ships no browser of its own — that is the point, it reuses the
  installed Chrome instead of downloading 150MB)
- subscribes to `page.on('console')`, `page.on('pageerror')` and
  `page.on('requestfailed')` **before** navigating, or early boot errors are
  missed entirely
- `goto('https://mouro.ai/yahtzee/', { waitUntil: 'networkidle2' })`
- waits ~10s (Firebase anonymous auth is async; a too-early snapshot reads as a
  blank page even on a healthy deploy)
- prints every collected error plus `document.body.innerText`
- **fails** if any pageerror/requestfailed fired, OR if `innerText` is empty or
  missing the expected home-screen text

Also worth checking on a suspicious deploy: hard-refresh a deep link such as
`https://mouro.ai/yahtzee/local`. If the root works but a deep link 404s, the
nginx `try_files` fallback is missing or wrong — see `deploy/yahtzee.location`.

## First-ever deploy
The one-time nginx block is not installed by the deploy script. Copy the whole
`deploy/` directory to the NUC and run:
```bash
sudo bash install-nginx.sh
```
It is idempotent (refuses to double-inject), backs the config up, and restores
the backup automatically if `nginx -t` fails. **Never touch Cloudflare** — DNS,
TLS and the tunnel already cover every path under mouro.ai, so a new sub-path
needs zero certificate, DNS or tunnel work.

## If the deploy can't reach the NUC
Check **https://mouro.ai/ in a browser first** — that distinguishes "the box is
down" from "the box is up but not reachable on this LAN path", and they have
completely different fixes.

SSH is LAN-only (the Cloudflare Tunnel is outbound-only; there is no public port
22). The `mouro-nuc` alias points at `rami@192.168.1.166`, but **that IP is not
stable**: as of 2026-07-20 the wired `eno1` was NO-CARRIER and the box had failed
over to Wi-Fi at `192.168.50.171`. The NUC also runs **Tailscale**, which is the
reliable way in — prefer it over guessing an IP.

If you do have to sweep the LAN, identify the box by its **host key
fingerprint**, not by IP:
```
SHA256:svkQfH8HLRBzMuWetQ1XmAYvWCBFrzo5o0ILI4Aybqk   (ED25519)
```
Then set `NUC_SSH=rami@<found-address>` and re-run.

## Missing .env is not a blocker
Unlike the gin rummy deploy, this script only **warns** when `.env` is absent.
The app checks `isFirebaseConfigured` and degrades to pass-and-play; online play
(room codes, invite links) is simply hidden. If the user deployed without `.env`
and then reports "the multiplayer button is gone", that is the cause — fill in
the `VITE_FIREBASE_*` values and redeploy.

Remember env vars must be read by **static dot notation** (`import.meta.env.VITE_FIREBASE_API_KEY`).
Vite does literal text substitution at build time, so `import.meta.env[key]` is
`undefined` in the production bundle even though it works in dev — another
failure that only shows up after deploying.

## Config (env overrides)
`NUC_SSH` (default `mouro-nuc`, falls back to `rami@192.168.1.166`),
`NUC_DIR` (default `/home/rami/yahtzee`),
`SITE_URL` (default `https://mouro.ai/yahtzee/`).

## Report back
State that the site is live (or the exact failure), and say explicitly that the
hydration check passed — not just the 200. Remind the user that pushing to
`master` on GitHub also auto-deploys via `.github/workflows/deploy-web.yml`;
this skill is for shipping local changes without committing.
