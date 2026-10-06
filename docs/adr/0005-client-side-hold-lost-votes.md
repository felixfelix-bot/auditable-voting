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

## Amendment — device change: what the shipped client actually does (2026-10-06, head `3f9892a`)

The review of PR #28 read this ADR as "lost only if never reopened". That is not
precise enough to review against, so this amendment records the shipped behaviour
path by path. No decision here changes; the code is the source of truth.

**State lives per device.** `pendingPublicReleases` is written into the
browser-local submission blob (`web/src/questionnaireOptionAStorage.ts:520-527`)
and read back from there. A different browser profile, a different device, or
cleared site data starts with no release map.

**A self-copy of that state is published on submit.** The voter's own NIP-17
mailbox receives an encrypted state snapshot whose release records deliberately
omit the responder key — `pendingPublicReleases?: Record<string, Omit<PendingPublicRelease, "responseNsec">>`
(`web/src/questionnaireOptionABlindDm.ts:227`) — and the responder nsec is re-derived
on recovery from the issued token secrets, in the same v2 derivation domain the
submit path used (`web/src/questionnaireOptionARuntime.ts:2291-2313`). The review's
BLOCK 1 (a release record that is never rebuilt) is closed at this head: the record
rides in the self-copy and is rebuilt on recovery (`:2315-2342`).

**Both login paths attempt recovery.** `loginWithSigner` awaits
`recoverVoterStateFromSelfDm()` and then `recoverSubmittedBallotFromSelfDm()`
(`web/src/questionnaireOptionARuntime.ts:2158-2159`); `bootstrapWithLocalIdentity`
starts the state-snapshot recovery without awaiting it (`:2279`). The snapshot path
rebuilds queued release records and merges them into state (`:1659-1668`).

**Release then runs through the normal machinery.** `releasePendingPublicSubmissions`
runs once on mount and every 60 s (`web/src/QuestionnaireOptionAVoterPanel.tsx:1710-1719`)
and on focus / `online` / `visibilitychange` (`:1699-1701`), publishing each entry at
the shared release slot (`questionnaireOptionARuntime.ts:4229-4321`).

So a device change is **recoverable only if all four of these hold**:

1. the voter can still authenticate as the same identity key — the self-copy is
   encrypted to that key, and nothing else can open it;
2. the self-copy is still retrievable within the recovery lookback of 7 days
   (`OPTION_A_SELF_COPY_RECOVERY_LOOKBACK_SECONDS = 7 * 24 * 60 * 60`,
   `questionnaireOptionARuntime.ts:205`, applied as `since = now - 604800` at `:1713`);
3. the recovered state still yields `blindTokenSecrets` — `deriveRecoveredResponderNsec`
   returns `null` without them and nothing is rebuilt (`:2291-2313`);
4. the client is reopened before `graceUntil = closeAt + finalizationGraceSeconds`;
   once `now >= graceUntil` the entry is dropped as missed (`:4259-4269`).

Otherwise the ballot is never published, and the voter is **not** warned: the only
release-related copy is the transient post-submit status line
(`QuestionnaireOptionAVoterPanel.tsx:2977-2979`) and the past-grace submit error
(`:819`). Nothing renders `releasedAt`/`releasedEventId` and no UI surface reads
`pendingPublicReleases`, so a held ballot that never releases is indistinguishable
from a released one — the status list keeps reading
"Response: Waiting for <actor>" (`:4106-4113`).

Residual gaps, stated so they are not found later as surprises:

- a **different identity key** on the new device cannot open the self-copy: with no
  local state and no readable snapshot, recovery is a no-op and the ballot is lost
  while the lookback is still unexpired;
- the **7-day lookback is shorter than the maximum grace** (30 days): a round
  configured with a long grace still accepts a release that the client can no longer
  reconstruct, so the protocol's window outlives the client's recoverability;
- when the publication policy cannot be resolved the client fails **closed**
  (`resolvePublicationPolicy` → `invalid_publication_mode`,
  `questionnaireOptionARuntime.ts:3774-3808`): the re-submit is refused instead of
  published immediately with its real time. That is the privacy-preserving
  direction, but for a voter whose definition cache and persisted policy are both
  gone it is another silent loss.

### Options (product decision — not taken here)

Each option is described by what it changes, its privacy consequence, and its
double-vote consequence.

**A. Keep fatal (shipped).**

- Change: none. A device change stays recoverable only under the four conditions
  above.
- Privacy: no new trusted party; the self-copy stays a recovery aid, never a
  publication channel.
- Double vote: a device change can only re-publish the same stored submission under
  the same responder key, so the same bound ballot keeps one event id (ADR 0002).

**B. Recoverable with re-verification.**

- Change: require the voter to re-establish the identity key on the replacement
  device before releasing, and refuse to release without it.
- Privacy: reuses the existing self-copy plus token-secret derivation; adds no
  ciphertext at rest and no release authority. Re-verification does not remove the
  "the same key opens the self-copy" premise — it makes that premise visible to the
  voter instead of silent.
- Double vote: no ballot credential is minted by a release, so re-verification
  cannot create a second ballot; a second credential remains the coordinator's
  admission decision.

**C. Recoverable with a grace window.**

- Change: make the release window the recovery window — cover
  `finalizationGraceSeconds` in the recovery lookback (today 7 days against a
  maximum of 30) and accept a late release up to `graceUntil`.
- Privacy: a late release is stamped to the shared slot, so `created_at` still does
  not disclose lateness; the tardy tail is visible only in relay arrival order (see
  the ADR 0007 amendment).
- Double vote: as B; the slot is fixed at `closeAt`, so a late release cannot open a
  second slot.

Whichever option is chosen, the voter-visible half is a separate decision: today a
held ballot that never releases looks the same as a released one, so the panel would
at minimum need to surface "queued, releases at X" while pending, and an explicit
"release window missed" state.


