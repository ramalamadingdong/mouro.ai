#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS for mouro.ai.
#
#   scp infra/provision.sh root@<vps>:  &&  ssh root@<vps> 'bash provision.sh'
#
# Idempotent: safe to re-run. What it does:
#   - your login user (rami) with sudo, using root's authorized SSH keys
#   - SSH: keys only, no root login
#   - firewall (22, 80, 443), fail2ban, automatic security updates, 2 GB swap
#   - Node 24, Caddy, git, build tools, and Claude Code for rami
#   - a `deploy` user that GitHub Actions uses: it may only write the web root
#     and the server code, and run exactly two sudo commands
#   - the realtime server's system user, data dir and systemd unit
set -euo pipefail

LOGIN_USER="${LOGIN_USER:-rami}"
REPO_URL="${REPO_URL:-https://github.com/ramalamadingdong/mouro.ai.git}"
# Seed config from the checkout this script lives in (works before the PR is
# merged); fall back to cloning REPO_URL only if the script is run on its own.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
seed() { # seed <file in infra/> <destination> [install args...]
  local f="$1" dest="$2"; shift 2
  if [ -f "$HERE/$f" ]; then install "$@" "$HERE/$f" "$dest"; return; fi
  local tmp; tmp=$(mktemp -d) && git clone -q --depth 1 "$REPO_URL" "$tmp/repo"
  install "$@" "$tmp/repo/infra/$f" "$dest"; rm -rf "$tmp"
}

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "▸ packages"
apt-get update -q
apt-get install -yq ca-certificates curl gnupg git rsync ufw fail2ban unattended-upgrades \
  build-essential debian-keyring debian-archive-keyring apt-transport-https sqlite3

if ! command -v node >/dev/null || ! node -v | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi

echo "▸ swap (builds like expo export want headroom on small boxes)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "▸ users"
if ! id "$LOGIN_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$LOGIN_USER"
  usermod -aG sudo "$LOGIN_USER"
  echo "$LOGIN_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$LOGIN_USER"
fi
install -d -m 700 -o "$LOGIN_USER" -g "$LOGIN_USER" "/home/$LOGIN_USER/.ssh"
if [ -f /root/.ssh/authorized_keys ] && [ ! -s "/home/$LOGIN_USER/.ssh/authorized_keys" ]; then
  install -m 600 -o "$LOGIN_USER" -g "$LOGIN_USER" /root/.ssh/authorized_keys "/home/$LOGIN_USER/.ssh/authorized_keys"
fi

id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
cat > /etc/sudoers.d/91-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mouro-realtime, /usr/bin/systemctl reload caddy
EOF
chmod 440 /etc/sudoers.d/91-deploy

id mouro-rt >/dev/null 2>&1 || adduser --system --group --no-create-home mouro-rt

echo "▸ directories"
install -d -o deploy -g deploy /srv/mouro.ai /opt/mouro
install -d -o mouro-rt -g mouro-rt -m 750 /var/lib/mouro-realtime
# The deploy user owns /opt (code) and /srv (static files); only mouro-rt can
# read the database and the auth secret.

echo "▸ caddy"
cat > /etc/caddy/Caddyfile <<'EOF'
# Managed by mouro.ai/infra/provision.sh. The real config ships with each
# deploy at /srv/mouro.ai/infra/Caddyfile.
import /srv/mouro.ai/infra/Caddyfile
EOF
if [ ! -f /srv/mouro.ai/infra/Caddyfile ]; then
  # First boot, before any deploy: seed so Caddy can start.
  install -d -o deploy -g deploy /srv/mouro.ai/infra
  seed Caddyfile /srv/mouro.ai/infra/Caddyfile -o deploy -g deploy
fi
systemctl enable --now caddy
systemctl reload caddy || true

echo "▸ realtime server unit"
seed mouro-realtime.service /etc/systemd/system/mouro-realtime.service -m 644
systemctl daemon-reload
systemctl enable mouro-realtime
# It starts on the first deploy, once /opt/mouro/realtime has code in it.

echo "▸ ssh hardening"
# Never lock anyone out: only turn off passwords and root login once the login
# user can actually get in with a key.
if [ -s "/home/$LOGIN_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/10-mouro.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  sshd -t && { systemctl reload ssh || systemctl reload sshd || true; }
else
  echo "  ! /home/$LOGIN_USER/.ssh/authorized_keys is empty: SKIPPED ssh hardening."
  echo "    Add a key for $LOGIN_USER, confirm you can log in with it, then re-run."
fi

echo "▸ firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "▸ Claude Code for $LOGIN_USER"
sudo -u "$LOGIN_USER" bash -lc 'mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global && grep -q npm-global ~/.profile || echo "export PATH=\$HOME/.npm-global/bin:\$PATH" >> ~/.profile; npm install -g @anthropic-ai/claude-code >/dev/null && echo "claude installed"'
[ -d "/home/$LOGIN_USER/mouro.ai" ] || sudo -u "$LOGIN_USER" git clone -q "$REPO_URL" "/home/$LOGIN_USER/mouro.ai"

cat <<EOF

Done. Next:
  1. Add the GitHub Actions deploy key's PUBLIC half to /home/deploy/.ssh/authorized_keys
  2. Point DNS for mouro.ai and www.mouro.ai at this box
  3. Push to main (or run the Deploy workflow) — it uploads the apps and starts the server
  4. Log in as $LOGIN_USER and run: cd ~/mouro.ai && claude
EOF
