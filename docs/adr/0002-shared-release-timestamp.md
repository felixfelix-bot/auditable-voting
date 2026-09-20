# ADR 0002 — Normalise the release timestamp (`created_at` and `submittedAt`)

- Status: Accepted
- Date: 2026-09-20
- Supersedes: none

## Context

A public blind-token response carries timing in two places:

1. the signed Nostr event `created_at`, and
2. the payload `submittedAt` field (also exported as `submitted_at` in the CSV
   result pack).

Changing only one still leaks per-voter time. A live observer can additionally
order events by relay arrival even when `created_at` is constant.

## Decision

For windowed rounds, every released submission is stamped with the shared
release timestamp:

- event `created_at = closeAt`
- payload `submittedAt = closeAt`
- the result pack's `submitted_at` is therefore the release time

The real submit time is retained only in browser-local state for recovery and is
never placed on the public record. Release is batched (ADR 0001) so arrival
order does not leak either.

## Consequences

- Positive: neither the signed event nor the payload nor the result pack reveals
  per-voter submission time in a windowed round.
- Neutral: duplicate-nullifier races are now ordered by event id rather than
  wall-clock arrival, which remains deterministic. This is documented in the
  protocol notes.
- Positive: re-publishing the same bound ballot yields the same event id, so
  release retries are idempotent for relays.
- Negative: client-side clocks are no longer authoritative for ordering; that
  was already true for canonical ordering, which uses signed event metadata.

## Alternatives considered

- **Randomise `created_at` within the window.** Rejected: preserves ordering
  information and is manipulable.
- **Fake a future timestamp and publish early.** Rejected: many relays reject
  `created_at` too far from now.
- **Normalise `created_at` only, publish immediately.** Rejected: relay arrival
  timing still leaks for a live observer.
