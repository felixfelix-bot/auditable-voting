# E2E smoke checklist — auditable-voting

> **STATUS: RECONSTRUCTED — NOT AN ORIGINAL INPUT.** This file was **absent** from the repository (no copy on any git ref) when the gate-consolidation task `t_653ca91b` ran. It has been reconstructed in the consolidation pass solely so the scenario set the gate depends on is durable. The seven scenarios below are recovered **verbatim** from board card `t_af37c6c9` ("P2-T3: E2E smoke test"), which enumerates them. No scenario in this file has been executed. See `docs/gate-report.md` §2.3 and defect **D1**.

**Gate rule (only rule):** PASS only if all 7 scenarios pass in BOTH themes (light, dark) AND all 3 languages (EN, FR, TA) — 42 cells — with zero open blocker and zero open major defects. Otherwise FAIL.

**Evidence convention:** each scenario/theme/language cell must cite a committed artefact under `docs/evidence/` (screenshot or log). A cell with no artefact is **FAIL**, never "pass by default".

---

## Scenario status (current run: `t_653ca91b`)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| S1 | Create questionnaire with EN+FR+TA prompts and conditional questions | **FAIL — not exercised** | none |
| S2 | Upload CSV, send OTPs | **FAIL — not exercised** | none |
| S3 | Voter enters OTP, receives credential, votes in FR | **FAIL — not exercised** | none |
| S4 | Generate paper ballot for a voter | **FAIL — not exercised** | none |
| S5 | Enter paper ballot manually on another browser | **FAIL — not exercised** | none |
| S6 | Coordinator publishes results | **FAIL — not exercised** | none |
| S7 | Auditor verifies results | **FAIL — not exercised** | none |

All seven are FAIL because the E2E environment was never provisioned (`t_7cb15b4a` blocked) and no scenario was executed (`t_af37c6c9` still `todo`). See `docs/gate-report.md` for the full 42-cell matrix and the deduplicated defect list.

---

## Scenario definitions

### S1 — Create questionnaire with EN+FR+TA prompts and conditional questions
As coordinator, create a questionnaire whose prompts are authored in English, French and Tamil, including at least one conditional question (question B shown only when question A has a specific answer). Verify each conditional branch renders and toggles correctly in all 3 languages, in both themes.
**Acceptance:** questionnaire saves and re-opens without data loss; conditionals toggle correctly in EN/FR/TA; both themes consistent.
**Evidence:** screenshots of the saved questionnaire in each language, plus the conditional toggle in each language × theme.

### S2 — Upload CSV, send OTPs
Upload the voter CSV fixture via the admin UI; confirm import validation (row count, duplicate/invalid row handling). Trigger the OTP send run and confirm delivery status is recorded for every voter.
**Acceptance:** import completes; valid voters appear in the roster; duplicate/invalid rows reported as designed; all CSV voters show OTP-sent.
**Evidence:** import summary screenshot, roster entry, OTP send summary.

### S3 — Voter enters OTP, receives credential, votes in FR
As a test voter in a fresh browser profile, enter the OTP, receive the voting credential, and cast a vote in French including at least one answer that triggers a conditional question. Attempt a second vote with the same credential and confirm it is rejected.
**Acceptance:** credential issued on correct OTP and persisted across reload; FR vote recorded with conditionals handled; double-vote blocked with a clear error; vote not visible pre-publication.
**Evidence:** screenshots of OTP entry, credential issuance, FR vote submission, receipt/vote state, and the rejection.

### S4 — Generate paper ballot for a voter
As coordinator, generate a paper ballot for a specific known voter and export/print it. Verify the artefact contains the ballot identifier, the correct contest, and the scannable **and** manually-enterable code, with **no plaintext credential or secret** leaked anywhere in the artefact or its metadata.
**Acceptance:** paper ballot exists on disk; all required elements present and evidenced; no secret leak.
**Evidence:** artefact path + inspection log; the exact ballot code recorded.

### S5 — Enter paper ballot manually on another browser
In a browser session provably independent from S3 (different profile/user-data-dir or browser binary), open the manual-entry screen and enter the paper ballot code exactly as printed. Confirm acceptance, attribution to the correct voter and contest, and that the count/state increments by exactly one.
**Acceptance:** entry accepted from the second session; attributed correctly; count incremented by exactly one; sessions provably independent.
**Evidence:** screenshots of entry form, confirmation, attribution view, before/after counts, and both sessions' cookie/storage listings.

### S6 — Coordinator publishes results
Confirm the online (S3) and paper (S5) votes are present before publishing. As coordinator, publish results and capture the published tally plus every published artefact (hashes, verifier input files, receipts), persisted with SHA-256 hashes for frozen reuse by S7. Public results must become visible only after publication.
**Acceptance:** publish completes without error; artefacts saved to named paths with hashes; published tally sums correctly and reconciles with the cast votes.
**Evidence:** publish command + output, artefact paths with hashes, tally breakdown, cast-vote vs published-tally reconciliation table.

### S7 — Auditor verifies results
As auditor, re-hash the published artefacts and confirm they match the published hashes; run the independent verification process on the frozen artefact set and confirm it returns PASS. Negative check: alter exactly one artefact and confirm verification fails loudly with a non-zero exit status and a clear, attributable error (no silent pass).
**Acceptance:** hashes match; independent verification passes on clean data; verification fails loudly on tampered data; tally reconciles with cast votes.
**Evidence:** hash comparison output, verifier PASS output, tampered-set failing output + exit code, reconciliation table.

---

## Matrix (7 × 2 × 3 = 42 cells)

| Scenario | light/EN | light/FR | light/TA | dark/EN | dark/FR | dark/TA |
|---|---|---|---|---|---|---|
| S1 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S2 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S3 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S4 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S5 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S6 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| S7 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |

Full per-cell detail with evidence links: `docs/gate-report.md` §4.
