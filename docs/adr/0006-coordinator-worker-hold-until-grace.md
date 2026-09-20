# ADR 0006 — Coordinator and worker hold close/summary until the grace deadline

- Status: Accepted
- Date: 2026-09-20
- Supersedes: none

## Context

The grace period (ADR 0004) is only meaningful if the finality boundary is
respected. Once the organiser or a delegated audit proxy closes the
questionnaire or publishes a result summary, late releases are no longer
counted. The delegated worker currently closes and publishes a summary as soon
as the expected accepted count is reached.

## Decision

Both the browser coordinator and the delegated audit proxy must not close the
questionnaire or publish the final result summary before
`closeAt + finalizationGraceSeconds` for windowed definitions.

- Browser: the publish-results action refuses and reports the hold time.
- Worker: `windowed_grace_deadline(definition)` gates the completion action; the
  existing close grace (`COMPLETION_CLOSE_GRACE_SECS`) is preserved in addition.
- Client: a result summary signed before the deadline is treated as premature
  and ignored when selecting the latest published summary.

## Consequences

- Positive: late releases within the grace are counted before finality.
- Positive: observers can independently check the deadline from the signed
  definition.
- Neutral: `immediate` definitions are unaffected (deadline is `None`).
- Negative: the worker holds a completed election slightly longer.

## Alternatives considered

- **Enforce the hold only in the browser.** Rejected: delegated deployments run
  the worker as the completion path, so the gate must live there too.
- **No client-side premature check.** Rejected: cheap to add and protects
  observers against an early summary from any source.
