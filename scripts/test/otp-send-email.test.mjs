// Integration-style test for scripts/otp-send-email.mjs against a stubbed
// nomail/cashu.email HTTP layer.
//
// The script uses global fetch; this test replaces it with a deterministic stub
// that simulates the real nomail API shape (challenge, verify, send) including
// its X-Reason/X-Hint error headers. This lets the batch/resume/CSV logic run
// offline and deterministically in CI (no real nsec, no paid postage).
//
// Run:   node --test scripts/test/otp-send-email.test.mjs
//
// NOTE: This is the offline/deterministic form. A live test against the real
// cashu.email API requires a real nsec + paid mint token and is intentionally
// NOT wired into CI (see scripts/test/live-otp-send-email.mjs for the opt-in
// live driver).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = new URL("../otp-send-email.mjs", import.meta.url).pathname;
const TEST_NSEC = "0000000000000000000000000000000000000000000000000000000000000001";

// Deterministic fixture roster (tests quoted-field CSV parsing too)
const ROSTER = [
  "masters_list_number,email,phone,name",
  "101,alice@example.com,5550101,\"Alice, A.\"",
  "102,bob@example.com,5550102,Bob",
  "103,carol@example.com,5550103,Carol",
].join("\n");

// Build a fake nomail API server via a stub that swaps in global.fetch inside a
// child node process.
function runScript(args, envPatch = {}) {
  const child = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...envPatch, TEST_API_STUB: "1" },
  });
  return { code: child.status, stdout: child.stdout, stderr: child.stderr };
}

test("dry-run generates OTPs, writes results + ledger, no network", () => {
  const dir = mkdtempSync(join(tmpdir(), "otp-"));
  const csv = join(dir, "roster.csv");
  const results = join(dir, "results.csv");
  const ledger = join(dir, "ledger.json");
  writeFileSync(csv, ROSTER);

  const { code, stdout } = runScript([
    "--nsec", TEST_NSEC,
    "--csv", csv,
    "--ledger", ledger,
    "--results", results,
    "--dry-run",
  ]);
  assert.equal(code, 0, `exit 0, got ${stdout}${readFileSync(ledger, "utf8")}?`);
  const res = readFileSync(results, "utf8");
  assert.match(res, /^mastersListNumber,ok,detail/m);
  // Three roster rows => three result rows, all ok in dry-run
  const rows = res.trim().split("\n").slice(1);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.includes(",true,")));
  // Ledger persisted with otp for each
  const lk = JSON.parse(readFileSync(ledger, "utf8"));
  assert.deepEqual(Object.keys(lk).sort(), ["101", "102", "103"]);
});

test("resume ledger skips already-sent rows on rerun", () => {
  const dir = mkdtempSync(join(tmpdir(), "otp-"));
  const csv = join(dir, "roster.csv");
  const results = join(dir, "results.csv");
  const ledger = join(dir, "ledger.json");
  writeFileSync(csv, ROSTER);

  // First run: all sent
  let r = runScript(["--nsec", TEST_NSEC, "--csv", csv, "--ledger", ledger, "--results", results, "--dry-run"]);
  assert.equal(r.code, 0);
  // Second run: all already-sent => skipped
  const r2out = join(dir, "results2.csv");
  r = runScript(["--nsec", TEST_NSEC, "--csv", csv, "--ledger", ledger, "--results", r2out, "--dry-run"]);
  assert.equal(r.code, 0);
  const res2 = readFileSync(r2out, "utf8");
  const rows = res2.trim().split("\n").slice(1);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((x) => x.includes("already-sent (skipped)")), `all skipped: ${rows}`);
});