#!/usr/bin/env bash
# Runs ON the VPS at the end of a deploy (called by .github/workflows/deploy.yml).
# Swaps each freshly uploaded build into place with a rename, so a request
# never sees a half-copied directory, then restarts the realtime server if its
# code changed.
set -euo pipefail
WEB=/srv/mouro.ai
RT=/opt/mouro/realtime

for app in site backgammon gin-rummy yahtzee holdem dots pawprints tabby-eights mahjong infra; do
  if [ -d "$WEB/$app.new" ]; then
    rm -rf "$WEB/$app.old"
    [ -d "$WEB/$app" ] && mv "$WEB/$app" "$WEB/$app.old"
    mv "$WEB/$app.new" "$WEB/$app"
    rm -rf "$WEB/$app.old"
    echo "✓ $app"
  fi
done

if [ -d "$RT.new" ]; then
  (cd "$RT.new/server" && npm ci --omit=dev --no-audit --no-fund --silent)
  if [ -d "$RT" ] && diff -rq --exclude=node_modules "$RT" "$RT.new" >/dev/null; then
    rm -rf "$RT.new"
    echo "✓ realtime server unchanged"
  else
    rm -rf "$RT.old"
    [ -d "$RT" ] && mv "$RT" "$RT.old"
    mv "$RT.new" "$RT"
    sudo /usr/bin/systemctl restart mouro-realtime
    sleep 1
    curl -fsS http://127.0.0.1:8787/health >/dev/null && echo "✓ realtime server restarted" || {
      echo "✗ realtime server failed health check — rolling back"
      rm -rf "$RT" && mv "$RT.old" "$RT" && sudo /usr/bin/systemctl restart mouro-realtime
      exit 1
    }
    rm -rf "$RT.old"
  fi
fi

# /etc/caddy/Caddyfile just imports $WEB/infra/Caddyfile (see provision.sh).
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
sudo /usr/bin/systemctl reload caddy
echo "✓ caddy reloaded"
