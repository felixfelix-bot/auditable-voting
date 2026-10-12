import { describe, expect, it } from "vitest";
import { parseMasterlistCsv, parseResidentCsv } from "./residentRegister";

describe("parseResidentCsv", () => {
  it("parses a valid CSV with header and returns correct entries", () => {
    const csv = "masters_list_number,email,phone,name\n1,alice@example.com,555-0101,Alice\n2,bob@test.org,555-0102,Bob\n3,carol@demo.com,,Carol";
    const result = parseResidentCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.residents).toHaveLength(3);
    expect(result.residents[0]).toEqual({
      mastersListNumber: 1,
      email: "alice@example.com",
      phone: "555-0101",
      name: "Alice",
    });
    expect(result.residents[1]).toEqual({
      mastersListNumber: 2,
      email: "bob@test.org",
      phone: "555-0102",
      name: "Bob",
    });
    expect(result.residents[2]).toEqual({
      mastersListNumber: 3,
      email: "carol@demo.com",
      phone: undefined,
      name: "Carol",
    });
  });

  it("reports an error for duplicate masters_list_number", () => {
    const csv = "masters_list_number,email,phone,name\n1,alice@example.com,555-0101,Alice\n1,bob@test.org,555-0102,Bob";
    const result = parseResidentCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/duplicate/i);
    expect(result.residents).toHaveLength(0);
  });

  it("reports an error for missing email", () => {
    const csv = "masters_list_number,email,phone,name\n1,,555-0101,Alice";
    const result = parseResidentCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/email/i);
    expect(result.residents).toHaveLength(0);
  });

  it("reports an error for an invalid email format", () => {
    const csv = "masters_list_number,email,phone,name\n1,not-an-email,555-0101,Alice";
    const result = parseResidentCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/email/i);
    expect(result.residents).toHaveLength(0);
  });

  it("reports an error for empty CSV content", () => {
    const result = parseResidentCsv("");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/empty|no header|csv/i);
    expect(result.residents).toHaveLength(0);
  });

  it("reports an error for CSV with header only and no data rows", () => {
    const csv = "masters_list_number,email,phone,name";
    const result = parseResidentCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/no data|empty/i);
    expect(result.residents).toHaveLength(0);
  });

  it("ignores extra columns beyond the standard four", () => {
    const csv = "masters_list_number,email,phone,name,extra1,extra2\n1,alice@example.com,555-0101,Alice,ignored,alsoignored";
    const result = parseResidentCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.residents).toHaveLength(1);
    expect(result.residents[0]).toEqual({
      mastersListNumber: 1,
      email: "alice@example.com",
      phone: "555-0101",
      name: "Alice",
    });
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'masters_list_number,email,phone,name\n1,"alice@example.com","555-0101","Alice, Smith"';
    const result = parseResidentCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.residents).toHaveLength(1);
    expect(result.residents[0]).toEqual({
      mastersListNumber: 1,
      email: "alice@example.com",
      phone: "555-0101",
      name: "Alice, Smith",
    });
  });

  it("rejects CSV with missing header row", () => {
    const csv = "1,alice@example.com,555-0101,Alice";
    const result = parseResidentCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/header/i);
    expect(result.residents).toHaveLength(0);
  });

  it("accumulates multiple errors across rows", () => {
    const csv = "masters_list_number,email,phone,name\n1,alice@example.com,555-0101,Alice\n2,,555-0102,Bob\n2,bob@test.org,,Bob";
    const result = parseResidentCsv(csv);
    // row 2: missing email; row 3: duplicate number + missing email
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.residents).toHaveLength(0);
  });

  it("trims whitespace from field values", () => {
    const csv = "masters_list_number,email,phone,name\n 1 , alice@example.com , 555-0101 , Alice ";
    const result = parseResidentCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.residents).toHaveLength(1);
    expect(result.residents[0]).toEqual({
      mastersListNumber: 1,
      email: "alice@example.com",
      phone: "555-0101",
      name: "Alice",
    });
  });

  it("accepts rows without phone and name columns", () => {
    const csv = "masters_list_number,email,phone,name\n2,bob@test.org,,";
    const result = parseResidentCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.residents).toHaveLength(1);
    expect(result.residents[0]).toEqual({
      mastersListNumber: 2,
      email: "bob@test.org",
      phone: undefined,
      name: undefined,
    });
  });

  describe("CSV formula injection neutralization", () => {
    it("stores a name cell starting with '=' prefixed by an apostrophe", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,555-0101,=SUM(A1)";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0].name).toBe("'=SUM(A1)");
      // sibling fields untouched
      expect(result.residents[0].email).toBe("alice@example.com");
      expect(result.residents[0].phone).toBe("555-0101");
    });

    it("neutralizes cells starting with '+', '-', and '@'", () => {
      const csv =
        "masters_list_number,email,phone,name\n" +
        "1,alice@example.com,+cmd,-2+3\n" +
        "2,bob@test.org,+1,@lookup";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(2);
      expect(result.residents[0].phone).toBe("'+cmd");
      expect(result.residents[0].name).toBe("'-2+3");
      expect(result.residents[1].name).toBe("'@lookup");
    });

    it("neutralizes an email cell starting with a dangerous character", () => {
      const csv = "masters_list_number,email,phone,name\n1,=evil@example.com,,Alice";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0].email).toBe("'=evil@example.com");
    });

    it("leaves ordinary values untouched", () => {
      const csv = "masters_list_number,email,phone,name\n1,a@b.com,555-0101,Auroville";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0]).toEqual({
        mastersListNumber: 1,
        email: "a@b.com",
        phone: "555-0101",
        name: "Auroville",
      });
    });

    it("still counts a neutralized optional field as non-empty", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,=555,=John";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0].phone).toBe("'=555");
      expect(result.residents[0].name).toBe("'=John");
    });

    it("strips a zero-width space prefix before neutralizing", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,,\u200B=SUM(A1)";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0].name).toBe("'=SUM(A1)");
    });

    it("strips a word-joiner prefix (U+2060) before neutralizing", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,\u2060+cmd,";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0].phone).toBe("'+cmd");
    });

    it("strips a bidi-isolate prefix (U+2066 LRI) before neutralizing", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,,\u2066=SUM(A1)";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0].name).toBe("'=SUM(A1)");
    });

    it("strips an Arabic number-sign Cf prefix (U+0600) before neutralizing", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,,\u0600+1";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents[0].name).toBe("'+1");
    });

    it("treats an invisible-only optional field as not provided", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,\u200B,\u2066";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents).toHaveLength(1);
      expect(result.residents[0].phone).toBeUndefined();
      expect(result.residents[0].name).toBeUndefined();
    });

    it("neutralizes a formula prefix after a tab, via trim", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,,\t=SUM(A1)";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents[0].name).toBe("'=SUM(A1)");
    });

    it("does not double-escape an already-apostrophe-prefixed value", () => {
      const csv = "masters_list_number,email,phone,name\n1,alice@example.com,,'=literal";
      const result = parseResidentCsv(csv);
      expect(result.errors).toEqual([]);
      expect(result.residents[0].name).toBe("'=literal");
    });

    it("rejects a formula payload in masters_list_number as a row error", () => {
      const csv = "masters_list_number,email,phone,name\n=SUM(A1),alice@example.com,,Alice";
      const result = parseResidentCsv(csv);
      expect(result.residents).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/masters_list_number/i);
    });
  });
});

describe("parseMasterlistCsv", () => {
  it("accepts ML001-style string masterlist_no from the interop header", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,user1@example.com,9876543210,1990-01-15,USA,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].masterlistNo).toBe("ML001");
    expect(result.entries[0].email).toBe("user1@example.com");
    expect(result.entries[0].dob).toBe("1990-01-15");
    expect(result.entries[0].country).toBe("USA");
  });

  it("filters out inactive rows — only active rows appear in entries", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,user1@example.com,9876543210,1990-01-15,USA,active\n" +
      "2,ML002,user2@example.com,9123456780,1985-06-22,Canada,inactive\n" +
      "3,ML003,user3@example.com,9988776655,1992-11-08,UK,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].masterlistNo).toBe("ML001");
    expect(result.entries[1].masterlistNo).toBe("ML003");
  });

  it("reports an error if no rows are active (all inactive)", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,user1@example.com,,,USA,inactive\n" +
      "2,ML002,user2@example.com,,,Canada,inactive";
    const result = parseMasterlistCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.entries).toHaveLength(0);
    expect(result.errors[0]).toMatch(/eligible|no active|empty/i);
  });

  it("reports an error for duplicate masterlist_no", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,alice@example.com,,,USA,active\n" +
      "2,ML001,bob@example.com,,,Canada,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/duplicate/i);
  });

  it("reports an error for missing masterlist_no", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,,user1@example.com,,,USA,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports an error for unsafe masterlist_no charset", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML$001,user1@example.com,,,USA,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/masterlist_no/i);
  });

  it("reports an error for invalid status value", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,user1@example.com,,,USA,pending";
    const result = parseMasterlistCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports an error for wrong header", () => {
    const csv =
      "bad,col,header,row,here,no,match\n" +
      "1,ML001,user1@example.com,,,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/header/i);
  });

  it("accepts rows with omitted optional fields (email empty, phone empty, dob empty, country empty)", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,,,,,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].email).toBeUndefined();
    expect(result.entries[0].phone).toBeUndefined();
    expect(result.entries[0].dob).toBeUndefined();
    expect(result.entries[0].country).toBeUndefined();
  });

  it("validates email format if present", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,not-an-email,,,USA,active";
    const result = parseMasterlistCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/email/i);
  });

  it("handles RFC-4180 quoted field with doubled quotes (known answer)", () => {
    const csv =
      'id,masterlist_no,email,phone,dob,country,status\n' +
      '1,ML001,user1@example.com,9876543210,1990-01-15,"He said ""hi""",active';
    const result = parseMasterlistCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].country).toBe('He said "hi"');
  });

  it("handles RFC-4180 quoted field with embedded comma", () => {
    const csv =
      'id,masterlist_no,email,phone,dob,country,status\n' +
      '1,ML001,user1@example.com,9876543210,1990-01-15,"France, Metropolitan",active';
    const result = parseMasterlistCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].country).toBe("France, Metropolitan");
  });

  it("reports error for empty CSV", () => {
    const result = parseMasterlistCsv("");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.entries).toHaveLength(0);
  });

  it("reports error for header-only CSV", () => {
    const csv = "id,masterlist_no,email,phone,dob,country,status";
    const result = parseMasterlistCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/no data|empty/i);
  });

  // RED regression guard: existing parseResidentCsv still rejects interop header
  it("existing parseResidentCsv rejects the masterlist interop header", () => {
    const csv =
      "id,masterlist_no,email,phone,dob,country,status\n" +
      "1,ML001,user1@example.com,9876543210,1990-01-15,USA,active";
    const result = parseResidentCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.residents).toHaveLength(0);
  });
});