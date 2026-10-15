# PROGRESS — issue-12 release version bump (web/package.json)

Task: set the correct next release version for the auditable-voting issue-12
5-feature parallel-features release. **Version bump only — no feature code changes.**

Worktree: `/home/c03rad0r/worktrees/av-ver-bump-issue12`
Branch:   `worker-heavy/issue12-release-version-bump`
Base:     `fork/feat/issue12-consolidated` @ `a81512b`
NOTE: this branch already tracks an unrelated `PROGRESS.md` (B4 card, author
`b4/fail-closed-conditions`). That file was left UNTOUCHED; this card logs to the
task-suffixed file you are reading so no other worker's record is clobbered.

## Findings

1. Baseline: `web/package.json` version = **0.1.166**.
   Also embedded in `web/package-lock.json` at lines 3 and 9. → VERIFIED.
2. Plan line 711 pins the release tag: `git tag -a v0.2.0 -m "Multi-language, OTP
   admission, paper ballots, follow-up questions"` → target package version **0.2.0**.
   Unambiguous; two independent signals in the plan (P3-T2 tag name + the CHANGELOG
   practice of the package version matching the release).
3. Rationale for MINOR (not patch), evidence-based:
   - The 5 features are additive/backward-compatible, not fixes:
     F1 multi-language, F2 follow-up/conditional questions, F3 paper+manual ballots,
     F4 resident email OTP admission, F5 bright UI (plan §Phase 1).
   - CHANGELOG.md for 0.1.157–0.1.165 is exclusively `### Fixed` / `### Changed`
     patch-level entries (e.g. 0.1.165 "Bumped the web app package to 0.1.165").
     No 0.2.x entry exists yet → this is the first feature-level release.
   - Plan's own tag for this release is v0.2.0, i.e. the plan already asserts minor.
4. Root `package-lock.json` has **no top-level `"version"`** (name/deps only) and the
   base branch has no root `package.json` at all → nothing to sync there. → VERIFIED.
5. No `v0.2.0` tag exists (`git tag -l "v0.2*"` empty). Tagging is FORBIDDEN for this
   card; **no tag was created**. → VERIFIED
6. Base-branch choice: local `main` is 51 commits BEHIND origin/main and contains none
   of the issue-12 feature code; `origin/main` does NOT contain the 5 features.
   `fork/feat/issue12-consolidated` contains origin/main + 47 commits of issue-12
   integration work (incl. `5d7492c` cross-feature suites) and is 0 commits behind
   origin/main → the only correct release base. → VERIFIED

## Crash-recovery log (finding → status → files touched)

1. Read baseline + plan + CHANGELOG → VERIFIED. Files: read-only.
2. Confirmed minor/0.2.0 from plan line 711 → VERIFIED.
3. Surveyed all manifests for embedded version → root lockfile clean, web lockfile has 2 hits.
4. Created isolated worktree + branch off fork/feat/issue12-consolidated → VERIFIED.
5. `web/package.json` 0.1.166 → 0.2.0 (single line, formatting/key order preserved) → DONE.
6. `web/package-lock.json` both occurrences 0.1.166 → 0.2.0 → DONE.
7. Verification: JSON parses; versions read back 0.2.0; zero stale `0.1.166` outside
   node_modules/CHANGELOG history → DONE.
8. Discovered pre-existing tracked `PROGRESS.md` from the B4 card; restored it via
   `git checkout HEAD -- PROGRESS.md` so the diff contains ONLY the version files → DONE.

## Final status

- [x] baseline captured (0.1.166)
- [x] minor vs patch decided (minor → 0.2.0, plan line 711)
- [x] web/package.json bumped
- [x] web/package-lock.json bumped (2 occurrences)
- [x] no stale version remains in tracked sources
- [x] unrelated worker PROGRESS.md restored (diff scoped to version files only)
- [x] commit (no tag)
- [x] push to fork

## Files touched (final, committed)

- `web/package.json`
- `web/package-lock.json`
- `PROGRESS-issue12-release-version-bump.md` (this crash-recovery log)
- `REPORT-issue12-release-version-bump.md` (full report)
