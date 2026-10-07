#!/usr/bin/env bash
# Per-PR preview deployment — the market#1363 pattern, sized for a STATIC app.
#
#   pr-preview.sh --pr 27 --branch feat/issue12-consolidated   # deploy/refresh
#   pr-preview.sh --teardown pr27                              # remove
#   pr-preview.sh --list                                       # what is live
#
# market#1363 needs Docker compose per PR, host-port offsets with claim markers,
# a wake-on-request gateway, a 10-minute idle manager and per-PR Cloudflare A
# records — because it is a relay-backed app. AV ships static files, so none of
# that applies:
#   * no Docker, no ports            -> Caddy file_server from a directory
#   * no wake/idle manager           -> a static file costs nothing to serve
#   * no Cloudflare API              -> *.orangesync.tech is a wildcard, so
#                                       av-<label>.orangesync.tech resolves already
#
# State lives on the box as directories: /srv/av-preview/<label>/. The Caddy
# config is GENERATED from those directories, so teardown cannot leave a stale
# site block behind.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${HOST:-debian@23.182.128.51}"
KEY="${KEY:-$HOME/.ssh/preview_vps_deploy}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/tmp/av_bh}"
SSHOPT="-i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=$KNOWN_HOSTS"

PR=""; BRANCH=""; TEARDOWN=""; LIST=""; BUILD_DIR=""; LABEL_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pr) PR="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --teardown) TEARDOWN="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    --build-dir) BUILD_DIR="$2"; shift 2 ;;
    --label) LABEL_OVERRIDE="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

# Regenerate the Caddy file from the directories that actually exist, then
# validate BEFORE reloading. Returns non-zero if validation fails.
sync_caddy() {
  ssh $SSHOPT "$HOST" '
    set -e
    sudo -n mkdir -p /srv/av-preview
    tmp=$(mktemp)
    for d in /srv/av-preview/*/; do
      [ -d "$d" ] || continue
      label=$(basename "$d")
      [ "$label" = "*" ] && continue
      printf "av-%s.orangesync.tech {\n\troot * %s\n\tencode gzip\n\tfile_server\n}\n\n" "$label" "$d"
    done > "$tmp"
    # install(1), NOT cp -a: cp -a preserves the mktemp 0600 mode, and the
    # caddy systemd unit adapts the config as the unprivileged caddy user -> the
    # reload dies with "permission denied" while caddy validate (run as root)
    # happily says "Valid configuration". Exactly that bit us on 2026-10-07.
    # NOTE: no apostrophes in this block - it lives inside a single-quoted ssh payload.
    sudo -n install -m 644 "$tmp" /etc/caddy/av-previews.caddy
    rm -f "$tmp"
    if ! sudo -n grep -qF "import av-previews.caddy" /etc/caddy/Caddyfile; then
      printf "\n# AV per-PR previews - GENERATED from /srv/av-preview/*\nimport av-previews.caddy\n" | sudo -n tee -a /etc/caddy/Caddyfile >/dev/null
    fi
    echo "--- generated sites ---"
    sudo -n grep -E "^av-.*orangesync" /etc/caddy/av-previews.caddy || echo "(none)"
    sudo -n caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
    if ! sudo -n systemctl reload caddy; then
      echo "ERROR: caddy reload FAILED - last journal lines:"
      sudo -n journalctl -u caddy -n 12 --no-pager | tail -12
      exit 1
    fi
    echo "caddy: $(systemctl is-active caddy)"
  '
}

if [ -n "$LIST" ]; then
  ssh $SSHOPT "$HOST" 'ls -1 /srv/av-preview 2>/dev/null || echo "(no previews)"'
  exit 0
fi

if [ -n "$TEARDOWN" ]; then
  echo "=== tearing down $TEARDOWN ==="
  ssh $SSHOPT "$HOST" "sudo -n rm -rf /srv/av-preview/$TEARDOWN && echo removed"
  sync_caddy
  exit 0
fi

[ -n "$PR" ] || [ -n "$LABEL_OVERRIDE" ] || { echo "need --pr N (or --label) and --branch B unless --build-dir"; exit 2; }
LABEL="${LABEL_OVERRIDE:-pr$PR}"

if [ -z "$BUILD_DIR" ]; then
  [ -n "$BRANCH" ] || { echo "--branch is required when building"; exit 2; }
  WT="$HOME/worktrees/av-$LABEL"
  echo "=== building $BRANCH into $WT ==="
  if [ ! -d "$WT" ]; then
    git -C "$REPO_ROOT" fetch fork "$BRANCH" -q
    git -C "$REPO_ROOT" worktree add --detach "$WT" FETCH_HEAD >/dev/null
  fi
  ( cd "$WT" && git fetch fork "$BRANCH" -q 2>/dev/null || true
    git checkout -q FETCH_HEAD 2>/dev/null || true )
  ( cd "$WT/web"
    [ -d node_modules ] || npm install
    unset VITE_BASE_PATH
    npm run build 2>&1 | tail -5 )
  BUILD_DIR="$WT/web/dist"
fi

[ -f "$BUILD_DIR/vote.html" ] || { echo "FATAL: no build at $BUILD_DIR"; exit 1; }

echo "=== shipping $LABEL ==="
ssh $SSHOPT "$HOST" "sudo -n mkdir -p /srv/av-preview/$LABEL && sudo -n chown debian:debian /srv/av-preview/$LABEL"
rsync -az --delete -e "ssh $SSHOPT" "$BUILD_DIR"/ "$HOST":/srv/av-preview/"$LABEL"/
echo "remote: $(ssh $SSHOPT "$HOST" "du -sh /srv/av-preview/$LABEL | cut -f1")"

sync_caddy

URL="https://av-$LABEL.orangesync.tech/"
printf 'preview: %s -> ' "$URL"
curl -4 -s -o /dev/null -w '%{http_code}\n' --max-time 40 "$URL" || echo ERR
