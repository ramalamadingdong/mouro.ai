---
name: deploy-web
description: Build and deploy the Backgammon web PWA to the live site at https://mouro.ai/backgammon (the self-hosted NUC), a direct push from the local working tree that bypasses GitHub Actions. Use when the user says "deploy the site", "update mouro.ai/backgammon", "push the web app live", "redeploy the PWA", "ship the web build", or wants local web changes live now without committing/pushing.
---

# Deploy the web PWA to mouro.ai/backgammon

Builds a fresh static Expo web export and syncs it to the NUC that hosts
mouro.ai. This deploys the **website only** — a native iOS/Android build would
be a separate deliverable (EAS), not touched here.

## What the script does
`scripts/deploy-web.sh` runs: preflight (`.env` present, SSH to the NUC works) →
`typecheck` → `expo export --platform web` → guard that the bundle is sub-path
aware → **atomic** swap into `/home/rami/backgammon/` on the NUC (extract to a
temp dir, then `mv`) → stage `deploy/` to `/home/rami/deploy-backgammon/` →
verify `https://mouro.ai/backgammon/` returns 200.

## Steps to follow
1. From the project root, run:
   ```bash
   bash scripts/deploy-web.sh
   ```
2. If typecheck fails on code **unrelated** to the deploy and the user wants to
   ship anyway, re-run with `bash scripts/deploy-web.sh --skip-typecheck`. This
   is safe for the web runtime — `expo export` strips types via Babel — but only
   skip when the failing types are genuinely unrelated.
3. Confirm the script ends with `✓ Live: https://mouro.ai/backgammon/ (HTTP 200)`.

## ALWAYS do a real hydration check, not just the 200
A 200 only proves files serve — it does NOT prove the app boots. The sibling gin
rummy app was bitten by a bundle that returned 200 but threw on load (a
dependency's `import.meta` in a classic `<script>`), freezing the page on a
prerendered shell. This project inherits the same `metro.config.js` workaround
and the same zustand dependency, so it inherits the trap.

After deploying, headless-load the LIVE url and assert there are **no
console/page errors** and the home screen renders. Reproducible approach (system
Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe`):

```bash
# in a temp dir, not the repo:
npm i puppeteer-core   # then a short script that launches Chrome via executablePath,
                       # collects page.on('console'|'pageerror'|'requestfailed'),
                       # goto the URL, wait ~10s, print errors + document.body.innerText,
                       # and assert the word "Backgammon" is present.
```

Check these four URLs, not just the root:
- `/backgammon/` → "Backgammon", "Create game"
- `/backgammon/solo` → "Play the computer"
- `/backgammon/rules` → "How to play"
- `/backgammon/join/4K8HJ` → "You're invited" **with the five code boxes filled
  in**. Empty boxes mean the hydration remount in `join/[code].tsx` regressed;
  a Home page here means the nginx regex block is missing.

If the app regresses to a blank/frozen shell, suspect a new `import.meta`/
ESM-in-classic-script issue: `grep import.meta dist/_expo/static/js/web/entry-*.js`
and see `metro.config.js` (package-exports is deliberately disabled for this).

## First deploy on a fresh NUC needs one sudo step
The deploy script stages the nginx config but cannot install it. Once, on the
NUC, AFTER the first file deploy:

```bash
sudo bash /home/rami/deploy-backgammon/install-nginx.sh
```

Order matters — the installer refuses to inject a config pointing at
`[code].html` files that do not exist yet, because a silent no-op is exactly the
bug it exists to prevent.

## If the deploy can't reach the NUC
Served from a home NUC. The box is dual-homed and fails over between subnets, so
the script probes a candidate list rather than trusting one address. Public
traffic goes via a Cloudflare Tunnel, so from OFF the LAN SSH may not be
reachable — run this on the LAN, or set `NUC_SSH=` to a reachable target.

## Config (env overrides)
`NUC_SSH` (default: probe), `NUC_DIR` (default `/home/rami/backgammon`),
`SITE_URL` (default `https://mouro.ai/backgammon/`).

## Report back
State that the site is live (or the exact failure). Remind the user that pushing
to `master` on GitHub also auto-deploys via `.github/workflows/deploy-web.yml` —
this skill is for shipping local changes without committing.
