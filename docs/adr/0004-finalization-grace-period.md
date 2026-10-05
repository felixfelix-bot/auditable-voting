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
