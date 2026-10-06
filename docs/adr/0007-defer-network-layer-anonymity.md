# ADR 0007 — Defer network-layer anonymity (Dandelion / Tor) to a later workstream

- Status: Accepted
- Date: 2026-09-20
- Supersedes: none

## Context

Windowed publication closes the *application-layer* timing channel: the public
event timestamp and arrival order. It does not hide *network-layer* metadata —
which IP or connection published an event, and when a relay saw it.

A Dandelion-style stem/fluff relay or an anonymity transport such as Tor could
hide origin. However, a first-hop peer that receives a ballot over an identified
channel learns identity-to-ballot, so the benefit depends on an anonymous first
hop. In a small electorate, peers are few and collusion is easy; a badly
designed stem phase can *reduce* privacy by adding a party that sees the link.

## Decision

Do not include peer-relay or mixnet origin-hiding in this change. Treat it as a
separate, later, optional network-layer workstream. Document network metadata as
a residual risk of the current design.

## Consequences

- Positive: keeps this change focused and auditable; no new peer trust
  assumptions.
- Positive: windowed publication is a strict improvement regardless of transport.
- Negative: relays and network observers can still correlate origin/IP with an
  event. Operators wanting stronger protection must add Tor or a mixnet
  externally.
- Negative: a future workstream will need its own design and review.

## Alternatives considered

- **Bundle a stem-phase relay into this change.** Rejected: large surface,
  unclear threat benefit for small electorates, and risk of a new trusted party.
- **Require Tor transport.** Rejected as a hard requirement: adds operational
  burden and is out of scope for a browser-first static client.

## Amendment — the tardy-tail anonymity set (2026-10-06, head `3f9892a`)

The review of PR #28 asked what set a *late* vote actually hides in, and what
happens to that set as the publication window closes. Recorded from the code; the
decision above is unchanged.

**Everything windowed is stamped to one slot.** `questionnaireReleaseAt` is
`definition.closeAt` (`web/src/questionnaireProtocol.ts:410-417`), and every
windowed publish — the release loop, the in-window publish, and the republish guard
— goes through `publishStoredSubmissionAtReleaseSlot`, which hard-stamps the signed
`created_at` *and* the payload `submittedAt` to `floor(releaseAt)`
(`web/src/questionnaireOptionARuntime.ts:4212-4222`).

**So a tardy release joins the on-time set, not a smaller one.** A ballot released
at `closeAt + 6h` carries the same `created_at` as one released at `closeAt`: the
signed-timestamp anonymity set is the whole windowed population of that round and
does **not** shrink as the window closes. It changes size only at two boundaries —
a ballot is not in the set until it releases, and after `graceUntil` a pending
release is dropped, so the voter is in no set at all
(`questionnaireOptionARuntime.ts:4259-4269`).

**What does shrink is the arrival set, and that is the residual this ADR defers.** A
client releases only while it is running: on mount, every 60 s
(`web/src/QuestionnaireOptionAVoterPanel.tsx:1717`), and on focus / `online` /
`visibilitychange` (`:1699-1701`). On-time clients therefore emit within roughly one
tick of `closeAt`, while a voter who reopens hours later emits a single event hours
later. The two events are identical in content; at the network layer the late vote's
anonymity set is 1 for anyone watching arrival order or relay logs, and it is 1
immediately after the burst rather than shrinking gradually.

**The numbers that bound the window**, all readable from the signed definition:

- release slot: `closeAt`;
- acceptance window: `[closeAt, closeAt + finalizationGraceSeconds)`;
- `finalizationGraceSeconds` must be an integer with `0 < grace <= 2_592_000`
  (`web/src/questionnaireProtocol.ts:705-716`), the maximum being
  `QUESTIONNAIRE_MAX_FINALIZATION_GRACE_SECONDS = 2_592_000` s = 30 days
  (`web/src/questionnaireProtocolConstants.ts:31`);
- release tick 60 s, so the on-time burst spans at most about one minute of arrival
  time;
- client-side recovery lookback 7 days (`questionnaireOptionARuntime.ts:205`), i.e.
  shorter than the maximum grace: a long-grace round can still accept a release that
  the voter's client can no longer reconstruct (see the ADR 0005 amendment). The
  tardy tail is therefore no larger in practice than what a client can still
  reproduce.

**Two ways out of the set entirely**, both already recorded elsewhere and unchanged
here: a client that never reopens before `graceUntil` never publishes (ADR 0004), and
a client that ignores the mode can publish a normal-timestamp event outside any
window — the baseline assumption ADR 0004 states.

