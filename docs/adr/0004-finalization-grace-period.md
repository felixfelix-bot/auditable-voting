# ADR 0004 — Bounded finalization grace period

- Status: Accepted
- Date: 2026-09-20
- Supersedes: none

## Context

A client can only release a held ballot while it is running. If a voter closes
the browser before `closeAt` and reopens after it, the ballot is released late.
If the coordinator finalises results at `closeAt` exactly, those late releases
would be valid events that are silently excluded from the tally.

At the same time, results cannot be deferred indefinitely.

## Decision

Publish a `finalizationGraceSeconds` value in the windowed definition. A release
is accepted during `[closeAt, closeAt + finalizationGraceSeconds)`. The value is
signed in the definition, bounded to `0`–`2_592_000` seconds (30 days), and
required for windowed rounds. After the grace, a still-pending release is
dropped as missed.

## Consequences

- Positive: voters who reopen shortly after close are not silently
  disenfranchised.
- Positive: the grace is verifiable because it is part of the signed definition.
- Negative: results are delayed by the configured grace. Operators should choose
  the smallest grace that covers realistic reopen behaviour.
- Negative: a malicious client can still publish a normal-timestamp event
  outside a grace; that is the baseline assumption for all modes.
- Neutral: `0` is a valid value for operators who prefer immediate finalisation
  and accept that late reopens are excluded.

## Alternatives considered

- **No grace; accept that late releases are dropped.** Consistent with the
  client-side-hold trade-off (ADR 0005) but silently discards genuine reopen
  ballots. Rejected in favour of an explicit, configurable grace.
- **Unbounded grace until the coordinator closes manually.** Rejected: no
  verifiable upper bound for observers.

## Amendment — editorial correction to the accepted range (2026-10-06, head `3f9892a`)

The shipped validator requires a **positive** grace for a windowed definition:
`finalizationGraceSeconds` must be an integer with `0 < grace <= 2_592_000`
(`web/src/questionnaireProtocol.ts:705-716`, covered by
`web/src/questionnaireProtocol.test.ts:85-108`), and a grace carried by a
non-windowed definition is rejected as `finalization_grace_seconds_unexpected`
(`:714-716`). The `Neutral` bullet above ("`0` is a valid value for operators") and
the `0`-lower-bound in the Decision therefore no longer describe the shipped web
client; the accepted range is `(0, 2_592_000]`, and the validator — not this ADR —
is what a reader should trust for it.

No decision changes: this amendment only removes a claim that is no longer true.
Note that the definition-level `questionnaireGraceUntil` still degrades a
non-positive grace to `releaseAt + 0` (`:420-429`); callers that need fail-closed
semantics use the policy-level twin instead.

