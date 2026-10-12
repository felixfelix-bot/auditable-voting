# ADR 0001 — Opt-in `windowed` publication mode

- Status: Accepted
- Date: 2026-09-20
- Supersedes: none

## Context

Blind signatures unlink the issuance of a credential from the final public
ballot, so an issuer cannot learn *how* a voter voted. They do not hide *when* a
voter voted. A public blind-token submission carries a signed `created_at` and
is published the moment the voter submits. An observer who also knows when a
voter was admitted (for example, from OTP delivery) can re-link the two by
timing alone. The effect is strongest in small electorates.

The default (`immediate`) behaviour is used by existing deployments and must
keep working unchanged.

## Decision

Add an opt-in field to the questionnaire definition:

```json
{ "publicationMode": "windowed", "finalizationGraceSeconds": 86400 }
```

- `publicationMode` accepts `"immediate"` (default) or `"windowed"`.
- In `windowed` mode the client binds the ballot on submit, holds it locally,
  and releases all held ballots in a single slot at `closeAt`.
- `finalizationGraceSeconds` is required for `windowed` (integer, `0`–`2_592_000`)
  and must be absent for `immediate`.
- Missing `publicationMode` is treated as `immediate` for backward compatibility.

## Consequences

- Positive: the public record no longer exposes per-voter submission time for
  windowed rounds; the anonymity set becomes the whole election window.
- Positive: no change to the blind-signature proof, verification, or tally.
- Negative: windowed rounds lose live results until the release slot.
- Negative: more client state (pending releases) and a release scheduler.
- Negative: enforceability depends on the shipped client behaving.

## Alternatives considered

- **Always windowed, no flag.** Rejected: breaks existing deployments and the
  live-chart product behaviour without consent.
- **Per-voter random delay before publishing.** Rejected: a delay still leaves
  ordering information and does not guarantee a shared anonymity set.
- **No change, document the risk only.** Rejected: the leak is straightforward
  to exploit in the project's target small-electorate pilots.
