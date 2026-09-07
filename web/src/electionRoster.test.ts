import { describe, expect, it } from "vitest";
import {
  buildElectionRoster,
  commitMasterlistNo,
  ROSTER_COMMITMENT_DOMAIN,
} from "./electionRoster";
import type { MasterlistEntry } from "./residentRegister";

const ELECTION_KEY = "election-key-1";

// ── commitMasterlistNo ───────────────────────────────────────────

describe("commitMasterlistNo", () => {
  it("produces a 64-character hex commitment", () => {
    const c = commitMasterlistNo("key", "ML001");
    expect(c).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce the same commitment", () => {
    expect(commitMasterlistNo("k", "foo")).toBe(
      commitMasterlistNo("k", "foo"),
    );
  });

  it("different masterlist_no values produce different commitments", () => {
    expect(commitMasterlistNo("key", "ML001")).not.toBe(
      commitMasterlistNo("key", "ML002"),
    );
  });

  it("different election keys produce different commitments (keyed)", () => {
    expect(commitMasterlistNo("k1", "ML001")).not.toBe(
      commitMasterlistNo("k2", "ML001"),
    );
  });

  it("trims whitespace from masterlist_no before committing", () => {
    expect(commitMasterlistNo("key", " ML001 ")).toBe(
      commitMasterlistNo("key", "ML001"),
    );
  });

  it("is case-sensitive — 'ML001' ≠ 'ml001'", () => {
    expect(commitMasterlistNo("key", "ML001")).not.toBe(
      commitMasterlistNo("key", "ml001"),
    );
  });

  it("known-answer vector matches pre-computed HMAC-SHA256", () => {
    // Pre-computed: HMAC-SHA256("election-key-1", "auditable-voting election roster v1:ML001")
    expect(commitMasterlistNo(ELECTION_KEY, "ML001")).toBe(
      "ef40640824cc350b912ad2e92005d52e7696e543e693f66717ad089a741b9f6e",
    );
  });

  it("domain separator is included in the HMAC message", () => {
    // Verify the domain constant appears in the HMAC message construction
    // (indirect test: if domain were missing, known-answer above would fail)
    expect(ROSTER_COMMITMENT_DOMAIN).toBe(
      "auditable-voting election roster v1",
    );
  });
});

// ── buildElectionRoster ───────────────────────────────────────────

const activeEntries: MasterlistEntry[] = [
  {
    masterlistNo: "ML001",
    email: "user1@example.com",
    phone: "9876543210",
    dob: "1990-01-15",
    country: "USA",
  },
  {
    masterlistNo: "ML002",
    email: "user2@example.com",
    phone: "9123456780",
    dob: "1985-06-22",
    country: "Canada",
  },
  {
    masterlistNo: "ML003",
    email: "user3@example.com",
    phone: "9988776655",
    dob: "1992-11-08",
    country: "UK",
  },
];

describe("buildElectionRoster", () => {
  it("builds a roster with isEligible true for every active entry", () => {
    const { roster, errors } = buildElectionRoster(
      ELECTION_KEY,
      activeEntries,
    );
    expect(errors).toEqual([]);
    expect(roster).not.toBeNull();
    expect(roster!.size).toBe(3);
    expect(roster!.isEligible("ML001")).toBe(true);
    expect(roster!.isEligible("ML002")).toBe(true);
    expect(roster!.isEligible("ML003")).toBe(true);
  });

  it("reports isEligible false for a masterlist_no not in the roster", () => {
    const { roster } = buildElectionRoster(ELECTION_KEY, activeEntries);
    expect(roster!.isEligible("ML999")).toBe(false);
    expect(roster!.isEligible("")).toBe(false);
  });

  it("trims masterlist_no when checking eligibility", () => {
    const { roster } = buildElectionRoster(ELECTION_KEY, activeEntries);
    // ML001 appears as "ML001" in entries; whitespace is trimmed on lookup
    expect(roster!.isEligible(" ML001 ")).toBe(true);
    expect(roster!.commitmentOf(" ML001 ")).toBe(
      roster!.commitmentOf("ML001"),
    );
  });

  it("exposes the eligible set as hex commitments only — no plaintext email/phone", () => {
    const { roster } = buildElectionRoster(ELECTION_KEY, activeEntries);
    const commitments = [...roster!.eligible];
    expect(commitments).toHaveLength(3);

    for (const c of commitments) {
      // Every entry is a 64-char hex commitment (HMAC-SHA256)
      expect(c).toMatch(/^[0-9a-f]{64}$/);
    }

    // Serialize the roster object and verify no raw PII lands in the output
    const serialized = JSON.stringify(roster);
    for (const entry of activeEntries) {
      // Plaintext masterlist_no should NOT appear in serialization
      // (the eligible set and function closures use commitments, not raw nos)
      // The entry's email/phone/dob/country must NOT be serialised
      if (entry.email) expect(serialized).not.toContain(entry.email);
      if (entry.phone) expect(serialized).not.toContain(entry.phone);
    }
    // Commitments are 64-char hex — masterlist_no "ML001" (5 chars) won't appear
    expect(serialized).not.toContain("ML001");
  });

  it("each election key produces a disjoint eligible set", () => {
    const { roster: r1 } = buildElectionRoster("key-a", activeEntries);
    const { roster: r2 } = buildElectionRoster("key-b", activeEntries);
    const s1 = r1!.eligible;
    const s2 = r2!.eligible;

    // For each masterlist_no, the commitment differs per key
    for (const c of s1) expect(s2.has(c)).toBe(false);
    for (const c of s2) expect(s1.has(c)).toBe(false);
  });

  it("returns an error and null roster for empty election key", () => {
    const { roster, errors } = buildElectionRoster("", activeEntries);
    expect(roster).toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/key/i);
  });

  it("returns an error and null roster for whitespace-only election key", () => {
    const { roster, errors } = buildElectionRoster("   ", activeEntries);
    expect(roster).toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("detects duplicate ('belt-and-suspenders') masterlist_no entries as errors", () => {
    const dupEntries: MasterlistEntry[] = [
      { masterlistNo: "ML001", email: "a@example.com" },
      { masterlistNo: "ML001", email: "b@example.com" },
      { masterlistNo: "ML002", email: "c@example.com" },
    ];
    const { roster, errors } = buildElectionRoster("key", dupEntries);
    expect(roster).toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/duplicate/i);
  });

  it("handles an empty entries array gracefully (zero eligible)", () => {
    const { roster, errors } = buildElectionRoster("key", []);
    expect(errors).toEqual([]);
    expect(roster).not.toBeNull();
    expect(roster!.size).toBe(0);
    expect(roster!.eligible.size).toBe(0);
    expect(roster!.isEligible("ML001")).toBe(false);
  });

  it("accepts entries with only masterlistNo (optional fields undefined)", () => {
    const sparse: MasterlistEntry[] = [
      { masterlistNo: "ML-SPARSE" },
    ];
    const { roster, errors } = buildElectionRoster("key", sparse);
    expect(errors).toEqual([]);
    expect(roster!.size).toBe(1);
    expect(roster!.isEligible("ML-SPARSE")).toBe(true);
    // Verify no PII is serialised even when undefined fields exist
    const serialized = JSON.stringify(roster);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("dob");
    expect(serialized).not.toContain("country");
  });

  it("commitmentOf returns the same hex as isEligible uses for lookup", () => {
    const { roster } = buildElectionRoster(ELECTION_KEY, activeEntries);
    const c = roster!.commitmentOf("ML001");
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    // The commitment is the key in the eligible set
    expect(roster!.eligible.has(c)).toBe(true);
  });
});