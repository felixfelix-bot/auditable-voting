# The timing-correlation problem in blind-signature voting

Status: Accepted context for the windowed-publication changes
Related: [docs/time-window-publication-plan.md](time-window-publication-plan.md),
[docs/adr/](adr/README.md)

## Summary

Blind signatures protect *what* a voter voted, not *when* they voted. When
admission is identity-linked and ballots are public, submission timing can
re-link a voter to their ballot, recovering the very link the cryptography was
meant to break.

## Two distinct privacy questions

1. **Participation** — did eligibility identity `xyz` take part?
2. **Choice** — what did `xyz` vote for?

Blind signatures address (2). Admission inherently reveals (1) to whoever
operates it: an organiser sending admission codes, or an email provider
delivering them, learns that a code was requested. This is expected and is not
what the fix targets. The failure is when the participation fact is *joined* to
a specific ballot.

## How the guarantee works

The voter blinds a token; the issuer signs it without seeing the final token;
the voter later spends it anonymously. The final token commitment never travels
through the issuance channel, so the issuer cannot match an issuance to a public
ballot. Issuance DMs carry the blinded message and a definition reference only.

## How timing breaks it

Consider an observer who knows voter `xyz` was admitted at 10:00 (from OTP
delivery metadata) and can read public relays.

- A public blind-token submission (`questionnaire_response_blind`, kind `6424`)
  is published the moment the voter submits and carries a signed `created_at`.
- If a ballot appears at 10:02 and the electorate is small, the observer
  reasonably concludes it is `xyz`'s. No cryptography is broken; metadata has
  routed around it.

A second channel compounds this: the provisional per-question event
(`questionnaire_response_provisional`, kind `6427`) is signed by the *same
anonymous key* as the final ballot and published live per question, giving a
per-key timeline that can be matched to the eventual final submission.

## Threat model

| Element | In scope for this fix |
| --- | --- |
| Public relay readers correlating admission time with ballot time | Yes |
| Relay operators logging connection/arrival metadata | Partly — arrival batching yes, IP/origin no (ADR 0007) |
| Organiser or proxy correlating issuance with submission content | Already prevented by blind signatures |
| Malicious modified client publishing a real timestamp | Not preventable; assumes shipped client behaviour |
| Coercion / device compromise | Out of scope |

## Mitigation

Windowed publication: hold each bound ballot locally, release all held ballots
together at `closeAt`, stamp both the signed event and the payload with the
shared release time, suppress provisional events, and keep accepting late
releases until a published finalization grace elapses. See the ADRs for the
locked decisions and the plan note for the implementation map.

## Residual risks

- Network-layer origin and IP timing are not hidden (ADR 0007).
- The property relies on the shipped client behaving.
- Ballots held on a device that is never reopened within the grace are lost
  (ADR 0005).
