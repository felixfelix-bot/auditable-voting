import { describe, expect, it } from "vitest";
import { buildElectionRoster } from "./electionRoster";
import {
  createRosterBoundIssuanceGate,
  restoreRosterBoundIssuanceGate,
  serializeIssuedCommitments,
  serializeRosterCommitments,
} from "./rosterBoundIssuance";
import type { MasterlistEntry } from "./residentRegister";

const ELECTION_KEY = "election-key-1";

const activeEntries: MasterlistEntry[] = [
  { masterlistNo: "ML001", email: "user1@example.com", phone: "9876543210" },
  { masterlistNo: "ML002", email: "user2@example.com", phone: "9123456780" },
  { masterlistNo: "ML003", email: "user3@example.com", phone: "9988776655" },
];

function roster() {
  const result = buildElectionRoster(ELECTION_KEY, activeEntries);
  if (!result.roster) {
    throw new Error(`buildElectionRoster failed: ${result.errors.join("; ")}`);
  }
  return result.roster;
}

// ── createRosterBoundIssuanceGate ─────────────────────────────────

describe("createRosterBoundIssuanceGate", () => {
  it("starts with an empty issued set", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    expect(gate.issuedCount).toBe(0);
    expect(gate.issuedCommitments.size).toBe(0);
  });

  it("delegates eligibility to the underlying roster", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    expect(gate.isEligible("ML001")).toBe(true);
    expect(gate.isEligible("ML999")).toBe(false);
    expect(gate.isEligible("")).toBe(false);
  });

  it("delegates commitmentOf to the underlying roster", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    expect(gate.commitmentOf("ML001")).toBe(roster().commitmentOf("ML001"));
  });
});

// ── authorize ──────────────────────────────────────────────────────

describe("authorize", () => {
  it("grants an eligible, not-yet-issued masterlist_no", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const decision = gate.authorize("ML001");
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.commitment).toBe(roster().commitmentOf("ML001"));
    }
  });

  it("refuses a masterlist_no not on the roster", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const decision = gate.authorize("ML999");
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("not_on_roster");
    }
  });

  it("refuses an empty masterlist_no", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const decision = gate.authorize("");
    expect(decision.ok).toBe(false);
  });

  it("does not record a grant — authorize is read-only", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    gate.authorize("ML001");
    expect(gate.hasIssued("ML001")).toBe(false);
    expect(gate.issuedCount).toBe(0);
  });

  it("refuses a masterlist_no whose credential was already issued", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    gate.issue("ML001");
    const decision = gate.authorize("ML001");
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("credential_already_issued");
    }
  });
});

// ── issue (one credential per masterlist_no per election) ──────────

describe("issue", () => {
  it("issues one credential and records the commitment", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const decision = gate.issue("ML001");
    expect(decision.ok).toBe(true);
    expect(gate.issuedCount).toBe(1);
    expect(gate.hasIssued("ML001")).toBe(true);
  });

  it("enforces one credential per masterlist_no — second issue is refused", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const first = gate.issue("ML001");
    expect(first.ok).toBe(true);

    const second = gate.issue("ML001");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("credential_already_issued");
    }
    expect(gate.issuedCount).toBe(1);
  });

  it("refuses to issue a non-roster masterlist_no without recording it", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const decision = gate.issue("ML999");
    expect(decision.ok).toBe(false);
    expect(gate.issuedCount).toBe(0);
  });

  it("is case-sensitive — 'ML001' and 'ml001' are different voters", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    expect(gate.issue("ML001").ok).toBe(true);
    // "ml001" is not on the roster (roster is case-sensitive)
    const lower = gate.issue("ml001");
    expect(lower.ok).toBe(false);
    if (!lower.ok) {
      expect(lower.reason).toBe("not_on_roster");
    }
  });

  it("trims masterlist_no before committing (consistent with roster)", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const decision = gate.issue(" ML001 ");
    expect(decision.ok).toBe(true);
    expect(gate.hasIssued("ML001")).toBe(true);
    // The same (trimmed) masterlist_no is now issued — one credential total
    expect(gate.issue("ML001").ok).toBe(false);
  });

  it("issues distinct credentials for distinct eligible masterlist_no values", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    expect(gate.issue("ML001").ok).toBe(true);
    expect(gate.issue("ML002").ok).toBe(true);
    expect(gate.issue("ML003").ok).toBe(true);
    expect(gate.issuedCount).toBe(3);
  });
});

// ── per-election scoping ───────────────────────────────────────────

describe("per-election scoping", () => {
  it("two gates built under different election keys are independent", () => {
    const r1 = buildElectionRoster("key-a", activeEntries).roster!;
    const r2 = buildElectionRoster("key-b", activeEntries).roster!;
    const gate1 = createRosterBoundIssuanceGate(r1);
    const gate2 = createRosterBoundIssuanceGate(r2);

    expect(gate1.issue("ML001").ok).toBe(true);

    // Issuing under one election does not consume the other election's slot
    expect(gate2.issue("ML001").ok).toBe(true);
    expect(gate1.issuedCount).toBe(1);
    expect(gate2.issuedCount).toBe(1);

    // The commitments are disjoint (different election keys)
    expect(gate1.commitmentOf("ML001")).not.toBe(gate2.commitmentOf("ML001"));
  });
});

// ── PII / unlinkability guarantees ─────────────────────────────────

describe("unlinkability and PII safety", () => {
  it("stores only keyed commitments, never plaintext masterlist_no", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    gate.issue("ML001");
    gate.issue("ML002");

    const serialized = JSON.stringify({
      issued: serializeIssuedCommitments(gate),
    });
    expect(serialized).not.toContain("ML001");
    expect(serialized).not.toContain("ML002");
    expect(serialized).not.toContain("user1@example.com");
    expect(serialized).not.toContain("9876543210");
  });

  it("serialized commitments are 64-char hex", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    gate.issue("ML001");
    for (const c of serializeIssuedCommitments(gate)) {
      expect(c).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("the gate decision exposes a commitment, not the claimed masterlist_no", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    const decision = gate.issue("ML001");
    expect(JSON.stringify(decision)).not.toContain("ML001");
    if (decision.ok) {
      expect(decision.commitment).toBe(roster().commitmentOf("ML001"));
    }
  });
});

// ── serialization / restore round-trip ─────────────────────────────

describe("serialization and restore", () => {
  it("serializeIssuedCommitments returns an array (JSON-safe), not a Set", () => {
    const gate = createRosterBoundIssuanceGate(roster());
    gate.issue("ML001");
    gate.issue("ML002");
    const serialized = serializeIssuedCommitments(gate);
    expect(Array.isArray(serialized)).toBe(true);
    expect(serialized).toHaveLength(2);
  });

  it("serializeRosterCommitments returns the eligible set as a JSON-safe array", () => {
    const committed = serializeRosterCommitments(roster());
    expect(Array.isArray(committed)).toBe(true);
    expect(committed).toHaveLength(3);
    // Every element is a 64-char hex commitment — no plaintext masterlist_no
    for (const c of committed) {
      expect(c).toMatch(/^[0-9a-f]{64}$/);
    }
    // JSON round-trip of a published roster root carries the commitments,
    // not `{}` (the Set serialization trap the G-2 reviewer flagged).
    const publishedRoot = JSON.stringify({ eligible: committed });
    expect(publishedRoot).not.toContain("ML001");
    expect(publishedRoot).not.toContain("{}");
  });

  it("round-trips issued state through serialize + restore", () => {
    const original = createRosterBoundIssuanceGate(roster());
    original.issue("ML001");
    original.issue("ML002");

    const restored = restoreRosterBoundIssuanceGate(
      roster(),
      serializeIssuedCommitments(original),
    );
    expect(restored.issuedCount).toBe(2);
    expect(restored.hasIssued("ML001")).toBe(true);
    expect(restored.hasIssued("ML002")).toBe(true);
    expect(restored.hasIssued("ML003")).toBe(false);

    // A restored gate still enforces one-credential-per-masterlist_no
    const again = restored.issue("ML001");
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.reason).toBe("credential_already_issued");
    }
  });

  it("restore with an empty set yields a gate with zero issued credentials", () => {
    const restored = restoreRosterBoundIssuanceGate(roster(), []);
    expect(restored.issuedCount).toBe(0);
    expect(restored.hasIssued("ML001")).toBe(false);
  });

  it("restore deduplicates repeated commitments via the underlying Set", () => {
    const commitment = roster().commitmentOf("ML001");
    const restored = restoreRosterBoundIssuanceGate(roster(), [
      commitment,
      commitment,
      commitment,
    ]);
    expect(restored.issuedCount).toBe(1);
    expect(restored.hasIssued("ML001")).toBe(true);
  });
});
