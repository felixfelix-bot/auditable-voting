// Shared test fixtures for the paper-ballot path.
//
// These keys are GENERATED AT RUNTIME, never hardcoded. That is deliberate:
// `generatePaperBallot` validates the voter key and derives an npub from it, so
// the tests genuinely need a structurally valid secp256k1 key. But a hardcoded
// key-shaped literal in a test file is indistinguishable from a leaked
// credential to any secret scanner — and our fleet pre-push gate flags the
// `nsec1[a-z0-9]{20,}` pattern (the class-pattern gate has no exemption path).
//
// Generating per process removes the literal entirely: there is nothing to
// exempt, nothing to scrub, and nothing that can later be mistaken for a real
// key. Each call is a fresh random key, so tests cannot come to depend on the
// value of a particular key either.

import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

/** A fresh, valid (nsec, npub) pair. Call once per test file. */
export function makeTestVoterIdentity(): { nsec: string; npub: string } {
  const secretKey = generateSecretKey();
  return {
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(getPublicKey(secretKey)),
  };
}

/** Just the nsec, when that is all a test needs. */
export function makeTestNsec(): string {
  return makeTestVoterIdentity().nsec;
}
