#!/usr/bin/env bash
#
# ONE-TIME nginx tweak: serve the correct prerendered shell for gin rummy's
# dynamic routes (/join/<code>, /lobby/<code>, /game/<code>) instead of falling
# through to the Home page. See gin-rummey-dynamic.location for the full why.
#
# This is a PURELY ADDITIVE change: it inserts one new regex `location` block and
# does not touch the existing `location /gin-rummey/` block, the yahtzee block,
# or the Django proxy. If anything about it is wrong, `nginx -t` fails and the
# previous config is restored automatically — nginx is never reloaded with a
# config that did not validate, so the live site cannot go down.
#
# Usage (on the NUC, from the directory holding this script and the .location):
#   sudo bash install-dynamic-routes.sh
set -euo pipefail

CONFIG="${CONFIG:-/etc/nginx/sites-available/mouro.ai}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BLOCK="$HERE/gin-rummey-dynamic.location"

# Insert before the exact-match redirect that opens the gin rummy section, so the
# related blocks stay together and the file reads in a sensible order. (Position
# does not affect behaviour — a regex location beats a prefix location wherever
# it sits — but a config nobody can follow is how these get broken later.)
ANCHOR_RE='^[[:space:]]*location[[:space:]]*=[[:space:]]*/gin-rummey[[:space:]]*\{'

if [ "$(id -u)" -ne 0 ]; then
  echo "✗ Needs root to edit $CONFIG and reload nginx. Run: sudo bash install-dynamic-routes.sh"
  exit 1
fi

[ -f "$BLOCK" ]  || { echo "✗ Missing $BLOCK — copy the whole deploy/ directory, not just this script."; exit 1; }
[ -f "$CONFIG" ] || { echo "✗ Missing $CONFIG. Is this the right box?"; exit 1; }

# ── Idempotency ──────────────────────────────────────────────────────────────
# A second copy of the same regex location makes `nginx -t` fail outright.
if grep -q 'gin-rummey/(join|lobby|game)' "$CONFIG"; then
  echo "✓ Already installed — $CONFIG already has the dynamic-route block."
  exit 0
fi

if ! grep -qE "$ANCHOR_RE" "$CONFIG"; then
  echo "✗ Could not find the 'location = /gin-rummey {' anchor in $CONFIG."
  echo "  Add the contents of $BLOCK by hand, anywhere inside the same server{}."
  exit 1
fi

# ── Verify the files it will point at actually exist ─────────────────────────
# A rewrite onto a missing file would silently fall back to index.html, i.e. do
# nothing — the exact bug this is meant to fix, but now hidden behind a config
# change that LOOKS applied. Check before touching anything.
missing=0
for route in join lobby game; do
  target="/home/rami/gin-rummey/$route/[code].html"
  if [ ! -f "$target" ]; then
    echo "⚠ Expected prerendered shell not found: $target"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "✗ Deploy a current build first (bash scripts/deploy-web.sh), then re-run."
  echo "  Without those files this change would be a silent no-op."
  exit 1
fi

BACKUP="$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$CONFIG" "$BACKUP"
echo "▸ Backed up $CONFIG → $BACKUP"

TMP="$(mktemp "${CONFIG}.new.XXXXXX")"
awk -v block="$BLOCK" '
  !injected && /^[ \t]*location[ \t]*=[ \t]*\/gin-rummey[ \t]*\{/ {
    while ((getline line < block) > 0) {
      if (line == "") print ""; else print "    " line
    }
    close(block)
    print ""
    injected = 1
  }
  { print }
' "$CONFIG" > "$TMP"

if ! grep -q 'gin-rummey/(join|lobby|game)' "$TMP"; then
  rm -f "$TMP"
  echo "✗ Injection produced a file without the block. $CONFIG is unchanged."
  exit 1
fi

cat "$TMP" > "$CONFIG"   # preserves owner/mode/inode
rm -f "$TMP"
echo "▸ Injected the dynamic-route block."

if ! nginx -t; then
  cat "$BACKUP" > "$CONFIG"
  echo "✗ 'nginx -t' failed. RESTORED the previous config from $BACKUP."
  echo "  nginx was never reloaded, so the live site was never affected."
  exit 1
fi

systemctl reload nginx
echo "✓ nginx reloaded."
echo
echo "Verify (should now serve the join shell, not the home page):"
echo "  curl -s https://mouro.ai/gin-rummey/join/4K8HJ | grep -o 'invited' | head -1"
