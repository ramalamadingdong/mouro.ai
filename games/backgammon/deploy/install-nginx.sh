#!/usr/bin/env bash
#
# ONE-TIME nginx setup: serve the backgammon PWA at https://mouro.ai/backgammon/.
#
# Installs TWO location blocks into the mouro.ai server block:
#   backgammon.location          the prefix block + the /backgammon redirect
#   backgammon-dynamic.location  the regex block for /join|lobby|game/<CODE>
#
# This is a PURELY ADDITIVE change: it does not touch the existing gin-rummey
# blocks, the yahtzee block, or the Django proxy. If anything about it is wrong
# `nginx -t` fails and the previous config is restored automatically — nginx is
# never reloaded with a config that did not validate, so the live site cannot
# go down.
#
# Usage (on the NUC, from the directory holding this script and the .location
# files — scripts/deploy-web.sh stages all three to /home/rami/deploy-backgammon):
#   sudo bash install-nginx.sh
set -euo pipefail

CONFIG="${CONFIG:-/etc/nginx/sites-available/mouro.ai}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX_BLOCK="$HERE/backgammon.location"
DYNAMIC_BLOCK="$HERE/backgammon-dynamic.location"
WEBROOT="${WEBROOT:-/home/rami/backgammon}"

if [ "$(id -u)" -ne 0 ]; then
  echo "✗ Needs root to edit $CONFIG and reload nginx. Run: sudo bash install-nginx.sh"
  exit 1
fi

[ -f "$PREFIX_BLOCK" ]  || { echo "✗ Missing $PREFIX_BLOCK — copy the whole deploy/ directory."; exit 1; }
[ -f "$DYNAMIC_BLOCK" ] || { echo "✗ Missing $DYNAMIC_BLOCK — copy the whole deploy/ directory."; exit 1; }
[ -f "$CONFIG" ]        || { echo "✗ Missing $CONFIG. Is this the right box?"; exit 1; }

# ── Idempotency ──────────────────────────────────────────────────────────────
# A second copy of the same location makes `nginx -t` fail outright.
if grep -q 'location /backgammon/' "$CONFIG"; then
  echo "✓ Already installed — $CONFIG already has the backgammon blocks."
  exit 0
fi

# ── Verify the files it will point at actually exist ─────────────────────────
# Pointing at missing files would silently fall back to index.html, i.e. do
# nothing — a change that LOOKS applied but is a no-op. Check before touching
# anything.
missing=0
[ -f "$WEBROOT/index.html" ] || { echo "⚠ Not found: $WEBROOT/index.html"; missing=1; }
for route in join lobby game; do
  target="$WEBROOT/$route/[code].html"
  [ -f "$target" ] || { echo "⚠ Expected prerendered shell not found: $target"; missing=1; }
done
if [ "$missing" -ne 0 ]; then
  echo "✗ Deploy a current build first (bash scripts/deploy-web.sh), then re-run."
  exit 1
fi

# ── Find an anchor to insert before ──────────────────────────────────────────
# Preference order: next to the sibling gin rummy blocks (so the per-app blocks
# stay together and the file reads sensibly), otherwise immediately before the
# catch-all `location /` proxy. Position does not affect behaviour — nginx picks
# the longest prefix match and prefers regex locations regardless of order — but
# a config nobody can follow is how these get broken later.
#
# The pattern uses POSIX classes and [{] rather than \s and \{ so it contains NO
# BACKSLASHES. It travels through a shell variable and then through `awk -v`,
# both of which process escape sequences, and an earlier version that used \t
# and \{ was mangled into an awk syntax error by exactly that.
ANCHOR_RE=''
GIN_ANCHOR='^[[:space:]]*location[[:space:]]*=[[:space:]]*/gin-rummey[[:space:]]*[{]'
ROOT_ANCHOR='^[[:space:]]*location[[:space:]]*/[[:space:]]*[{]'
if grep -qE "$GIN_ANCHOR" "$CONFIG"; then
  ANCHOR_RE="$GIN_ANCHOR"
  echo "▸ Anchoring before the gin-rummey block."
elif grep -qE "$ROOT_ANCHOR" "$CONFIG"; then
  ANCHOR_RE="$ROOT_ANCHOR"
  echo "▸ Anchoring before the catch-all location / block."
else
  echo "✗ Could not find an anchor in $CONFIG."
  echo "  Paste the contents of these two files by hand into the same server{}:"
  echo "    $PREFIX_BLOCK"
  echo "    $DYNAMIC_BLOCK"
  exit 1
fi

# Clear any temp file left behind by a previous failed run.
rm -f "$CONFIG".new.* 2>/dev/null || true

BACKUP="$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$CONFIG" "$BACKUP"
echo "▸ Backed up $CONFIG → $BACKUP"

TMP="$(mktemp "${CONFIG}.new.XXXXXX")"
# Remove the temp file however we leave, so a failure cannot litter
# sites-available (as the first version of this script did).
trap 'rm -f "$TMP"' EXIT

# The anchor arrives as a VARIABLE and is applied with `$0 ~ anchor`, so the awk
# program itself contains no interpolation — the previous version pasted the
# pattern into the program text and produced `!injected /re/ {`, which is not
# valid awk (it needs the &&) and failed before writing anything.
awk -v pfx="$PREFIX_BLOCK" -v dyn="$DYNAMIC_BLOCK" -v anchor="$ANCHOR_RE" '
  !injected && $0 ~ anchor {
    for (i = 1; i <= 2; i++) {
      f = (i == 1 ? pfx : dyn)
      while ((getline line < f) > 0) {
        if (line == "") print ""; else print "    " line
      }
      close(f)
      print ""
    }
    injected = 1
  }
  { print }
' "$CONFIG" > "$TMP"

if ! grep -q 'location /backgammon/' "$TMP" || ! grep -q 'backgammon/(join|lobby|game)' "$TMP"; then
  rm -f "$TMP"
  echo "✗ Injection produced a file missing one of the blocks. $CONFIG is unchanged."
  exit 1
fi

cat "$TMP" > "$CONFIG"   # preserves owner/mode/inode
rm -f "$TMP"
echo "▸ Injected both backgammon blocks."

if ! nginx -t; then
  cat "$BACKUP" > "$CONFIG"
  echo "✗ 'nginx -t' failed. RESTORED the previous config from $BACKUP."
  echo "  nginx was never reloaded, so the live site was never affected."
  exit 1
fi

systemctl reload nginx
echo "✓ nginx reloaded."
echo
echo "Verify:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://mouro.ai/backgammon/"
echo "  curl -s https://mouro.ai/backgammon/join/4K8HJ | grep -o 'invited' | head -1"
