# Timing attacks in blind-signature voting — and windowed publication

Blind signatures are good at one very specific thing: they stop the issuer
learning *how* you voted. But they say nothing about *when* you voted, and
"when" can be enough to re-link a ballot to a voter. This post explains the
gap and the windowed-publication fix we are adding.

## Two different privacy questions

It helps to separate two questions that feel like one:

1. **Did masterlist number `xyz` take part?** This is participation.
2. **What did masterlist number `xyz` vote for?** This is choice.

Blind signatures protect (2), not (1). An organiser who sends admission codes,
or the email provider that delivers them, can see that a code was requested and
therefore that someone was admitted. That is inherent to admission. What must
not happen is that this participation fact gets joined to a ballot.

## Where the guarantee normally holds

The voter blinds a token, the issuer signs it without seeing the final token,
and the voter later spends it anonymously. The final token commitment never
travels through the issuance channel, so the issuer cannot match an issuance to
a later public ballot.

## Where it breaks: timing

Now suppose the issuer knows voter `xyz` was issued a code at 10:00, and a
ballot appears on the public relay at 10:02. If the electorate is small, or
everyone votes right after getting their code, that is not a cryptographic
attack at all — it is simple correlation. Worse, if a client also publishes
live per-question "provisional" hints, those are signed by the same anonymous
key as the final ballot, giving a live timeline to match against.

The blind signature is doing its job; the metadata has routed around it.

## The fix: windowed publication

A questionnaire can now declare `publicationMode: "windowed"`:

- Voters answer as normal during the open window, but the client **holds the
  finished ballot locally** and does not publish it on submit.
- At `closeAt`, held ballots are released together in a single slot.
- Every released ballot carries a **shared `created_at` equal to `closeAt`**,
  so the public record does not reveal per-voter submission time.
- Live provisional hint events are **not published** for windowed rounds.
- A published **finalization grace** (`finalizationGraceSeconds`) means a voter
  who reopens after close still releases a valid ballot; results are not
  finalised before the grace expires.

The anonymity set becomes everyone in the window rather than whoever happened
to submit next. Participation may still be known; it can no longer be lined up
against the public record by clock time.

## What this does not solve

- A malicious client can still publish with a real timestamp; the privacy
  property assumes the shipped client behaves.
- Relay connection metadata, IP-level timing, and network observers are out of
  scope for this change.
- Coercion and device compromise are unchanged.

Windowed publication closes the clock-time correlation channel. It is a
metadata fix, not a new cryptographic guarantee — and that distinction is the
whole point.

*(Work in progress; the protocol fields and client changes described here are
under review.)*
