#!/usr/bin/env bash
# Install or upgrade the self-hosted Umami analytics behind https://mouro.ai/stats.
#
#   sudo bash infra/umami-setup.sh            # install, or rebuild the pinned version
#   sudo UMAMI_VERSION=v3.6.0 bash infra/umami-setup.sh   # upgrade
#
# Not part of the deploy workflow: run it by hand as root on the VPS.
# What it does (idempotent):
#   - PostgreSQL from apt, a local-only `umami` role + database
#   - secrets in /etc/mouro-umami/env (root:mouro-umami 640), created once
#   - Umami built from source in /opt/umami-src with BASE_PATH=/stats
#     (the base path is baked in at build time, so the stock image can't be used)
#   - systemd unit mouro-umami on 127.0.0.1:3100; Caddy proxies /stats/* to it
# After a first install, log in at https://mouro.ai/stats as admin / umami and
# change the password immediately (or do it over the API before Caddy routes it).
set -euo pipefail

UMAMI_VERSION="${UMAMI_VERSION:-v3.5.0}"
# Umami v3.5.0 pins next 16.4.2, which Next's own build refuses (security
# advisory). Bump to a patched release; drop this when Umami ships one.
NEXT_VERSION="${NEXT_VERSION:-16.4.6}"
SRC=/opt/umami-src
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive COREPACK_ENABLE_DOWNLOAD_PROMPT=0

echo "▸ postgres"
apt-get install -yq postgresql >/dev/null
id mouro-umami >/dev/null 2>&1 || adduser --system --group --no-create-home mouro-umami
install -d -m 750 -o root -g mouro-umami /etc/mouro-umami
if [ ! -f /etc/mouro-umami/env ]; then
  pw=$(openssl rand -hex 24)
  (cd /tmp && sudo -u postgres psql -q -c "CREATE ROLE umami LOGIN PASSWORD '$pw';" -c "CREATE DATABASE umami OWNER umami;")
  printf 'DATABASE_URL=postgresql://umami:%s@127.0.0.1:5432/umami\nAPP_SECRET=%s\n' "$pw" "$(openssl rand -hex 32)" > /etc/mouro-umami/env
  chown root:mouro-umami /etc/mouro-umami/env && chmod 640 /etc/mouro-umami/env
fi

echo "▸ umami $UMAMI_VERSION"
rm -rf "$SRC.new"
git clone -q --depth 1 --branch "$UMAMI_VERSION" https://github.com/umami-software/umami.git "$SRC.new"
cd "$SRC.new"
sed -i "s/\"next\": \"[0-9.]*\"/\"next\": \"$NEXT_VERSION\"/" package.json
# The build calls plain `pnpm`; pin the version the repo asks for.
PNPM_VERSION=$(node -p "require('./package.json').engines.pnpm")
shim=$(mktemp -d) && printf '#!/bin/sh\nexec corepack pnpm@%s "$@"\n' "$PNPM_VERSION" > "$shim/pnpm" && chmod +x "$shim/pnpm"
export PATH="$shim:$PATH"
pnpm install --no-frozen-lockfile
set -a; . /etc/mouro-umami/env; set +a
BASE_PATH=/stats NODE_ENV=production DISABLE_TELEMETRY=1 pnpm run build   # also applies DB migrations
rm -rf "$shim"
install -d -o mouro-umami -g mouro-umami "$SRC.new/.next/cache"

echo "▸ swap in and restart"
systemctl stop mouro-umami 2>/dev/null || true
rm -rf "$SRC.old"; [ -d "$SRC" ] && mv "$SRC" "$SRC.old"
mv "$SRC.new" "$SRC"
install -m 644 "$HERE/mouro-umami.service" /etc/systemd/system/mouro-umami.service
systemctl daemon-reload
systemctl enable --now mouro-umami
systemctl restart mouro-umami
echo "done — previous build kept in $SRC.old"
