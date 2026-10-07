# AV demo deploy — `*.orangesync.tech` role subdomains

Serves the consolidated AV build (the `pr/av-integration` merge of #25 + #27 + #28)
from four role-scoped subdomains so testers land straight in the right UI.

| URL | Serves | Role |
|---|---|---|
| `dashboard.orangesync.tech` | `/` — the role picker | choose any |
| `voter.orangesync.tech` | `/vote.html?role=voter` | voter |
| `coordinator.orangesync.tech` | `/dashboard.html?role=coordinator` | coordinator ("Organiser") |
| `results.orangesync.tech` | `/index.html?role=auditor` | auditor ("Observer") |

## Why subdomains need no DNS work

`*.orangesync.tech` is a wildcard on Cloudflare pointing at the box, so every
single-label name already resolves. Only a Caddy site block is required.

## Why redirects, not separate builds

All five HTML entry points render the same shell and differ only in
`initialRole`. The shell shows the role picker whenever the URL carries no
`?role=` (`web/src/SimpleAppShell.tsx`). So the role is pinned by the URL, per
subdomain — no app code change, no upstream impact, one build.

## Deploying

```bash
# 1. build the consolidated artifact (base path must be "/", not a Pages subpath)
cd web && npm run build            # -> web/dist

# 2. ship it and (re)install the Caddy block
infra/orangesync/deploy-demo.sh    # rsync + caddy validate + reload
```

The script: stages `web/dist`, rsyncs to `/srv/av-demo`, installs
`av-demo.caddy`, appends the import line **once**, runs
`caddy validate`, then reloads. It backs up the shared Caddyfile first.

## Verifying

```bash
node infra/orangesync/verify-subdomains.mjs
```

Loads all four hosts in headless Chromium and asserts each resolved URL, title,
and that the role-specific controls rendered — and reports any 4xx/5xx asset.

## Notes / known state

- `results.orangesync.tech` shows an empty auditor view until an election is
  supplied (`?q=<id>`); that is the expected empty state, not a fault.
- The auditor page logs one console error: `wss://relay.0xchat.com/` does not
  resolve (ERR_NAME_NOT_RESOLVED) — a dead default relay in the app, unrelated
  to this deploy, worth its own card.
- The box's `/` is ~93% full; the site is ~25 MB.
- Per-PR previews use `pr-preview.sh` (the market#1363 pattern, minus the ~90%
  that AV does not need): one static dir per preview under `/srv/av-preview/<label>`
  and one generated site block per dir in `/etc/caddy/av-previews.caddy`. No
  Docker, no port offsets, no wake-on-request manager, no Cloudflare API.
  `pr-preview.sh --help` for build/deploy/list/teardown.

## Currently deployed (2026-10-07)

- `dashboard` / `voter` / `coordinator` / `results` / `av-integrated`.orangesync.tech
  -> the **demo build**: trio (#25+#27+#28) **+ #30** (branding + light-default),
  branch `pr/av-demo` @ `17f52e9`. Light is the default on every entry *regardless
  of the OS colour scheme*, and the Auroville icon serves on all hosts.
- `av-pr25` / `av-pr27` / `av-pr28`.orangesync.tech -> each PR built from **its own
  ref** (distinct hashed bundle per preview), no branding.
- `av-integrated` deliberately matches the role subdomains; the per-PR previews are
  the PR-accurate ones. #29/#31 are CI/test-only so a preview would be identical to
  base; #30 is folded into the demo rather than previewed separately.

## Pitfalls (each one cost real time)

- **`cp -a` onto the Caddyfile breaks reload.** `cp -a` preserves the source mode;
  a `mktemp` file is `0600`, so the `caddy` systemd unit — which adapts the config
  as the *unprivileged* `caddy` user — dies with `permission denied`, while
  `sudo caddy validate` (running as **root**) cheerfully prints `Valid configuration`.
  Always `install -m 644` (or `chmod 644`) after writing a file under `/etc/caddy/`,
  and treat a reload failure as a hard error, not a warning.
- **No apostrophes inside a single-quoted `ssh '...'` payload.** A comment reading
  `mktemp's` silently terminated the quoted string and the script died later with
  `line 119: unexpected EOF while looking for matching '`. The *build* still
  succeeded, so the run looked half-successful while the deploy half never ran.
  Always `bash -n script.sh` after editing a shell script.
- **A build succeeding is not the deploy succeeding.** The per-PR loop printed
  three clean `✓ built in ...` lines and deployed nothing. Check the deployment
  artefact (the URL), never the build log, before reporting a preview as live.
- **`tls.obtain` failures in the journal are normal and non-fatal** — Caddy keeps
  serving. There are pre-existing Let's Encrypt rate-limit errors on this box for
  `proxy.sovereignengineering.io` / `contextvm.sovereignengineering.io`, unrelated
  to AV.
- Reload is atomic: if it fails, the previous config keeps serving, so a failed
  reload leaves the new site *absent* rather than taking the box down.
