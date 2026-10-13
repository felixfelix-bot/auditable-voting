# PROGRESS — B4: fail-closed questionnaire condition evaluation + read-path validation

Branch: `b4/fail-closed-conditions` (worktree `/home/c03rad0r/worktrees/t_24fbb0e0`),
based on and pushing to `origin/feat/issue12-consolidated` (fork
`felixfelix-bot/auditable-voting`, PR #9; upstream `tidley/auditable-voting` is
read-only and is never pushed to).

## Precondition check (before any edits)

- `B2` `91cf8ac` and `B3` `131abf5` are BOTH ancestors of
  `origin/feat/issue12-consolidated` @ `fe1f782` → F1F2 dependency card LANDED. OK.
- A PARTIAL B4 commit `3cf36b0` ("fix(questionnaire): fail closed on a hostile
  definition (B4)") was ALREADY on the branch: it made `shouldShowQuestion`
  return `false` on a cycle, and rewrote the old "throws" test.
  What was still MISSING vs. this card: the `invalid_questionnaire` reporting
  and the READ-PATH validation (ingest + cache). This card supplies those.

## Crash-recovery log (finding → status → files touched)

1. **Baseline suite is NOT green in a fresh worktree (pre-existing, unrelated)**
   → VERIFIED. `npx vitest run` @ `fe1f782` = **8 files failed | 78 passed (86)**,
   **65 failed | 761 passed (826)**, all `Cannot find module
   '/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core'`.
   Cause: `web/src/wasm/*/pkg/` is gitignored, so a fresh worktree has no wasm.
   Fix for measurement only: built it in-tree with `wasm-pack` (2m30s, exit 0).
   Raw log: `.b4logs/baseline-suite.log`.

2. **TDD gate 1 — RED observed BEFORE any implementation edit** → VERIFIED.
   Rewrote `questionConditionEvaluator.test.ts:221-229` (the old "throws
   `CircularDependencyError`" assertion) plus two new test files.
   `npx vitest run` on the 3 files: **3 failed | 14 failed | 21 passed (35)**,
   e.g. `TypeError: evaluateQuestionVisibility is not a function`,
   `(0, __vite_ssr_import_1__.checkForCycle) is not a function`.
   Raw log: `.b4logs/red-1.log`. Implementation was written ONLY after this.

3. **Fail-closed + reporting landed** → GREEN.
   `shouldShowQuestion` is now a thin wrapper over the new
   `evaluateQuestionVisibility`, which catches the cycle and returns
   `{ visible: false, invalidQuestionnaire: true, errors: ["invalid_questionnaire:…"] }`.
   `checkForCycle` is EXPORTED and still throws `CircularDependencyError`, so
   definition-time validation keeps rejecting hostile graphs explicitly.
   Files: `web/src/questionConditionEvaluator.ts`.

4. **Read-path validation landed (ingest + cache)** → GREEN.
   - `questionnaireNostr.ts`: new `parseQuestionnaireDefinitionEventWithValidation`
     (returns `{definition, valid, invalidQuestionnaire, errorCode, errors}`),
     `isQuestionnaireDefinitionValidForRead`, `selectValidatedQuestionnaireDefinitions`.
     The legacy `parseQuestionnaireDefinitionEvent` now delegates and returns
     `.definition`, so no caller signature changed.
   - `questionnaireDefinitionCache.ts`: new
     `storeCachedQuestionnaireDefinitionWithValidation` /
     `readCachedQuestionnaireDefinitionWithValidation`; the legacy accessors
     delegate and keep their exact old return types.
   - `questionnaireProtocol.ts`: `INVALID_QUESTIONNAIRE_CODE` exported; the
     existing `validateQuestionnaireDefinition` now also reports
     `invalid_questionnaire:circular_show_if:<id>` for a cyclic graph
     (coordinator semantics otherwise untouched).

5. **Coordinator-side semantics intact** → VERIFIED. Targeted run over the 8
   affected files: **8 passed | 98 passed (98)**, EXIT=0, including
   `questionnaireProtocol.test.ts` (all `show_if_*` coordinator assertions).
   Raw log: `.b4logs/green-4.log`.

## Commit / push log (observed)

- (this commit) `fix(questionnaire): fail closed on hostile definitions and
  validate the read path (B4)` — see log below for the observed push.

## Status: IN PROGRESS
Remaining: voter-panel surfacing of `invalid_questionnaire`, full suite, coverage
threshold file, `tsc`/`build`, push, `REPORT.md`.

## Uncommitted-work guard

`.b4logs/` holds raw evidence and is intentionally NOT committed (gitignored as
worker scratch); every quoted figure above is reproducible from it.
