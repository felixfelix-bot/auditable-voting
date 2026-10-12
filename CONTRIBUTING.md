# Contributing

Thanks for helping with Auditable Voting. This project is stateless, browser-first,
Nostr-native software; contributions are welcome from anyone, including first-time
external contributors.

## Before you open a pull request

- Confirm the web unit/component suite passes locally:
  ```bash
  cd web
  npx vitest run
  ```
- Keep changes focused and atomic. One concern per pull request, with a
  conventional commit message (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, ...).
- When you change protocol, relay, security, UX, or role behaviour, update the
  relevant documentation and presentation artefacts in the same pass (see
  `AGENTS.md`).

## CI on pull requests

Pull requests — **including from external contributors' forks** — automatically
run the web test suite via `.github/workflows/test.yml`. GitHub evaluates that
workflow against the **base branch** (`main`), so it applies to every PR that
targets `main`. A green run means the full vitest suite passes in a clean CI
environment.

**First-time contributors:** by default GitHub requires a maintainer to approve
the *first* workflow run for a brand-new contributor (a one-time review). After
that approval, subsequent PRs run CI automatically. If you are a first-time
contributor and see a waiting/"Approvals required" check, a maintainer has been
notified — it resolves once approved.

**What CI runs:**
- `Web unit tests (vitest)` — the full `web/` suite (Rust-wasm rebuild included).
  This is the required gate; a PR should be green before merge.

**Email dependency (optional, separate):** `.github/workflows/email-smoke.yml`
runs an offline, deterministic regression net for the coordinator OTP email
sender on every PR (no network, no secrets). The *live* real-cashu.email send is
**not** run on pull requests — it runs on a daily schedule, on merge to `main`,
and via manual dispatch, so it never exposes secrets to (or spends postage for)
fork PRs.

## Security note for maintainers

Workflows use `on: pull_request`, never `pull_request_target`. Fork-PR runs get a
read-only `GITHUB_TOKEN` and **no repository secrets** — this is intentional and
must not be relaxed. Do not introduce `pull_request_target` or add secrets to
the `pull_request` workflow.
