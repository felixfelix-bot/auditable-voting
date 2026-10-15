# REPORT — issue-12 release version bump (auditable-voting)

**Task:** set the correct next release version in `web/package.json` for the
auditable-voting issue-12 five-feature parallel-features release.
Release-prep only — **version bump only, no feature code changes.**

**Outcome:** DONE. `0.1.166` → **`0.2.0`** (minor). Committed and pushed. No tag created.

---

## 1. Answer summary

| Item | Value |
|---|---|
| Old version | `0.1.166` |
| New version | `0.2.0` |
| Bump type | **minor** |
| Commit SHA | `39ababe875127992385998f9122ef67baa14d3b7` (`39ababe`) |
| Tag created? | **NO** — explicitly none. No `git tag` / `npm version` was run. |
| Branch | `worker-heavy/issue12-release-version-bump` |
| Base | `fork/feat/issue12-consolidated` @ `a81512b` |
| Remote | pushed to `fork` (`felixfelix-bot/auditable-voting`), ref verified |

## 2. Rationale for minor (not patch)

Two independent, unambiguous signals in the plan:

1. **The plan pins the tag itself.** `~/.hermes/plans/2026-08-19_auditable-voting-issue12-parallel-features.md`
   line 711:
   `1. Tag release: git tag -a v0.2.0 -m "Multi-language, OTP admission, paper ballots, follow-up questions"`
   A pinned `v0.2.0` release tag for this work makes the target package version `0.2.0`.
2. **The change set is additive, not corrective.** The 5 features (plan §Phase 1) are
   F1 multi-language (EN/FR/TA), F2 follow-up/conditional questions, F3 paper + manual
   ballots, F4 resident email OTP admission, F5 bright UI. These add capability without
   breaking the existing protocol path (the plan documents the backward-compatibility
   mechanism: `resolveLocalised()` accepts both `string` and `LocalisedText`; string
   prompts are normalised on parse).
3. **Repo convention confirms the boundary.** `CHANGELOG.md` entries for
   `0.1.157`–`0.1.165` are exclusively `### Fixed` / `### Changed` patch-level items
   (e.g. `0.1.165` — "Bumped the web app package to 0.1.165"). There is **no `0.2.x`
   entry** yet, so this is the first feature-level release. `git tag -l "v0.2*"` is empty.

Semver-correct and consistent with the plan: additive feature release ⇒ MINOR ⇒ `0.2.0`.

**Not ambiguous** — no guess was required, so no block was raised.

## 3. Files changed

| File | Change |
|---|---|
| `web/package.json` | `"version": "0.1.166"` → `"version": "0.2.0"` (line 4) |
| `web/package-lock.json` | both embedded occurrences `0.1.166` → `0.2.0` (line 3 top-level, line 9 `packages[""]`) |

Formatting, indentation and key order preserved — each change is a single-line value
substitution; no other field was touched.

**Manifests checked, no change needed:**
- Root `package-lock.json` — has **no** top-level `"version"` field (name + deps only).
- No root `package.json` exists (on this base branch or in the repo).
- `web/package.json` is the only `package.json` outside `node_modules`.
- Grep for `0.1.166` across tracked sources (excluding `node_modules`/`.git`/CHANGELOG
  history) returns **zero** hits ⇒ no stale version remains.

## 4. Verification actually performed (observed, not assumed)

- `node -e` parsed both files and read the versions back:
  `package.json version = 0.2.0`, `lockfile top version = 0.2.0`, `packages[""] version = 0.2.0`
  — i.e. both files are still valid JSON and carry the new version. Exit 0.
- `git show --stat HEAD` — commit touches **only** `web/package.json` and
  `web/package-lock.json` (2 files, 3 insertions, 3 deletions). No unrelated edits.
- `git tag -l "v0.2*"` and `git tag --points-at HEAD` — both **empty** ⇒ no tag created.
- `git ls-remote fork refs/heads/worker-heavy/issue12-release-version-bump` returned
  `39ababe875127992385998f9122ef67baa14d3b7`, identical to local `git rev-parse HEAD`
  ⇒ the push is confirmed on the remote.

**Not run:** the full `vitest` suite. The change is a version-string substitution with no
code path touching it, and per the branch's existing `PROGRESS.md` (B4 card) a fresh
worktree needs a `wasm-pack` build (~2m30s) before the suite can even run. The cheap
verification above proves the deliverable; I am flagging the omission rather than
claiming a test run I did not perform.

## 5. Base-branch decision (worth noting for the release)

The task's stated workspace `/home/c03rad0r/repos/auditable-voting` sits on `main`,
which is **51 commits behind `origin/main`** and contains **none** of the issue-12
feature code. `origin/main` itself does **not** contain the 5 features either
(verified: no i18n/paper-ballot/OTP modules present).

The only branch carrying `origin/main` + the issue-12 integration work is
`fork/feat/issue12-consolidated` (`a81512b`; 47 commits ahead of `origin/main`,
0 behind, includes `5d7492c` cross-feature integration suites). The bump was therefore
made off that branch, in an isolated worktree at
`/home/c03rad0r/worktrees/av-ver-bump-issue12`.

**Implication for Felix:** this bump is on top of the consolidated branch, not on
`main`. It will reach `main`/the release only when the issue-12 integration lands.

## 6. Safety / housekeeping

- **No tag created**, and no `git tag` / `npm version` command was invoked, per the task
  constraint that Felix tags manually.
- The base branch already tracks an unrelated `PROGRESS.md` belonging to another
  worker's card (B4, `b4/fail-closed-conditions`). My first write overwrote it; I
  detected this, restored it with `git checkout HEAD -- PROGRESS.md`, and moved my own
  notes to task-suffixed files. The B4 record is intact and is **not** in my diff.
- Crash-recovery log: `PROGRESS-issue12-release-version-bump.md` (in the worktree,
  committed).

## 7. Residual / remaining work (for the release owner)

This card is complete. Remaining release steps are Felix's, by design:

1. Create and push the `v0.2.0` tag (tagging is Felix-only).
2. Create the GitHub release notes summarising the 5 features (plan P3-T2 step 3).
3. Confirm the issue-12 integration branch itself has landed on `main` before the tag
   points at it.
