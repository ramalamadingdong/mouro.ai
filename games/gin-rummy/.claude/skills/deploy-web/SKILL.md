---
name: deploy-web
description: Build and deploy the Gin Rummy web PWA to the live site at https://mouro.ai/gin-rummey (the self-hosted NUC), a direct push from the local working tree that bypasses GitHub Actions. Use when the user says "deploy the site", "update mouro.ai/gin-rummey", "push the web app live", "redeploy the PWA", "ship the web build", or wants local web changes live now without committing/pushing.
---

# Deploy the web PWA to mouro.ai/gin-rummey

Builds a fresh static Expo web export and syncs it to the NUC that hosts
mouro.ai. This deploys the **website only** — the installed iOS/Android app is a
separate deliverable (EAS), not touched here.

## What the script does
`scripts/deploy-web.sh` runs: preflight (`.env` present, SSH to the NUC works) →
`typecheck` → `expo export --platform web` → guard that the bundle is sub-path
aware → **atomic** swap into `/home/rami/gin-rummey/` on the NUC (extract to a
temp dir, then `mv`) → verify `https://mouro.ai/gin-rummey/` returns 200. The
one-time nginx `location /gin-rummey/` block is already installed (README →
"Deploy to mouro.ai/gin-rummey").

## Steps to follow
1. From the project root, run:
   ```bash
   bash scripts/deploy-web.sh
   ```
2. If typecheck fails on code **unrelated** to the deploy (e.g. an in-progress
   edit elsewhere) and the user wants to ship anyway, re-run with
   `bash scripts/deploy-web.sh --skip-typecheck`. This is safe for the web
   runtime — `expo export` strips types via Babel — but only skip when the
   failing types are genuinely unrelated.
3. Confirm the script ends with `✓ Live: https://mouro.ai/gin-rummey/ (HTTP 200)`.

## ALWAYS do a real hydration check, not just the 200
A 200 only proves files serve — it does NOT prove the app boots. This project
has been bitten by a bundle that returns 200 but throws on load (a dependency's
`import.meta` in a classic `<script>`), freezing the page on a prerendered
"connecting…". After deploying, headless-load the LIVE url and assert there are
**no console/page errors** and the home screen renders **without** a stuck
"connecting…". Reproducible approach (system Chrome is at
`C:\Program Files\Google\Chrome\Application\chrome.exe`):

```bash
# in a temp dir, not the repo:
npm i puppeteer-core   # then a short script that launches Chrome via executablePath,
                       # collects page.on('console'|'pageerror'|'requestfailed'),
                       # goto the URL, wait ~13s, print errors + document.body.innerText,
                       # and check /connecting/i is NOT still present.
```
If it regresses to "connecting…", suspect a new `import.meta`/ESM-in-classic-script
issue: `grep import.meta dist/_expo/static/js/web/entry-*.js` and see
`metro.config.js` (package-exports is deliberately disabled for this reason).

## If the deploy can't reach the NUC
Served from a home NUC. Direct SSH is the `mouro-nuc` alias (`rami@192.168.1.166`)
on the LAN. Public traffic now goes via a Cloudflare Tunnel, so from OFF the LAN
SSH may not be reachable — run this on the LAN, or set `NUC_SSH=` to a reachable
target.

## Config (env overrides)
`NUC_SSH` (default `mouro-nuc`), `NUC_DIR` (default `/home/rami/gin-rummey`),
`SITE_URL` (default `https://mouro.ai/gin-rummey/`).

## Report back
State that the site is live (or the exact failure). Remind the user that pushing
to `master` on GitHub also auto-deploys via `.github/workflows/deploy-web.yml` —
this skill is for shipping local changes without committing.
