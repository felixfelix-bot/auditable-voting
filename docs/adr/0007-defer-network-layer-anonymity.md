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
