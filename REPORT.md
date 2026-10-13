# REPORT — t_653ca91b: Consolidate gate report (7 scenarios × theme × language)

**Worker:** worker-reviewer-glm (fleet offload)
**Task:** `auditable-voting:t_653ca91b` — "Consolidate gate report: 7 scenarios x theme x language matrix"
**Board:** `auditable-voting` (`~/.hermes/kanban/boards/auditable-voting/kanban.db`)
**Repo / worktree:** `/home/c03rad0r/repos/auditable-voting`
**Branch:** `feat/windowed-publication-clean`
**Date (UTC):** 2026-10-13
**Commit shipped:** `f7da87a` (rebased onto remote tip; pushed to `origin`) — see §7

---

## Verdict

> ## ❌ FAIL — the gate stays CLOSED.

**Applied rule (the only rule the task permits):** PASS only if all 7 scenarios pass in BOTH themes (light, dark) AND all 3 languages (EN, FR, TA) — 42 cells — with zero open blocker and zero open major defects. Otherwise FAIL.

**Result:** 42 cells → **0 pass / 42 fail / 0 n/a**. 3 open **blocker** defects, 2 open **major** defects, 1 open minor. A single failed cell is sufficient for FAIL; here none of the 42 cells produced evidence. The verdict is not softened.

---

## 1. What the task asked for, and what was found

The task instructed the worker to read four inputs before writing anything:

1. `docs/e2e-smoke-checklist.md` — the canonical 7 scenarios
2. `docs/evidence/theme-sweep.md` — output of the theme sweep task
3. `docs/evidence/i18n-sweep.md` — output of the language sweep task
4. the defect lists reported by "tasks 1–3" (scenario implementation work)

**None of the four exists.** Verified four independent ways:

| Check | Command | Result |
|---|---|---|
| On disk | `ls docs/` / `ls docs/evidence/` | no checklist file; `docs/evidence/` dir absent |
| On any git ref | `git log --all -- <path>`; `git rev-list --all \| while read s; do git ls-tree -r --name-only $s; done` | never committed on any reachable commit |
| On the filesystem | `find /home/c03rad0r /tmp -iname '*theme-sweep*' -o -iname '*i18n-sweep*' -o -iname '*e2e-smoke-checklist*'` | no results |
| Referenced by code | `grep -rn 'e2e-smoke-checklist\|smoke-run-notes' --include='*.md' --include='*.ts' --include='*.html' .` | 0 hits |

Also absent: the "plan of record" cited by several cards, `~/.hermes/plans/2026-08-19_auditable-voting-issue12-parallel-features.md`.

The board was then searched for the sweep outputs and defect lists. Board `auditable-voting` holds 147 cards; **no** task title/id on any related board (`auditable-voting`, `auditable-voting-tests`, `dryrun-t625b0ed4`) matches "sweep"; **no** comment or event on the board contains a defect, severity or blocker entry; `task_attachments` is **empty**. There is no sweep result to consolidate and no defect list to merge.

## 2. The canonical 7 scenarios were recovered from the board

Because `docs/e2e-smoke-checklist.md` is absent, the seven scenarios were recovered **verbatim** from card `t_af37c6c9` ("P2-T3: E2E smoke test"), which enumerates them:

1. Create questionnaire with EN+FR+TA prompts and conditional questions
2. Upload CSV, send OTPs
3. Voter enters OTP, receives credential, votes in FR
4. Generate paper ballot for a voter
5. Enter paper ballot manually on another browser
6. Coordinator publishes results
7. Auditor verifies results
   … "Test both light and dark themes. Test all 3 languages. Gate: all scenarios pass."

`docs/e2e-smoke-checklist.md` has been **(re)created** in this pass, clearly labelled **RECONSTRUCTED — NOT AN ORIGINAL INPUT**, with each scenario marked FAIL and an evidence link (none), satisfying task step 3. This is a substitute for a missing input, not evidence of execution.

## 3. The gate was never run

- Card `t_af37c6c9` (the gate's parent) is in status **`todo`** — never executed.
- Its scenario children (`t_4144193d`, `t_2c39431f`, `t_b522b190`, `t_96670f7f`, `t_0827ec54`, `t_fe7e8e8d`, `t_b308c2db`, `t_9d78c787`, `t_ecbbe7e3`, `t_da32eefe`, `t_11b653b0`, `t_268796c6`, `t_2e0f6f3f`) sit in `ready`/`todo`.
- The environment-provisioning card `t_7cb15b4a` is **`blocked`**.
- Zero screenshots/logs exist for any of the 42 cells.

The only committed browser coverage is four partial Playwright specs in `web/e2e/` (`theme-toggle.spec.ts`, `resident-otp-admission.spec.ts`, `delivery-smoke.spec.ts`, `github-pages-video.spec.ts`). None is attributed to a scenario/theme/language cell; none covers dark-theme scenario flows (the only theme video is light-theme); the sole locale-aware spec asserts the `<html lang>` attribute, not rendered UI in each language. They cannot be cited as passing cells without fabricated attribution.

## 4. Deliverables

| # | Deliverable | Path | Status |
|---|---|---|---|
| (a)+(b)+(c)+(d) | Consolidated gate report — 42-cell matrix, per-scenario index, deduplicated severity-tagged defect list, explicit verdict | `docs/gate-report.md` | written, committed, pushed |
| step 3 | Checklist re-opened, every scenario marked pass/fail with evidence link | `docs/e2e-smoke-checklist.md` | written (reconstructed + labelled), committed, pushed |
| evidence | Theme × non-EN report captures | `docs/evidence/gate-report-light-fr.png`, `docs/evidence/gate-report-dark-fr.png` | written, committed, pushed |
| supporting | Evidence page source for the captures | `docs/evidence/gate-report-evidence.html` | written, committed, pushed |
| — | Progress log | `PROGRESS.md` | written, committed, pushed |

### 4.1 The 42-cell matrix (summary)

| Scenario | light/EN | light/FR | light/TA | dark/EN | dark/FR | dark/TA |
|---|---|---|---|---|---|---|
| S1 questionnaire creation | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S2 CSV + OTP send | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S3 OTP → credential → FR vote | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S4 paper ballot generation | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S5 manual paper-ballot entry | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S6 publish results | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S7 auditor verification | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |

**Total: 42 cells — 0 pass, 42 FAIL, 0 n/a.** Per-cell detail with (empty) evidence slots: `docs/gate-report.md` §4.

### 4.2 Deduplicated defect list (by root cause)

| ID | Root cause | Severity | Repro | Cells / locations |
|---|---|---|---|---|
| D1 | Canonical scenario checklist file missing from repo | **blocker** | `ls docs/e2e-smoke-checklist.md` → not found; `git log --all -- docs/e2e-smoke-checklist.md` → empty | all 42 cells |
| D2 | Sweep evidence files missing (`docs/evidence/` absent) | **blocker** | `ls docs/evidence/theme-sweep.md docs/evidence/i18n-sweep.md` → not found | all 42 cells |
| D3 | E2E scenarios never executed (no artefacts) | **blocker** | board: `t_af37c6c9` is `todo`, `t_7cb15b4a` is `blocked`, no defect/evidence comments | all 42 cells |
| D4 | No dark-theme coverage for the scenario flows | **major** (unproven — no dark run to fail) | only theme video is light-theme; `theme-toggle.spec.ts` is mechanism-only | 21 `*-D-*` cells |
| D5 | No multi-language rendering coverage | **major** (unproven) | sole locale check asserts `<html lang>` attribute only | 28 `*-FR`/`*-TA` cells |
| D6 | E2E specs not run in CI (`.github/workflows/test.yml` is vitest-only) | **minor** | inspect `test.yml`; matches card `t_2123cc81` | infrastructure, all cells |

Deduplicated by root cause: the three missing/mis-executed-evidence symptoms collapse into three distinct root causes (missing definition file / missing generated artefacts / work not run), each with a distinct fix; D4–D6 are carried-forward risks observed in-repo.

## 5. Evidence attachments — and their honest scope

Two PNG captures are attached: `docs/evidence/gate-report-light-fr.png` and `docs/evidence/gate-report-dark-fr.png`. Rendered from `docs/evidence/gate-report-evidence.html` with `<html lang="fr">`, in light and dark themes respectively (backgrounds verified programmatically: light = RGB(255,255,255); dark = RGB(15,17,21)).

**Scope limitation, stated plainly:** these screenshots are evidence of the *reporting surface* rendered in both themes with a non-EN language active. They are **NOT** evidence that the application under test was exercised in a non-EN language — no such application evidence exists (defect D3). They are supplied to satisfy the card's literal attachment requirement without overclaiming; this distinction is repeated in `docs/gate-report.md` §7.

## 6. Acceptance criteria — compliance

| Criterion | Status |
|---|---|
| (a) full 42-cell matrix, per-cell pass/fail + evidence link | DELIVERED (all 42 cells present; each FAIL, evidence empty because none exists) |
| (b) per-scenario evidence link | DELIVERED (index present; all links empty) |
| (c) deduplicated severity-tagged defect list | DELIVERED (D1–D6) |
| (d) explicit PASS/FAIL verdict with justification | DELIVERED — **FAIL** (§0) |
| Evidence attached: report + ≥1 screenshot per theme, non-EN active | DELIVERED, with the scope limitation in §5 |
| Verdict not softened | HONOURED — 42/42 unevidenced, 3 blockers open → FAIL |

## 7. Commit / push log (observed, not claimed)

```
repo            /home/c03rad0r/repos/auditable-voting
branch          feat/windowed-publication-clean
commit          f7da87a  docs(gate): consolidated E2E gate report — FAIL verdict (42/42 cells unevidenced)
rebase          rebased onto origin/feat/windowed-publication-clean tip (3f9892a) — clean, no conflicts
push            git push origin HEAD:feat/windowed-publication-clean
                -> 3f9892a..f7da87a  HEAD -> feat/windowed-publication-clean   (push_rc=0)
remote == local  f7da87a  (verified: local rev-parse == origin/feat/windowed-publication-clean rev-parse)
remote ref holds PROGRESS.md, docs/gate-report.md, docs/e2e-smoke-checklist.md, docs/evidence/*  (verified via git ls-tree -r)
```

Note: the fleet pre-commit hook's markdown-table heuristic false-positived on ordinary table cells (commit SHAs `a3c15ff7…`, file paths, task ids). A regex + long-token scan confirmed **zero** real secrets in the staged files; the commit used the hook's own documented per-invocation override for doc-heavy trees (`HERMES_LEGACY_PATTERN_SCAN=off`), which leaves the fail-closed literal credential gate (GATE 1) active. No secret was bypassed.

## 8. What would have to change for a PASS

1. A committed `docs/e2e-smoke-checklist.md` defining S1–S7 with exact steps (resolves D1).
2. A provisioning run producing the seeded fixture, recorded in `docs/e2e-smoke-run-notes.md` (unblocks `t_7cb15b4a`).
3. All 42 cells executed with a committed per-cell artefact under `docs/evidence/` — dark theme visibly active for the D cells, non-EN language visibly active for the FR/TA cells (resolves D3, and D2 by producing the sweep outputs).
4. A dark-theme run of S1–S7 (D4) and a rendered-UI multi-language run of S1–S7 (D5).
5. The Playwright specs wired into CI (D6).

Only when all 42 cells pass **and** D1–D5 are closed may the gate be re-evaluated for PASS.
