export interface ResidentEntry {
  mastersListNumber: number;
  email: string;
  phone?: string;
  name?: string;
}

export interface MasterlistEntry {
  /** Interop eligibility key — stable string per human, e.g. "ML001". */
  masterlistNo: string;
  email?: string;
  phone?: string;
  dob?: string;
  country?: string;
}

export interface ParseResult {
  residents: ResidentEntry[];
  errors: string[];
}

export interface MasterlistParseResult {
  entries: MasterlistEntry[];
  errors: string[];
}

/**
 * Characters that, when they start a spreadsheet cell, cause applications
 * like Excel, Google Sheets, and LibreOffice Calc to evaluate the cell
 * content as a formula (CSV formula injection / CSV injection).
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/**
 * Leading Unicode format characters (general category Cf) that are invisible
 * but are NOT removed by String.trim() — e.g. zero-width space U+200B, word
 * joiner U+2060, bidi isolates U+2066-U+2069, Arabic number signs
 * U+0600-U+0605. Stripping them prevents "\u200B=SUM(A1)" from smuggling a
 * formula prefix past neutralization if a downstream renderer or exporter
 * discards invisible characters. Using the \p{Cf} property escape (instead
 * of enumerated ranges) guarantees complete coverage of the category.
 */
const INVISIBLE_PREFIX = /\p{Cf}/u;

/**
 * Neutralise a CSV cell value that could be interpreted as a spreadsheet
 * formula. If the (already trimmed) value starts with one of the formula
 * prefix characters (=, +, -, @), a single apostrophe is prepended so the
 * value is stored and displayed as literal text instead of being executed.
 *
 * Leading invisible format characters (zero-width space, word joiner, bidi
 * controls, soft hyphen, BOM, …) are stripped first, so they cannot disguise
 * a formula prefix. This stripping is intentionally lossy for values that
 * legitimately begin with a format character — an acceptable tradeoff for
 * contact fields.
 *
 * Undefined and empty-string inputs are returned unchanged so "field is
 * empty" validation is unaffected. A value that becomes empty after
 * stripping (invisible-only field) is returned as undefined so callers
 * treat it as not provided.
 *
 * Mirrors the `csv_cell` hardening applied by the maintainer in PR #10
 * (security-hardening-review branch).
 */
export function neutralizeCsvFormula(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === "") {
    return value;
  }
  let v = value;
  while (v.length > 0 && INVISIBLE_PREFIX.test(v[0])) {
    v = v.slice(1);
  }
  if (v === "") {
    return undefined;
  }
  return FORMULA_PREFIXES.includes(v[0]) ? `'${v}` : v;
}

/**
 * Parse a CSV string containing resident contact information.
 *
 * Expected CSV format (header required):
 *   masters_list_number,email,phone,name
 *
 * Validation:
 * - masters_list_number must be unique and parseable as a positive integer
 * - email must be present and in a valid format
 * - phone is optional (SMS channel)
 * - name is optional
 * - Extra columns beyond the standard 4 are ignored
 * - Fields may be quoted (RFC 4180 style)
 * - String fields (email, phone, name) whose value starts with a formula
 *   prefix character (=, +, -, @) are neutralised with a leading apostrophe
 *   so they cannot execute as formulas in spreadsheet applications
 */
export function parseResidentCsv(csvContent: string): ParseResult {
  const errors: string[] = [];
  const seenNumbers = new Set<number>();

  if (!csvContent || csvContent.trim().length === 0) {
    errors.push("CSV content is empty");
    return { residents: [], errors };
  }

  const lines = csvContent.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length === 0) {
    errors.push("CSV content is empty");
    return { residents: [], errors };
  }

  // Validate header
  const headerFields = parseCsvLine(nonEmptyLines[0]);
  const expectedHeader = ["masters_list_number", "email", "phone", "name"];
  const headerMatch =
    headerFields.length >= 4 &&
    headerFields[0].trim().toLowerCase() === expectedHeader[0] &&
    headerFields[1].trim().toLowerCase() === expectedHeader[1] &&
    headerFields[2].trim().toLowerCase() === expectedHeader[2] &&
    headerFields[3].trim().toLowerCase() === expectedHeader[3];

  if (!headerMatch) {
    errors.push("CSV must have a header row: masters_list_number,email,phone,name");
    return { residents: [], errors };
  }

  if (nonEmptyLines.length === 1) {
    errors.push("CSV has no data rows");
    return { residents: [], errors };
  }

  // Collect all errors first — any error means no residents returned (all-or-nothing)
  const validatedEntries: { entry: ResidentEntry; rowIndex: number }[] = [];

  for (let i = 1; i < nonEmptyLines.length; i++) {
    const fields = parseCsvLine(nonEmptyLines[i]);

    if (fields.length < 2) {
      errors.push(`Row ${i}: insufficient fields`);
      continue;
    }

    const mastersListNumberStr = fields[0]?.trim() ?? "";
    // Neutralise formula injection on string fields after trimming and
    // BEFORE any validation, so stored values can never execute as
    // spreadsheet formulas (mirrors the maintainer's csv_cell hardening).
    const email = neutralizeCsvFormula(fields[1]?.trim() ?? "") ?? "";
    const phone = neutralizeCsvFormula(fields[2]?.trim() || undefined);
    const name = neutralizeCsvFormula(fields[3]?.trim() || undefined);

    // Validate masters_list_number
    if (!mastersListNumberStr) {
      errors.push(`Row ${i}: missing masters_list_number`);
      continue;
    }

    const mastersListNumber = Number(mastersListNumberStr);
    if (!Number.isInteger(mastersListNumber) || mastersListNumber <= 0 || isNaN(mastersListNumber)) {
      errors.push(`Row ${i}: masters_list_number must be a positive integer, got "${mastersListNumberStr}"`);
      continue;
    }

    // Validate uniqueness
    if (seenNumbers.has(mastersListNumber)) {
      errors.push(`Row ${i}: duplicate masters_list_number "${mastersListNumber}"`);
      continue;
    }

    // Validate email (required)
    if (!email) {
      errors.push(`Row ${i}: email is required`);
      continue;
    }
    if (!isValidEmail(email)) {
      errors.push(`Row ${i}: invalid email "${email}"`);
      continue;
    }

    seenNumbers.add(mastersListNumber);
    validatedEntries.push({ entry: { mastersListNumber, email, phone, name }, rowIndex: i });
  }

  // All-or-nothing: return residents only if no errors
  if (errors.length > 0) {
    return { residents: [], errors };
  }

  return {
    residents: validatedEntries.map((v) => v.entry),
    errors: [],
  };
}

/**
 * Parse a single CSV line, handling quoted fields (RFC 4180).
 * Returns an array of field values (quotes stripped).
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        current += ch;
      }
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  fields.push(current);
  return fields;
}

/**
 * Basic email validation — checks the string has the general shape of an email address.
 */
function isValidEmail(email: string): boolean {
  // RFC 5322 simplified: at least one char before @, at least one char after @ with a dot
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ---------- Interop masterlist mode ----------

/**
 * Expected header for the interop masterlist CSV format.
 */
const MASTERLIST_EXPECTED_HEADER = [
  "id",
  "masterlist_no",
  "email",
  "phone",
  "dob",
  "country",
  "status",
] as const;

/**
 * Safe charset for masterlist_no: alphanumeric + underscore + hyphen,
 * 1–32 characters.  Intentionally excludes formula-prefix characters
 * (=, +, -, @) so masterlist_no needs no CSV-injection neutralisation.
 */
const MASTERLIST_NO_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Parse the interop masterlist CSV format emitted by the previous
 * (centralized) solution.
 *
 * Expected header:
 *   id,masterlist_no,email,phone,dob,country,status
 *
 * Key differences from the integer "masters_list_number" mode:
 *   - {@link MasterlistEntry.masterlistNo} is a STRING (e.g. "ML001"),
 *     NOT an integer.
 *   - Only rows with status === "active" are included (inactive rows
 *     are silently skipped).
 *   - Email is optional (unlike the integer mode where it is required).
 *   - Optional demographics: dob (ISO date) and country.
 *
 * This function is ADDITIVE — it does not alter the existing integer
 * {@link parseResidentCsv} mode.  The two modes are selected by the
 * caller based on the CSV header.
 *
 * @see /tmp/auditable-voting-csv-eligibility-spec.md
 */
export function parseMasterlistCsv(
  csvContent: string,
): MasterlistParseResult {
  const errors: string[] = [];
  const seenMasterlistNos = new Set<string>();

  if (!csvContent || csvContent.trim().length === 0) {
    errors.push("CSV content is empty");
    return { entries: [], errors };
  }

  const lines = csvContent.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length === 0) {
    errors.push("CSV content is empty");
    return { entries: [], errors };
  }

  // Validate header — must match the 7-column interop shape exactly
  const headerFields = parseCsvLine(nonEmptyLines[0]).map((f) =>
    f.trim().toLowerCase(),
  );
  if (headerFields.length !== MASTERLIST_EXPECTED_HEADER.length) {
    errors.push(
      `CSV must have exactly ${MASTERLIST_EXPECTED_HEADER.length} header columns: ${MASTERLIST_EXPECTED_HEADER.join(",")}`,
    );
    return { entries: [], errors };
  }
  for (let i = 0; i < MASTERLIST_EXPECTED_HEADER.length; i++) {
    if (headerFields[i] !== MASTERLIST_EXPECTED_HEADER[i]) {
      errors.push(
        `CSV header column ${i + 1} must be "${MASTERLIST_EXPECTED_HEADER[i]}", got "${headerFields[i]}"`,
      );
    }
  }
  if (errors.length > 0) {
    return { entries: [], errors };
  }

  if (nonEmptyLines.length === 1) {
    errors.push("CSV has no data rows");
    return { entries: [], errors };
  }

  const activeEntries: MasterlistEntry[] = [];
  let anyActive = false;

  for (let i = 1; i < nonEmptyLines.length; i++) {
    const fields = parseCsvLine(nonEmptyLines[i]);

    if (fields.length < MASTERLIST_EXPECTED_HEADER.length) {
      errors.push(`Row ${i}: insufficient fields (got ${fields.length})`);
      continue;
    }

    const idStr = fields[0]?.trim() ?? "";
    const masterlistNo = fields[1]?.trim() ?? "";

    // Neutralise formula injection on text fields BEFORE validation
    const email = neutralizeCsvFormula(fields[2]?.trim() || undefined);
    const phone = neutralizeCsvFormula(fields[3]?.trim() || undefined);
    const dob = neutralizeCsvFormula(fields[4]?.trim() || undefined);
    const country = neutralizeCsvFormula(fields[5]?.trim() || undefined);
    const status = fields[6]?.trim().toLowerCase() ?? "";

    // Validate id (required integer)
    if (!idStr) {
      errors.push(`Row ${i}: missing id`);
      continue;
    }
    const idNum = Number(idStr);
    if (!Number.isInteger(idNum) || idNum <= 0 || isNaN(idNum)) {
      errors.push(
        `Row ${i}: id must be a positive integer, got "${idStr}"`,
      );
      continue;
    }

    // Validate masterlist_no (required, safe charset)
    if (!masterlistNo) {
      errors.push(`Row ${i}: missing masterlist_no`);
      continue;
    }
    if (!MASTERLIST_NO_RE.test(masterlistNo)) {
      errors.push(
        `Row ${i}: masterlist_no "${masterlistNo}" contains unsafe characters (allowed: A-Za-z0-9_- 1-32 chars)`,
      );
      continue;
    }

    // Validate uniqueness
    if (seenMasterlistNos.has(masterlistNo)) {
      errors.push(`Row ${i}: duplicate masterlist_no "${masterlistNo}"`);
      continue;
    }

    // Validate status
    if (status !== "active" && status !== "inactive") {
      errors.push(
        `Row ${i}: status must be "active" or "inactive", got "${status}"`,
      );
      continue;
    }

    // Validate email format if present
    if (email && !isValidEmail(email)) {
      errors.push(`Row ${i}: invalid email "${email}"`);
      continue;
    }

    seenMasterlistNos.add(masterlistNo);

    if (status === "active") {
      activeEntries.push({ masterlistNo, email, phone, dob, country });
      anyActive = true;
    }
    // inactive rows are silently skipped (not errors, not in entries)
  }

  // All-or-nothing: return entries only if no validation errors
  if (errors.length > 0) {
    return { entries: [], errors };
  }

  if (!anyActive) {
    errors.push("No eligible rows — all rows are inactive or empty");
    return { entries: [], errors };
  }

  return { entries: activeEntries, errors: [] };
}