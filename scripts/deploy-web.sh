#!/usr/bin/env bash
#
# Manual deploy of the web PWA to https://mouro.ai/backgammon — a direct push
# from your local working tree to the home NUC, bypassing GitHub Actions. Use it
# to see local changes live without committing/pushing.
#
# It builds a fresh static Expo web export and atomically swaps it into
# /home/rami/backgammon/ on the NUC (nginx serves that at /backgammon/).
#
# Usage:
#   bash scripts/deploy-web.sh                 # typecheck, build, deploy, verify
#   bash scripts/deploy-web.sh --skip-typecheck
#
# Config (override via env):
#   NUC_SSH   SSH target of the NUC          (default: probe the candidate list below)
#   NUC_DIR   deploy dir on the NUC          (default: /home/rami/backgammon)
#   SITE_URL  URL to verify after deploy     (default: https://mouro.ai/backgammon/)
#
# Requires: a real .env (Firebase config), and SSH key access to the NUC.
set -euo pipefail

NUC_SSH="${NUC_SSH:-}"
NUC_DIR="${NUC_DIR:-/home/rami/backgammon}"
SITE_URL="${SITE_URL:-https://mouro.ai/backgammon/}"

cd "$(dirname "$0")/.."   # project root

# The NUC has no single stable address — it is dual-homed and fails over to
# Wi-Fi on a different router's subnet when the wired link drops, so the
# `mouro-nuc` alias and the wired IP can both time out while another answers.
# Tailscale is last because it only works from a machine on the tailnet.
# Identify the box by HOST KEY, never by address:
#   ssh-keyscan -t ed25519 <ip> | ssh-keygen -lf -
#   expect SHA256:svkQfH8HLRBzMuWetQ1XmAYvWCBFrzo5o0ILI4Aybqk
if [ -z "${NUC_SSH:-}" ] || [ "$NUC_SSH" = "mouro-nuc" ]; then
  for cand in mouro-nuc rami@192.168.50.171 rami@192.168.1.166 rami@100.117.50.75; do
    if ssh -o BatchMode=yes -o ConnectTimeout=8 "$cand" true 2>/dev/null; then
      NUC_SSH="$cand"
      break
    fi
  done
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
if ! grep -q '/backgammon/_expo/' dist/index.html; then
  echo "✗ dist/index.html is not sub-path aware (missing /backgammon/ asset URLs)."
  echo "  Check experiments.baseUrl in app.json."
  exit 1
fi

# ── Deploy (atomic: extract to a temp dir on the NUC, then swap) ──────────────
echo "▸ Deploying to $NUC_SSH:$NUC_DIR …"
tar czf - -C dist . | ssh "$NUC_SSH" "
  set -e
  dir='$NUC_DIR'
  mkdir -p \"\${dir%/*}\"
  tmp=\$(mktemp -d \"\${dir%/*}/.backgammon-deploy.XXXXXX\")
  tar xzf - -C \"\$tmp\"
  chmod -R a+rX \"\$tmp\"
  rm -rf \"\$dir\"
  mv \"\$tmp\" \"\$dir\"
  echo \"  synced \$(find \"\$dir\" -type f | wc -l) files to \$dir\"
"

# Stage the one-time nginx installer alongside the files it needs. The install
# itself needs sudo, so it stays a deliberate manual step.
echo "▸ Staging nginx config to $NUC_SSH:/home/rami/deploy-backgammon/ …"
tar czf - -C deploy . | ssh "$NUC_SSH" "
  set -e
  mkdir -p /home/rami/deploy-backgammon
  tar xzf - -C /home/rami/deploy-backgammon
"

# ── Verify ───────────────────────────────────────────────────────────────────
echo "▸ Verifying $SITE_URL …"
# Git Bash on Windows ships a curl that fails with "(43) bad argument" against
# EVERY https host, so a curl-only check reports a false failure on a perfectly
# good deploy. Fall back to PowerShell where curl cannot do the job.
http_status() {
  local url="$1" out
  out=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null) || out=""
  if [ -n "$out" ] && [ "$out" != "000" ]; then echo "$out"; return; fi
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "try { (Invoke-WebRequest -Uri '$url' -Method Head -TimeoutSec 20 -UseBasicParsing).StatusCode } \
       catch { \$c = \$_.Exception.Response.StatusCode.value__; if (\$c) { \$c } else { '000' } }" \
      2>/dev/null | tr -d '\r\n ' && return
  fi
  echo "000"
}
code=$(http_status "$SITE_URL")
if [ "$code" = "200" ]; then
  echo "✓ Live: $SITE_URL  (HTTP 200)"
else
  echo "⚠ Files deployed, but $SITE_URL returned HTTP $code."
  echo "  If this is the first-ever deploy, the one-time nginx block isn't installed yet."
  echo "  On the NUC run:  sudo bash /home/rami/deploy-backgammon/install-nginx.sh"
fi
