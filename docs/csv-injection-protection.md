# Resident Register — CSV Formula Injection Protection

## Overview

The resident register parser (`web/src/residentRegister.ts`) ingests CSV files
containing resident contact information (masters list number, email, phone,
name). Because these CSVs originate from spreadsheets and parsed values are
later exported back out, a malicious cell value such as `=SUM(A1)` or
`@lookup(...)` could execute as a formula when an administrator opens an
exported file in Excel, Google Sheets, or LibreOffice Calc — a class of attack
known as **CSV formula injection** (CWE-1236).

## Threat model

An attacker with control over any free-text field in the resident register
(email, phone, name) crafts a value beginning with a formula prefix character.
When the register is later exported to CSV and opened in a spreadsheet
application, the cell is evaluated as a formula, which can lead to data
exfiltration (e.g. `=WEBSERVICE(...)`), arbitrary command execution via
DDE-style payloads, or workbook corruption.

## Mitigation

`neutralizeCsvFormula()` is applied to every string field (email, phone, name)
at parse time:

1. The field is trimmed.
2. Leading invisible Unicode format characters (general category Cf) that
   `trim()` does not remove — zero-width space U+200B, word joiner U+2060,
   bidi controls U+202A–U+202E / U+2066–U+2069, Arabic number signs
   U+0600–U+0605, soft hyphen, BOM — are stripped, so they cannot disguise
   a formula prefix. This stripping is intentionally lossy for values that
   legitimately begin with a format character (rare in contact fields).
3. If the value then starts with one of the formula prefix characters
   `=` `+` `-` `@`, a single apostrophe (`'`) is prepended.
4. Neutralisation happens **before** validation, so the stored value — and any
   value later re-exported — can never begin with a formula prefix.
5. A field containing only invisible characters is treated as not provided
   (undefined), consistent with blank-field handling.

The apostrophe prefix is the standard mitigation recommended by OWASP: it
forces spreadsheet applications to treat the cell as literal text while
preserving the original content for human readers.

`masters_list_number` is not neutralised because it is validated as a positive
integer; a value failing that validation is rejected as a row error rather
than stored.

Empty and undefined fields pass through unchanged, so "field is empty"
validation semantics are unaffected.

This mirrors the `csv_cell` hardening applied by the maintainer in PR #10
(security-hardening-review branch).

## API

| Function | Signature | Description |
|---|---|---|
| `neutralizeCsvFormula` | `(value: string \| undefined) => string \| undefined` | Strips leading Unicode Cf format characters, then prefixes `'` if the value starts with `=`, `+`, `-`, or `@`; otherwise returns the value unchanged. Invisible-only values return `undefined`. |

## Testing

`residentRegister.test.ts` covers the neutralisation through the public
`parseResidentCsv` API with 13 dedicated tests (25 total for the module):

- `=` prefixed name cells are stored with a leading apostrophe
- `+`, `-`, `@` prefixed cells are neutralised across phone and name
- email cells starting with a dangerous character are neutralised
- ordinary values (including emails containing `@` in non-initial position)
  pass through untouched
- neutralised optional fields still count as present (non-empty)
- zero-width space (U+200B), word joiner (U+2060), bidi isolate (U+2066),
  and Arabic number-sign (U+0600) prefixes are stripped before neutralising
- invisible-only optional fields are treated as not provided (undefined)
- tab prefixes are handled by trim and neutralised
- already-apostrophe-prefixed values are not double-escaped
- formula payloads in masters_list_number are rejected as row errors

Run tests:

```bash
cd web && npx vitest run src/residentRegister.test.ts
```

## Masterlist Interop Mode

`parseMasterlistCsv()` — added as an additive parser mode — accepts the interop
masterlist CSV format from the previous centralized solution (header
`id,masterlist_no,email,phone,dob,country,status`).  The existing integer-mode
`parseResidentCsv()` is unchanged.

### Threat model

The same CSV formula injection threat (CWE-1236) applies to the masterlist
format: an attacker crafting `=WEBSERVICE(...)` in the country, dob, email,
or phone fields could trigger formula execution when the roster is exported.

### Mitigation

`neutralizeCsvFormula()` is applied to email, phone, dob, and country at parse
time — same neutralisation as the resident register mode.  `masterlist_no` is
**not** neutralised because it is validated against a safe charset
(`[A-Za-z0-9_-]{1,32}`) that excludes formula-prefix characters (=, +, -, @).

### Testing

The full `residentRegister.test.ts` suite covers 40 tests across both modes,
including the 13 original neutralisation tests plus:

- Doubled-quote known-answer (RFC-4180, e.g. `"He said ""hi"""`)
- Embedded-comma quoted field (RFC-4180, e.g. `"France, Metropolitan"`)
- Security: formula payloads in email are neutralised before validation
- Security: masterlist_no with unsafe chars is rejected as a row error

Run tests:

```bash
cd web && npx vitest run src/residentRegister.test.ts
```

## Election Roster & keyed commitment

`web/src/electionRoster.ts` builds a per-election `Map<masterlist_no_hash, active>`
from `parseMasterlistCsv()` output.  The key is a **keyed commitment**
(HMAC-SHA256) of `masterlist_no` — never the plaintext:

- `commitMasterlistNo(electionKey, masterlistNo)` — deterministic,
  per-election commitment.  Because the election key is a secret, an
  observer who reads the published roster sees only 64-char hex
  commitments and cannot brute-force the low-entropy `masterlist_no`
  values back from the hashes.
- `buildElectionRoster(electionKey, entries)` — returns an `ElectionRoster`
  that exposes `isEligible(masterlistNo)` and the eligible commitments
  set.  Plaintext email/phone/dob/country are **dropped** at build time
  and never appear on the roster object — they cannot leak into a
  published event.

The commitment domain (`"auditable-voting election roster v1"`) is
versioned so a future normalisation change cannot collide with today's
commitments.

### Testing

`electionRoster.test.ts` covers 19 tests including known-answer HMAC
vectors, per-election disjointness, duplicate-detection, PII
serialisation guards, and empty-key rejection.

```bash
cd web && npx vitest run src/electionRoster.test.ts
```
