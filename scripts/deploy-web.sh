#!/usr/bin/env bash
#
# Manual deploy of the web PWA to https://mouro.ai/gin-rummey — a direct push
# from your local working tree to the home NUC, bypassing GitHub Actions. Use it
# to see local changes live without committing/pushing.
#
# It builds a fresh static Expo web export and atomically swaps it into
# /home/rami/gin-rummey/ on the NUC (nginx serves that at /gin-rummey/). This
# deploys the WEBSITE only — the installed native app is the separate EAS channel.
#
# Usage:
#   bash scripts/deploy-web.sh                 # typecheck, build, deploy, verify
#   bash scripts/deploy-web.sh --skip-typecheck
#
# Config (override via env):
#   NUC_SSH   SSH target of the NUC          (default: mouro-nuc, falls back to rami@192.168.1.166)
#   NUC_DIR   deploy dir on the NUC          (default: /home/rami/gin-rummey)
#   SITE_URL  URL to verify after deploy      (default: https://mouro.ai/gin-rummey/)
#
# Requires: a real .env (Firebase config), and SSH key access to the NUC.
set -euo pipefail

NUC_SSH="${NUC_SSH:-mouro-nuc}"
NUC_DIR="${NUC_DIR:-/home/rami/gin-rummey}"
SITE_URL="${SITE_URL:-https://mouro.ai/gin-rummey/}"

cd "$(dirname "$0")/.."   # project root

# If the `mouro-nuc` ssh alias isn't defined on this machine, fall back to the IP.
if [ "$NUC_SSH" = "mouro-nuc" ] && ! ssh -G mouro-nuc 2>/dev/null | grep -qi '^hostname 192'; then
  NUC_SSH="rami@192.168.1.166"
fi

# ── Preconditions ────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "✗ .env is missing. Without it the build ships an UNCONFIGURED app"
  echo "  (online play disabled). Copy .env.example → .env and fill it in."
  exit 1
fi

echo "▸ Target: $NUC_SSH:$NUC_DIR   →   $SITE_URL"
echo "▸ Checking SSH to the NUC…"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$NUC_SSH" true \
  || { echo "✗ Cannot SSH to $NUC_SSH (key auth). Fix access or set NUC_SSH=..."; exit 1; }

# ── Gate ─────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--skip-typecheck" ]; then
  echo "▸ Typecheck…"
  npm run --silent typecheck
fi

# ── Build ────────────────────────────────────────────────────────────────────
echo "▸ Exporting static web build…"
rm -rf dist
npx expo export --platform web
[ -f dist/index.html ] || { echo "✗ Build produced no dist/index.html"; exit 1; }

# Guard: baseUrl must be baked in, or the sub-path deploy will 404 on its assets.
if ! grep -q '/gin-rummey/_expo/' dist/index.html; then
  echo "✗ dist/index.html is not sub-path aware (missing /gin-rummey/ asset URLs)."
  echo "  Check experiments.baseUrl in app.json."
  exit 1
fi

# ── Deploy (atomic: extract to a temp dir on the NUC, then swap) ──────────────
echo "▸ Deploying to $NUC_SSH:$NUC_DIR …"
tar czf - -C dist . | ssh "$NUC_SSH" "
  set -e
  dir='$NUC_DIR'
  tmp=\$(mktemp -d \"\${dir%/*}/.gin-rummey-deploy.XXXXXX\")
  tar xzf - -C \"\$tmp\"
  chmod -R a+rX \"\$tmp\"
  rm -rf \"\$dir\"
  mv \"\$tmp\" \"\$dir\"
  echo \"  synced \$(find \"\$dir\" -type f | wc -l) files to \$dir\"
"

# ── Verify ───────────────────────────────────────────────────────────────────
echo "▸ Verifying $SITE_URL …"
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL" || echo "000")
if [ "$code" = "200" ]; then
  echo "✓ Live: $SITE_URL  (HTTP 200)"
else
  echo "⚠ Files deployed, but $SITE_URL returned HTTP $code."
  echo "  If this is the first-ever deploy, the one-time nginx block isn't installed yet."
  echo "  On the NUC run:  sudo bash /home/rami/deploy-gin-rummey/install-nginx.sh"
fi
