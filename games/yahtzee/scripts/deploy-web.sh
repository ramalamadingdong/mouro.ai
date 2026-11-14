#!/usr/bin/env bash
#
# Manual deploy of the Yahtzee web app to https://mouro.ai/yahtzee/ — a direct
# push from your local working tree to the home NUC, bypassing GitHub Actions.
# Use it to see local changes live without committing/pushing.
#
# It builds a fresh static Vite bundle and atomically swaps it into
# /home/rami/yahtzee/ on the NUC (nginx serves that at /yahtzee/). There is no
# native app and no service worker — this static bundle IS the whole product.
#
# Usage:
#   bash scripts/deploy-web.sh                 # typecheck, test, build, deploy, verify
#   bash scripts/deploy-web.sh --skip-typecheck
#
# Config (override via env):
#   NUC_SSH   SSH target of the NUC           (default: probe NUC_SSH_CANDIDATES)
#   NUC_DIR   deploy dir on the NUC           (default: /home/rami/yahtzee)
#   SITE_URL  URL to verify after deploy      (default: https://mouro.ai/yahtzee/)
#
# Requires: SSH key access to the NUC. A .env (Firebase config) is OPTIONAL —
# without it, online play ships disabled but pass-and-play still works.
set -euo pipefail

NUC_DIR="${NUC_DIR:-/home/rami/yahtzee}"
SITE_URL="${SITE_URL:-https://mouro.ai/yahtzee/}"

# The NUC has no single stable address, so probe rather than hardcode. Verified
# 2026-07-20: the `mouro-nuc` alias and the wired IP 192.168.1.166 both TIME OUT
# because eno1 was NO-CARRIER and the box had failed over to Wi-Fi on a different
# router's subnet. 192.168.50.171 answered. The Tailscale address is listed last
# because it only works from a machine that is itself on the tailnet.
#
# Identify the box by HOST KEY, never by address — its ED25519 key is
#   SHA256:svkQfH8HLRBzMuWetQ1XmAYvWCBFrzo5o0ILI4Aybqk
# Check with: ssh-keyscan -t ed25519 <ip> | ssh-keygen -lf -
NUC_SSH_CANDIDATES="${NUC_SSH_CANDIDATES:-mouro-nuc rami@192.168.50.171 rami@192.168.1.166 rami@100.117.50.75}"

cd "$(dirname "$0")/.."   # project root

# ── Preconditions ────────────────────────────────────────────────────────────
# Unlike the gin rummy deploy, a missing .env is NOT fatal here. The app degrades
# to pass-and-play (isFirebaseConfigured === false) instead of breaking, so an
# unconfigured deploy is a real, shippable thing — just probably not what you
# meant. Warn loudly and carry on.
if [ ! -f .env ]; then
  echo "⚠ ─────────────────────────────────────────────────────────────────────"
  echo "⚠  .env is missing. This build will ship with online play DISABLED."
  echo "⚠  Pass-and-play will work; room codes and invite links will not."
  echo "⚠  To ship online play, copy .env.example → .env and fill in the"
  echo "⚠  VITE_FIREBASE_* values, then re-run this script."
  echo "⚠ ─────────────────────────────────────────────────────────────────────"
fi

# BatchMode=yes turns a password prompt into an immediate failure — otherwise an
# unattended run hangs forever on a TTY prompt nobody is watching. The short
# ConnectTimeout keeps probing a dead address cheap.
try_ssh() { ssh -o BatchMode=yes -o ConnectTimeout=8 "$1" true 2>/dev/null; }

if [ -n "${NUC_SSH:-}" ]; then
  echo "▸ Using NUC_SSH=$NUC_SSH"
  try_ssh "$NUC_SSH" || { echo "✗ Cannot SSH to $NUC_SSH (key auth or unreachable)."; exit 1; }
else
  echo "▸ Probing for the NUC…"
  for cand in $NUC_SSH_CANDIDATES; do
    printf '   %-26s ' "$cand"
    if try_ssh "$cand"; then echo "reachable"; NUC_SSH="$cand"; break; else echo "no"; fi
  done
  if [ -z "${NUC_SSH:-}" ]; then
    echo "✗ No candidate address answered."
    echo "  Check https://mouro.ai/ first: if the SITE is up, the box is fine and"
    echo "  this is only a LAN reachability problem — get on the same network or"
    echo "  the tailnet, or set NUC_SSH=user@host explicitly."
    echo "  Sweep and identify by host key rather than by IP:"
    echo "    ssh-keyscan -t ed25519 <ip> | ssh-keygen -lf -"
    echo "    expect SHA256:svkQfH8HLRBzMuWetQ1XmAYvWCBFrzo5o0ILI4Aybqk"
    exit 1
  fi
fi

echo "▸ Target: $NUC_SSH:$NUC_DIR   →   $SITE_URL"

# ── Gates ────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--skip-typecheck" ]; then
  echo "▸ Typecheck…"
  npm run --silent typecheck
fi

echo "▸ Tests…"
npm test --silent

# ── Build ────────────────────────────────────────────────────────────────────
# rm -rf first: Vite content-hashes assets, so a stale dist/ silently keeps every
# asset from every previous build and you can't tell what actually shipped.
echo "▸ Building static bundle…"
rm -rf dist
npm run build
[ -f dist/index.html ] || { echo "✗ Build produced no dist/index.html"; exit 1; }

# Sub-path guard: `base` must be baked in, or every asset URL is absolute-root
# and 404s under /yahtzee/. The page still returns 200 — it just renders blank —
# so this check is the only thing that catches it before a human does.
if ! grep -q '/yahtzee/assets/' dist/index.html; then
  echo "✗ dist/index.html is not sub-path aware (no /yahtzee/assets/ URLs)."
  echo "  Check \`base\` in vite.config.ts — it must be '/yahtzee/' (leading AND"
  echo "  trailing slash). React Router's basename uses the other convention"
  echo "  ('/yahtzee', no trailing slash); the two disagreeing also renders blank."
  exit 1
fi

# ── Deploy (atomic: extract to a temp dir on the NUC, then swap) ──────────────
# The swap is a single mv so the live directory is never half-written. mktemp -d
# is created as a SIBLING of the target dir so the mv is a same-filesystem rename
# (atomic); a /tmp temp dir could be a different mount and the mv would become a
# slow, non-atomic copy.
echo "▸ Deploying to $NUC_SSH:$NUC_DIR …"
tar czf - -C dist . | ssh "$NUC_SSH" "
  set -e
  dir='$NUC_DIR'
  tmp=\$(mktemp -d \"\${dir%/*}/.yahtzee-deploy.XXXXXX\")
  tar xzf - -C \"\$tmp\"
  # nginx runs as www-data and must be able to read every file and traverse every
  # directory, whatever umask the tar happened to carry. a+rX (capital X) sets
  # +x on directories only, never on regular files.
  chmod -R a+rX \"\$tmp\"
  rm -rf \"\$dir\"
  mv \"\$tmp\" \"\$dir\"
  echo \"  synced \$(find \"\$dir\" -type f | wc -l) files to \$dir\"
"

# ── Verify ───────────────────────────────────────────────────────────────────
echo "▸ Verifying $SITE_URL …"
# Git Bash on this Windows box ships a curl that fails with "(43) bad argument"
# against EVERY host, so a curl-only check reports a false 000 on a perfectly
# good deploy. Fall back to PowerShell where curl can't do the job.
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
  echo "  A 200 only proves files serve. Do a real hydration check before you"
  echo "  call this done — see .claude/skills/deploy-web/SKILL.md."
else
  echo "⚠ Files deployed, but $SITE_URL returned HTTP $code."
  echo "  If this is the first-ever deploy, the one-time nginx block isn't installed."
  echo "  Copy deploy/ to the NUC and run:  sudo bash install-nginx.sh"
  echo "  (No DNS/TLS/Cloudflare work is ever needed — the tunnel already covers"
  echo "  every path under mouro.ai.)"
fi
