# ADR 0003 — Suppress provisional per-question events for windowed rounds

- Status: Accepted
- Date: 2026-09-20
- Supersedes: none

## Context

Provisional per-question response events (`questionnaire_response_provisional`,
kind `6427`) drive live charts. They are signed by the *same anonymous key* that
will sign the final `6424` submission for that credential, and are published per
question as the voter proceeds.

In a windowed round this re-introduces exactly the timing channel windowed
publication is meant to close: an observer can watch provisional events arrive
live, then match the eventual final ballot by author pubkey.

## Decision

Do not publish provisional events for windowed rounds. `publishProvisionalResponses`
returns early when the active definition is windowed. Live charts are therefore
not available during a windowed round; results appear at release.

## Consequences

- Positive: removes the live per-key timeline that would defeat ADR 0001.
- Negative: no live charts during windowed rounds. This is accepted and
  documented; live charts remain available for `immediate` rounds.
- Neutral: the provisional event kind and its validation remain for immediate
  rounds and backward compatibility.

## Alternatives considered

- **Batch provisional events with the final release.** Rejected: they still
  expose per-question progress and create extra publisher surface for little
  benefit once results are deferred anyway.
- **Keep provisional events but drop the shared key.** Rejected: they must be
  signed by some key; a separate key would still be linkable over time and adds
  protocol complexity.
