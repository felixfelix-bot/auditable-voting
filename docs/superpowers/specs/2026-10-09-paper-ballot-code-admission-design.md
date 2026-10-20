# Paper Ballot Code Admission

## Goal

Control printed ballot access without linking a submitted anonymous ballot to a
master-list record.

## Code Lifecycle

The organiser creates a random ten-character Crockford Base32 code for each
master-list number in the open print batch. Only the combined election ID,
normalised master-list number and code hash persists, with expiry and redemption
state. Plain codes and numbers stay in memory for printing. No separate
master-list hash or persistent roster-to-admission mapping is kept. The browser
discards legacy records with separate roster identifiers and strips unknown
metadata on load/save, snapshots and recovery. The worker strips legacy
identifiers and unknown fields from typed records; a record without a combined
admission hash cannot authorise a request.

Duplicate numbers are detected only within the open print batch. After reload,
new codes cannot be linked to or automatically revoke earlier codes for the same
number. Both may admit separate requests until redeemed, expired or explicitly
revoked by admission key. Do not generate another batch for the same roster.

The paper ballot shows the code and clear conditional instructions. A dependent
question states which preceding answer makes it applicable and says to leave it
blank otherwise. Multiple-choice conditions require all named options and allow
additional selections. The parent question must itself be applicable. Required
questions are required only when applicable. No voter private key is printed.

## Admission

The voter enters the paper code and master-list number at the ballot-access
screen. The configured issuer, either the organiser browser or delegated Linux
worker, verifies the combined admission hash, election, expiry and unused status.
It binds consumption to the request and sends a fresh blind credential. Sending
the request is not proof of receipt: the voter waits until the credential arrives.

The voter then submits answers using that credential. The ballot submission
does not contain the paper code or master-list number. No further organiser
action is required after admission.

## Failure Rules

- A code is valid for only one election and one master-list number.
- A consumed, expired, or unmatched code does not issue a credential.
- If credential delivery fails after consumption, the issuer retains the exact
  issuance record for encrypted receipt/recovery, rather than issuing a second
  credential.

## Verification

Tests cover code format and hashing, master-list and election mismatch,
expiry, single use, immediate credential issuance, recovery after delivery
failure, and absence of paper identifiers from anonymous ballot payloads.
