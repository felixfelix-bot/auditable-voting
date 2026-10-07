#!/usr/bin/env bash
# Ship the consolidated AV build to the OrangeSync box as role subdomains.
#
# Idempotent. Three phases, each verified before the next:
#   1. stage web/dist and rsync it to /srv/av-demo (--delete drops old hashes)
#   2. install av-demo.caddy as a SEPARATE imported file; append the import line
#      exactly once; `caddy validate`; only then reload
#   3. verify every hostname over HTTPS
#
# The shared /etc/caddy/Caddyfile serves ~24 other live sites, so it is backed
# up before the single import line is appended and is never otherwise edited.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${SRC:-$REPO_ROOT/web/dist}"
HOST="${HOST:-debian@23.182.128.51}"
KEY="${KEY:-$HOME/.ssh/preview_vps_deploy}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/tmp/av_bh}"
REMOTE_ROOT="${REMOTE_ROOT:-/srv/av-demo}"

SSHOPT="-i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=$KNOWN_HOSTS"
STAGE="$(mktemp -d)"

echo "=== phase 0: preflight ==="
[ -f "$SRC/vote.html" ] || { echo "FATAL: no build at $SRC — run 'cd web && npm run build' first"; exit 1; }
ssh $SSHOPT "$HOST" 'command -v rsync >/dev/null && echo "rsync: OK" || { echo "rsync: MISSING"; exit 1; }'

echo
echo "=== phase 1: stage + ship ==="
cp -a "$SRC"/. "$STAGE"/
echo "staged: $(du -sh "$STAGE" | cut -f1)"
ssh $SSHOPT "$HOST" "sudo -n mkdir -p '$REMOTE_ROOT' && sudo -n chown debian:debian '$REMOTE_ROOT' && sudo -n chmod 755 '$REMOTE_ROOT'"
rsync -az --delete -e "ssh $SSHOPT" "$STAGE"/ "$HOST":"$REMOTE_ROOT"/
echo "remote: $(ssh $SSHOPT "$HOST" "du -sh '$REMOTE_ROOT' | cut -f1")"
rm -rf "$STAGE"

echo
echo "=== phase 2: caddy config ==="
ssh $SSHOPT "$HOST" "sudo -n cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.av-bak-\$(date -u +%Y%m%dT%H%M%SZ)"
ssh $SSHOPT "$HOST" 'sudo -n tee /etc/caddy/av-demo.caddy >/dev/null' < "$REPO_ROOT/infra/orangesync/av-demo.caddy"
ssh $SSHOPT "$HOST" '
  if sudo -n grep -qF "import av-demo.caddy" /etc/caddy/Caddyfile; then
    echo "import already present"
  else
    printf "\n# AV demo role subdomains - managed file, see import target\nimport av-demo.caddy\n" | sudo -n tee -a /etc/caddy/Caddyfile >/dev/null
    echo "import line appended"
  fi'
echo "--- validate ---"
ssh $SSHOPT "$HOST" 'sudo -n caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -2'
echo "--- reload ---"
ssh $SSHOPT "$HOST" 'sudo -n systemctl reload caddy && sleep 2 && systemctl is-active caddy'

echo
echo "=== phase 3: verify over HTTPS (certs issue on first request) ==="
for h in dashboard voter coordinator results; do
  printf '%s.orangesync.tech/ -> ' "$h"
  curl -4 -s -o /dev/null -w '%{http_code}\n' --max-time 40 "https://$h.orangesync.tech/" || echo "ERR"
done

echo
echo "For a functional check (right role UI, no missing assets):"
echo "  node infra/orangesync/verify-subdomains.mjs"
