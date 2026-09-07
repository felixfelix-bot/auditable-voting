import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { MasterlistEntry } from "./residentRegister";

/**
 * Domain-separation label for the keyed commitment.  Binds the HMAC input to
 * this application and a version, so a future format change (e.g. a different
 * normalization) cannot collide with today's commitments.
 */
export const ROSTER_COMMITMENT_DOMAIN =
  "auditable-voting election roster v1";

/**
 * The per-election roster key.  This is the HMAC secret that scopes a roster
 * to a single election: the same masterlist_no committed under two different
 * keys yields two different, unlinkable commitments.
 *
 * Because the key is secret, an observer who reads the published roster sees
 * only commitments and cannot recover the masterlist_no by brute force — even
 * though masterlist_no values are low-entropy ("ML001", "ML002", …).  A
 * plain SHA-256 of masterlist_no would be trivially reversible by dictionary
 * attack; the keyed commitment (HMAC) is not.
 */
export type ElectionRosterKey = string;

/**
 * A keyed commitment of a masterlist_no: 64 lowercase hex chars.
 */
export type MasterlistNoCommitment = string;

/**
 * Compute the keyed commitment (HMAC-SHA256) of a masterlist_no for a given
 * election key.
 *
 * The commitment is:
 *
 *   HMAC-SHA256(key = electionKey, message = `${ROSTER_COMMITMENT_DOMAIN}:${masterlistNo.trim()}`)
 *
 * Normalization is applied here (trim) so that the import path
 * ({@link buildElectionRoster}) and the lookup path
 * ({@link ElectionRoster.isEligible}) commit identically — no off-by-whitespace
 * false negatives.  masterlist_no is deliberately NOT lowercased: identity is
 * case-sensitive (per the interop spec), so "ML001" and "ml001" are different
 * voters.
 *
 * @param electionKey Per-election secret that scopes the commitment.
 * @param masterlistNo Eligibility key (e.g. "ML001").
 * @returns 64-character lowercase hex commitment.
 */
export function commitMasterlistNo(
  electionKey: ElectionRosterKey,
  masterlistNo: string,
): MasterlistNoCommitment {
  const normalized = masterlistNo.trim();
  const message = utf8ToBytes(`${ROSTER_COMMITMENT_DOMAIN}:${normalized}`);
  const key = utf8ToBytes(electionKey);
  return bytesToHex(hmac(sha256, key, message));
}

/**
 * A roster gate for a single election: the set of eligible voters, keyed by a
 * keyed commitment of masterlist_no.
 *
 * Only commitments are ever exposed or stored — the plaintext masterlist_no
 * (and any contact/demographic fields) never appear on this object, so the
 * roster can be serialised into a public stream without leaking PII.
 */
export interface ElectionRoster {
  /**
   * The per-election eligible set: keyed commitments of every active
   * masterlist_no.  One commitment per eligible voter.
   */
  readonly eligible: ReadonlySet<MasterlistNoCommitment>;
  /** Number of eligible voters in this roster. */
  readonly size: number;
  /**
   * True iff the given masterlist_no is an eligible voter in this roster.
   * Equivalent to `eligible.has(commitmentOf(masterlistNo))`.
   */
  isEligible(masterlistNo: string): boolean;
  /** The keyed commitment a voter's masterlist_no maps to under this roster. */
  commitmentOf(masterlistNo: string): MasterlistNoCommitment;
}

/**
 * Result of {@link buildElectionRoster}: either a roster, or (all-or-nothing)
 * a list of errors and a null roster — mirroring the parse functions.
 */
export interface RosterBuildResult {
  roster: ElectionRoster | null;
  errors: string[];
}

/**
 * Build a per-election roster (a `Map<masterlist_no_hash, active>` internally)
 * from the already-parsed set of active masterlist entries (G-1's
 * {@link parseMasterlistCsv} output).
 *
 * - Each entry's `masterlistNo` is committed with the election key; the
 *   commitment (not the plaintext) is the map key.
 * - All entries passed in are active (the parser already filters `inactive`
 *   rows); the map value is `true`.
 * - The roster exposes exactly one eligible set, scoped by `electionKey`.
 * - Plaintext email/phone/dob/country are dropped — they are never stored or
 *   exposed on the roster, so they can never leak into a public stream.
 *
 * Validation is all-or-nothing: an empty/whitespace election key, or a
 * duplicate masterlist_no (defensive — the parser already rejects duplicates),
 * yields a null roster and an error list.
 *
 * @see /tmp/auditable-voting-csv-eligibility-spec.md §3 step 4 and §6.
 */
export function buildElectionRoster(
  electionKey: ElectionRosterKey,
  entries: readonly MasterlistEntry[],
): RosterBuildResult {
  const errors: string[] = [];

  if (!electionKey || electionKey.trim().length === 0) {
    errors.push("election key must not be empty");
  }

  // Map<masterlist_no_hash, active> — keyed by commitment, never plaintext.
  const committed = new Map<MasterlistNoCommitment, boolean>();

  for (const entry of entries) {
    const commitment = commitMasterlistNo(electionKey, entry.masterlistNo);
    if (committed.has(commitment)) {
      errors.push(`duplicate masterlist_no "${entry.masterlistNo}"`);
      continue;
    }
    committed.set(commitment, true);
  }

  if (errors.length > 0) {
    return { roster: null, errors };
  }

  const eligible: ReadonlySet<MasterlistNoCommitment> = new Set(
    committed.keys(),
  );

  const roster: ElectionRoster = {
    eligible,
    size: eligible.size,
    isEligible: (masterlistNo) =>
      committed.has(commitMasterlistNo(electionKey, masterlistNo)),
    commitmentOf: (masterlistNo) =>
      commitMasterlistNo(electionKey, masterlistNo),
  };

  return { roster, errors: [] };
}