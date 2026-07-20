#!/usr/bin/env bash
#
# ONE-TIME nginx setup for https://mouro.ai/yahtzee/ — run this on the NUC, once.
# After it succeeds, deploys are just file syncs (scripts/deploy-web.sh or the
# GitHub Actions workflow) and never touch nginx again.
#
# What it does: injects deploy/yahtzee.location into the mouro.ai server block,
# immediately before the `location / {` Django proxy, then validates and reloads.
# It backs the config up first and RESTORES the backup automatically if
# `nginx -t` fails, so a bad edit cannot take mouro.ai down.
#
# It does NOT touch DNS, TLS, certbot or Cloudflare. The tunnel already covers
# every path under mouro.ai; a new sub-path needs zero certificate work.
#
# Usage (on the NUC, from the directory holding this script and yahtzee.location):
#   sudo bash install-nginx.sh
set -euo pipefail

CONFIG="${CONFIG:-/etc/nginx/sites-available/mouro.ai}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BLOCK="$HERE/yahtzee.location"
DEPLOY_DIR="${DEPLOY_DIR:-/home/rami/yahtzee}"

# The anchor we inject before: the FIRST `location / {` in the file, i.e. the
# Django catch-all proxy. Tolerant of indentation and inner spacing because this
# config is hand-maintained and outside any git repo.
ANCHOR_RE='^[[:space:]]*location[[:space:]]+/[[:space:]]*\{'

# ── Preconditions ────────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "✗ Needs root to edit $CONFIG and reload nginx. Run: sudo bash install-nginx.sh"
  exit 1
fi

[ -f "$BLOCK" ]  || { echo "✗ Missing $BLOCK — copy the whole deploy/ directory, not just this script."; exit 1; }
[ -f "$CONFIG" ] || { echo "✗ Missing $CONFIG. Is this the right box? Expected the mouro.ai nginx site."; exit 1; }

# ── Idempotency ──────────────────────────────────────────────────────────────
# Running twice would inject a duplicate location block, which makes `nginx -t`
# fail outright ("duplicate location"). Detect and stop cleanly instead.
if grep -qE '^[[:space:]]*location[[:space:]]+/yahtzee/' "$CONFIG"; then
  echo "✓ Already installed — $CONFIG already has a 'location /yahtzee/' block."
  echo "  Nothing to do. To change the block, edit $CONFIG by hand."
  exit 0
fi

# ── Verify the anchor exists BEFORE we write anything ────────────────────────
# If the Django proxy block were ever renamed or removed, awk would silently
# produce a copy of the file with nothing injected and this script would report
# success on a no-op. Fail loudly instead.
if ! grep -qE "$ANCHOR_RE" "$CONFIG"; then
  echo "✗ Could not find the 'location / {' anchor in $CONFIG."
  echo "  That block is the Django proxy; the yahtzee block must be inserted"
  echo "  before it so nginx sees /yahtzee/ first. Inspect the config and add"
  echo "  the contents of $BLOCK by hand."
  exit 1
fi

# ── Back up ──────────────────────────────────────────────────────────────────
BACKUP="$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$CONFIG" "$BACKUP"
echo "▸ Backed up $CONFIG → $BACKUP"

# ── Inject ───────────────────────────────────────────────────────────────────
# getline reads yahtzee.location verbatim, so `$uri` and friends reach nginx
# untouched (no shell expansion anywhere in this path). Non-blank lines get a
# 4-space indent to match the surrounding server{} body; blank lines stay blank
# so the config doesn't grow trailing whitespace.
TMP="$(mktemp "${CONFIG}.new.XXXXXX")"
awk -v block="$BLOCK" '
  !injected && /^[ \t]*location[ \t]+\/[ \t]*\{/ {
    while ((getline line < block) > 0) {
      if (line == "") print ""; else print "    " line
    }
    close(block)
    print ""
    injected = 1
  }
  { print }
' "$CONFIG" > "$TMP"

# Sanity: the rewritten file must actually contain the block now.
if ! grep -qE '^[[:space:]]*location[[:space:]]+/yahtzee/' "$TMP"; then
  rm -f "$TMP"
  echo "✗ Injection produced a file without the yahtzee block. $CONFIG is unchanged."
  exit 1
fi

cat "$TMP" > "$CONFIG"   # preserves the original file's owner/mode/inode
rm -f "$TMP"
echo "▸ Injected $BLOCK before the Django 'location / {' block."

# ── Validate, and roll back if the config is bad ─────────────────────────────
if ! nginx -t; then
  cat "$BACKUP" > "$CONFIG"
  echo "✗ 'nginx -t' failed. RESTORED the previous config from $BACKUP."
  echo "  nginx was never reloaded, so the live site was never affected."
  exit 1
fi

systemctl reload nginx
echo "✓ nginx reloaded."

# ── Post-install note ────────────────────────────────────────────────────────
# The location block is live now, but it serves an empty directory until a build
# lands. Create it so the first request 403/404s on a missing index rather than
# on a missing root, which is a much more confusing error to read.
if [ ! -d "$DEPLOY_DIR" ]; then
  install -d -o rami -g rami -m 755 "$DEPLOY_DIR"
  echo "▸ Created empty $DEPLOY_DIR (owned by rami, so deploys need no sudo)."
fi

echo
echo "✓ https://mouro.ai/yahtzee/ is routed. Now deploy a build:"
echo "    bash scripts/deploy-web.sh        # from your dev machine"
echo "  or push to master and let .github/workflows/deploy-web.yml do it."
