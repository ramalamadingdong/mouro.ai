#!/usr/bin/env bash
#
# Fail if our mirror of the database rules has drifted from the file that is
# actually deployed.
#
# This app shares a Firebase project with the gin rummy app, which owns the one
# deployed rules file. Our copy exists so the rules are readable next to the
# code, and so a change made in one place cannot silently go unmade in the
# other. See firebase/README.md.
#
#   bash scripts/check-rules-sync.sh
#
# Config:
#   GIN_REPO  path to the gin rummy checkout (default: ../gin-rummey)
set -euo pipefail

cd "$(dirname "$0")/.."

GIN_REPO="${GIN_REPO:-../gin-rummey}"
LIVE="$GIN_REPO/firebase/database.rules.json"
MIRROR="firebase/database.rules.json"

if [ ! -f "$MIRROR" ]; then
  echo "✗ $MIRROR is missing"
  exit 1
fi

# Always a real check: the mirror must at least be valid JSON and contain our
# nodes, even when the sibling checkout is not present (CI, a fresh clone).
node -e "
  const r = JSON.parse(require('fs').readFileSync('$MIRROR', 'utf8')).rules;
  for (const k of ['bgRooms', 'bgMatches']) {
    if (!r[k]) { console.error('✗ mirror is missing the ' + k + ' node'); process.exit(1); }
  }
  console.log('✓ mirror is valid JSON and defines bgRooms + bgMatches');
"

if [ ! -f "$LIVE" ]; then
  echo "⚠ $LIVE not found — skipping the drift check."
  echo "  Set GIN_REPO=<path> to compare against the deployed file."
  exit 0
fi

if diff -u "$LIVE" "$MIRROR" > /dev/null; then
  echo "✓ rules mirror matches $LIVE"
else
  echo "✗ rules mirror has DRIFTED from $LIVE:"
  diff -u "$LIVE" "$MIRROR" || true
  echo
  echo "  The gin rummy repo owns the deployed file. Copy it here:"
  echo "    cp \"$LIVE\" \"$MIRROR\""
  exit 1
fi
