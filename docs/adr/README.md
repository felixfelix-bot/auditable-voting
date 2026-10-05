# Architecture Decision Records — windowed publication

This directory records the decisions locked in for the timing-correlation
mitigation ("windowed publication"). Each ADR states the context, the decision,
and the consequences, including options that were rejected.

Problem statement: [../timing-correlation-problem.md](../timing-correlation-problem.md)

| ADR | Decision |
| --- | --- |
| [0001](0001-windowed-publication-mode.md) | Add an opt-in `windowed` publication mode |
| [0002](0002-shared-release-timestamp.md) | Normalise `created_at` and `submittedAt` to one release timestamp |
| [0003](0003-suppress-provisional-events-windowed.md) | Suppress provisional per-question events for windowed rounds |
| [0004](0004-finalization-grace-period.md) | Publish a bounded finalization grace period |
| [0005](0005-client-side-hold-lost-votes.md) | Hold ballots client-side and accept lost votes if never reopened |
| [0006](0006-coordinator-worker-hold-until-grace.md) | Coordinator and worker hold close/summary until the grace deadline |
| [0007](0007-defer-network-layer-anonymity.md) | Defer Dandelion/Tor origin-hiding to a later workstream |

Status values: **Accepted** (locked), **Proposed** (under review), **Rejected**.
