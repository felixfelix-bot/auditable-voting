# ADR 0005 — Client-side hold; accept lost votes if never reopened

- Status: Accepted
- Date: 2026-09-20
- Supersedes: none

## Context

Deferring publication can be implemented in several ways. The two main families
are:

1. **Client-side hold** — the voter's browser keeps the bound ballot and
   publishes it at release.
2. **Encrypted store-and-forward** — the ballot is published as ciphertext
   immediately and released by a key holder or threshold at the window close.

Option 2 removes the liveness dependency but introduces a party (or threshold)
that can release or tamper with ciphertexts, reintroducing a trust anchor the
project deliberately avoids.

## Decision

Use client-side hold. The bound submission and its per-submission response key
are stored in the voter's local election state (`pendingPublicReleases`). The
client releases on initialisation, focus/visibility/online, and a low-frequency
interval. If the voter never reopens before the grace expires, their vote is
lost.

## Consequences

- Positive: no new trusted party; the blind-signature trust model is unchanged.
- Positive: release reuses the existing anonymous submission path.
- Negative: votes are lost if the device is never reopened within the grace.
  This is an explicit, accepted trade-off.
- Neutral: an encrypted self-copy of the submission is written to the voter's own
  NIP-17 mailbox on submit, which aids recovery but is not a publication channel.

## Alternatives considered

- **Encrypted store-and-forward with a releaser.** Rejected for now: adds a
  trust anchor or a threshold-encryption research dependency; see also
  ADR 0007.
- **Server/worker holds the ballot.** Rejected: the worker would need the
  unblinded ballot, which is not available to it by design.
