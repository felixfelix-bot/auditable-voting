import type { ElectionRoster, MasterlistNoCommitment } from "./electionRoster";

/**
 * Why a roster-bound blind-token issuance was refused.
 *
 * - `not_on_roster`             — the claimed masterlist_no is not in the
 *                                 active eligible set for this election.
 * - `credential_already_issued` — a ballot credential was already issued for
 *                                 this masterlist_no in this election.
 */
export type RosterBoundIssuanceRejectReason =
  | "not_on_roster"
  | "credential_already_issued";

export interface RosterBoundIssuanceGrant {
  ok: true;
  /** Keyed commitment of the masterlist_no — never the plaintext value. */
  commitment: MasterlistNoCommitment;
}

export interface RosterBoundIssuanceRefusal {
  ok: false;
  reason: RosterBoundIssuanceRejectReason;
  /** Keyed commitment of the claimed masterlist_no — never the plaintext value. */
  commitment: MasterlistNoCommitment;
}

export type RosterBoundIssuanceDecision =
  | RosterBoundIssuanceGrant
  | RosterBoundIssuanceRefusal;

/**
 * The roster-bound blind-token issuance gate.
 *
 * This is the "closed election" admission layer: it wires the per-election
 * roster map (G-2, {@link ElectionRoster}) into the blind-token issuance path
 * and enforces **one credential per masterlist_no per election**.
 *
 * Two orthogonal guarantees, combined:
 *
 * 1. **Roster proves "you're in".** `authorize`/`issue` refuse any
 *    masterlist_no that is not in the active eligible set.
 * 2. **Blind token proves "you voted once".** The one-credential-per-entry
 *    dedup here (issuance side) composes with the existing token-nullifier
 *    dedup on the submission side (`deriveQuestionnaireTokenNullifier` plus
 *    the coordinator's accepted-nullifier set): even a valid credential
 *    cannot be submitted twice.
 *
 * Neither layer links the ballot to the voter. This gate records only the
 * keyed commitment of masterlist_no (an HMAC under the per-election secret),
 * which is cryptographically unrelated to the blind-token `tokenCommitment`
 * the voter submits. The coordinator can therefore publish "commitment X was
 * issued a credential" without revealing *which* ballot that voter later cast.
 */
export interface RosterBoundIssuanceGate {
  /** The underlying per-election roster this gate is bound to. */
  readonly roster: ElectionRoster;
  /**
   * Keyed commitments of every masterlist_no that has already received a
   * credential this election. Never plaintext.
   */
  readonly issuedCommitments: ReadonlySet<MasterlistNoCommitment>;
  /** Number of credentials issued so far this election. */
  readonly issuedCount: number;
  /** True iff masterlist_no is in the active eligible set (delegates to roster). */
  isEligible(masterlistNo: string): boolean;
  /** Keyed commitment of masterlist_no under this election (delegates to roster). */
  commitmentOf(masterlistNo: string): MasterlistNoCommitment;
  /** True iff a credential has already been issued for masterlist_no. */
  hasIssued(masterlistNo: string): boolean;
  /**
   * Decide whether a credential may be issued for masterlist_no without
   * recording it. Read-only.
   */
  authorize(masterlistNo: string): RosterBoundIssuanceDecision;
  /**
   * Authorize and, on grant, record the issuance (one credential per
   * masterlist_no per election). On refusal, nothing is recorded.
   */
  issue(masterlistNo: string): RosterBoundIssuanceDecision;
}

/**
 * Create a fresh roster-bound issuance gate over an election roster. The
 * issued-credential set starts empty.
 *
 * @param roster The per-election roster (G-2 `buildElectionRoster` output).
 */
export function createRosterBoundIssuanceGate(
  roster: ElectionRoster,
): RosterBoundIssuanceGate {
  return buildGate(roster, new Set<MasterlistNoCommitment>());
}

/**
 * Rebuild a gate from a previously serialized issued-commitment set, so a
 * coordinator can persist and resume issuance across restarts without
 * re-issuing a credential to any masterlist_no.
 *
 * @param roster The same per-election roster the gate was originally bound to.
 * @param issuedCommitments Commitments previously recorded (e.g. from
 *   {@link serializeIssuedCommitments}).
 */
export function restoreRosterBoundIssuanceGate(
  roster: ElectionRoster,
  issuedCommitments: readonly MasterlistNoCommitment[],
): RosterBoundIssuanceGate {
  return buildGate(roster, new Set<MasterlistNoCommitment>(issuedCommitments));
}

/**
 * Serialize the gate's issued-commitment set to a JSON-safe array.
 *
 * This exists because `ReadonlySet` has no JSON form — `JSON.stringify` on the
 * gate would silently drop the commitments. Callers that persist or publish
 * issuance state MUST use this (or `[...gate.issuedCommitments]`) rather than
 * serializing the gate object directly.
 */
export function serializeIssuedCommitments(
  gate: RosterBoundIssuanceGate,
): MasterlistNoCommitment[] {
  return [...gate.issuedCommitments];
}

/**
 * Serialize the roster's eligible-commitment set to a JSON-safe array.
 *
 * The G-2 roster exposes `eligible` as a `ReadonlySet`, which has no JSON
 * form — `JSON.stringify` would drop the commitments. A coordinator that
 * publishes a roster root (spec §3 step 5) must use this helper (or
 * `[...roster.eligible]`) rather than serializing the roster object directly,
 * so the published root carries the commitments instead of `{}`.
 */
export function serializeRosterCommitments(
  roster: ElectionRoster,
): MasterlistNoCommitment[] {
  return [...roster.eligible];
}

function buildGate(
  roster: ElectionRoster,
  issuedCommitments: Set<MasterlistNoCommitment>,
): RosterBoundIssuanceGate {
  const gate: RosterBoundIssuanceGate = {
    roster,
    issuedCommitments,
    get issuedCount() {
      return issuedCommitments.size;
    },
    isEligible: (masterlistNo) => roster.isEligible(masterlistNo),
    commitmentOf: (masterlistNo) => roster.commitmentOf(masterlistNo),
    hasIssued: (masterlistNo) =>
      issuedCommitments.has(roster.commitmentOf(masterlistNo)),
    authorize: (masterlistNo) => {
      const commitment = roster.commitmentOf(masterlistNo);
      if (!roster.isEligible(masterlistNo)) {
        return { ok: false, reason: "not_on_roster", commitment };
      }
      if (issuedCommitments.has(commitment)) {
        return { ok: false, reason: "credential_already_issued", commitment };
      }
      return { ok: true, commitment };
    },
    issue: (masterlistNo) => {
      const decision = gate.authorize(masterlistNo);
      if (decision.ok) {
        issuedCommitments.add(decision.commitment);
      }
      return decision;
    },
  };
  return gate;
}
