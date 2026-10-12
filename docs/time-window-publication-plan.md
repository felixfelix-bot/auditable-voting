# Windowed publication (timing-correlation mitigation)

Status: **Proposed / in review** — describes the implementation on the
`feature/multi-language` branch. Ships behind a definition flag; default
behaviour is unchanged.

## 1. Problem

Blind signatures stop the issuer learning *how* a voter voted: the final token
commitment never travels through the issuance channel, so an issuance cannot be
matched to a later public ballot. They do **not** hide *when* a voter voted.

If an organiser (or a relay observer) knows that eligibility identity `xyz` was
admitted at 10:00, and a public ballot appears at 10:02, timing alone can
re-link the two — no cryptography required. The effect is worst in small
electorates and when voters act immediately after admission.

An additional leak is the live per-question provisional event
(`questionnaire_response_provisional`, kind `6427`). It is signed by the same
anonymous key as the final ballot and published per question, giving a live
timeline that can be matched to the eventual final submission.

## 2. Design

A questionnaire definition may set:

```json
{
  "publicationMode": "windowed",
  "finalizationGraceSeconds": 86400
}
```

Validation rules:

- `publicationMode` is `"immediate"` (default) or `"windowed"`.
- `finalizationGraceSeconds` is required for `"windowed"`, an integer `0` to
  `2_592_000` (30 days), and must be absent for `"immediate"`.

When windowed:

1. The voter answers normally while the round is open. On submit the client
   binds the ballot, stores it locally, and **does not publish it**.
2. At `closeAt` the client releases all held ballots in a single slot.
3. Each released ballot carries `created_at = closeAt` **and**
   `submittedAt = closeAt` in the payload, so neither the signed event nor the
   content reveals per-voter submission time. The real submit time is kept only
   in local state for recovery.
4. Provisional per-question events are **not published** for windowed rounds.
5. `finalizationGraceSeconds` defines `closeAt + grace`. Releases in
   `[closeAt, closeAt + grace)` are valid. After the grace, a pending release is
   dropped as missed.
6. Coordinator and delegated audit proxy must not close the questionnaire or
   publish the result summary before `closeAt + grace`, so late releases are
   still counted.

The anonymity set becomes every participant in the window rather than whichever
voter happened to submit next.

### State that holds a windowed ballot

Pending releases are stored with the voter's local election state
(`pendingPublicReleases`), keyed by submission id, carrying the per-submission
response key and the release/grace bounds. The record is marked released (with
the event id) once published and removed when missed.

### Release triggers

The client releases pending submissions on:

- runtime initialisation / login,
- focus, visibility, and online events, and
- a low-frequency interval while the voter panel is mounted.

Release is idempotent: the same bound ballot with the same `created_at` is
re-published on retry, producing the same event id for relays to de-duplicate.

## 3. What this does not solve

- A modified client can publish with a real timestamp; the property assumes the
  shipped client behaves.
- Relay connection metadata, IP-level timing, and network observers are out of
  scope. A later, optional network-layer workstream (Tor or a
  Dandelion-style relay) could address origin-hiding.
- Coercion and device compromise are unchanged.
- Votes held on a device that is never reopened before the grace expires are
  lost. This is an accepted trade-off for the client-side hold design.

## 4. Implementation map

- `web/src/questionnaireProtocolConstants.ts` — publication mode constants.
- `web/src/questionnaireProtocol.ts` — definition fields, validation, and
  `questionnaireIsWindowedPublication` / `questionnaireReleaseAt` /
  `questionnaireGraceUntil` / `questionnaireSubmissionTimestamp` /
  `questionnaireResultSummaryIsPremature`.
- `web/src/questionnaireResponsePublish.ts` — `eventCreatedAt` override for the
  signed `created_at`.
- `web/src/questionnaireOptionARuntime.ts` — queue on submit, release task,
  provisional suppression.
- `web/src/questionnaireOptionA.ts` / `questionnaireOptionAStorage.ts` —
  `PendingPublicRelease` state and persistence.
- `web/src/QuestionnaireCoordinatorPanel.tsx` — hold results until the grace
  elapses and ignore premature summaries.
- `worker/src/model.rs` / `worker/src/main.rs` — delegated completion waits for
  the grace deadline.
- `web/src/QuestionnaireOptionAVoterPanel.tsx` — queued/release messaging and
  release triggers.
