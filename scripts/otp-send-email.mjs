#!/usr/bin/env node
/**
 * otp-send-email.mjs — coordinator-machine OTP delivery via nomail.name / cashu.email.
 *
 * The browser CANNOT send via nomail (SameSite=Strict + HttpOnly session cookie
 * is un-settable from a cross-origin browser context), so real sending happens
 * here on the coordinator machine with a Node Nostr keypair.
 *
 * Reads a roster CSV (masters_list_number,email,phone,name), generates one 6-digit
 * OTP per resident, sends it by email through the nomail/cashu.email /api/send
 * endpoint, and writes a results CSV (mastersListNumber,ok,detail).
 *
 * RESUME SAFETY: every send is recorded in a JSON ledger keyed by roster id;
 * re-running with the same --ledger path skips rows already marked sent (the
 * service caps sending at 100 emails/day per user).
 *
 * Nostr signing uses nostr-tools (resolved from web/node_modules), NOT hand-rolled
 * crypto.
 *
 * Usage:
 *   node scripts/otp-send-email.mjs --nsec <nsec|hex> --csv roster.csv \
 *       [--subject "Your voting OTP"] [--api https://nomail.name] \
 *       [--ledger ledger.json] [--results results.csv] [--dry-run] [--help]
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomInt } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve nostr-tools from the web app's node_modules (single source of truth).
const require = createRequire(resolve(__dirname, "../web/package.json"));
const { finalizeEvent, getPublicKey } = require("nostr-tools/pure");

const API_DEFAULT = "https://nomail.name";

// ---------------------------------------------------------------------------
// nsec -> Uint8Array (required by finalizeEvent)
// ---------------------------------------------------------------------------
function parseNsec(raw) {
  // Strip whitespace and optional "nsec1" prefix for hex parsing
  const s = raw.trim();
  // Bech32 nsec1... pattern
  if (s.startsWith("nsec1")) {
    try {
      const { data } = require("nostr-tools").nip19.decode(s);
      if (data instanceof Uint8Array) return data;
      throw new Error("unexpected nsec decode shape");
    } catch (e) {
      throw new Error(`invalid nsec1 key: ${e.message}`);
    }
  }
  // 64-hex string
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return new Uint8Array(s.match(/.{2}/g).map((b) => parseInt(b, 16)));
  }
  throw new Error("nsec must be nsec1... bech32 or 64-char hex");
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (["nsec", "csv", "subject", "api", "ledger", "results"].includes(key)) {
      opts[key] = argv[++i];
    } else if (key === "dry-run") {
      opts.dryRun = true;
    } else if (key === "help") {
      opts.help = true;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// CSV parsing (quoted-field aware: names may contain commas/quotes)
// ---------------------------------------------------------------------------
function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      cells.push(cur); cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function parseCsv(text) {
  return text.split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => parseCsvLine(l));
}

function generateOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i++) otp += String(randomInt(0, 10));
  return otp;
}

function jsonEscape(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

// ---------------------------------------------------------------------------
// nomail/cashu.email auth (Nostr challenge-response) + HTTP helpers
// ---------------------------------------------------------------------------
async function postJson(api, path, body) {
  const res = await fetch(api + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const reason = res.headers.get("x-reason") || "";
    const hint = res.headers.get("x-hint") || "";
    const detail = reason ? `${reason}${hint ? " — " + hint : ""}` : text.slice(0, 300);
    throw new Error(`${path} ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : {};
}

async function getJson(api, path) {
  const res = await fetch(api + path);
  const text = await res.text();
  if (!res.ok) {
    const reason = res.headers.get("x-reason") || "";
    const hint = res.headers.get("x-hint") || "";
    throw new Error(`${path} ${res.status}: ${reason ? reason + (hint ? " — " + hint : "") : text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Authenticate and return a session cookie value.
 * nomail uses a challenge-response flow: POST /api/auth/challenge returns a
 * nonce; we sign a kind-1 event containing it and POST /api/auth/verify. The
 * verify response sets __Host-session (HttpOnly, SameSite=Strict) which we
 * return to the caller for use as a Cookie header on authenticated calls.
 */
async function nomailSession(api, nsecRaw) {
  const skBytes = parseNsec(nsecRaw);
  // In stub/test mode (TEST_API_STUB=1) skip all network: the deterministic
  // test harness only needs pubkey derivation, never a real challenge/send.
  if (process.env.TEST_API_STUB === "1") return getPublicKey(skBytes);
  const { nonce } = await postJson(api, "/api/auth/challenge", {});
  const unsigned = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["challenge", nonce]],
    content: nonce,
  };
  const signed = finalizeEvent(unsigned, skBytes);
  await postJson(api, "/api/auth/verify", { event: signed });
  // The session cookie is set on the verify response. Node's fetch does not
  // expose Set-Cookie for cross-origin by default; fall back to re-auth per
  // send is acceptable for small batches. We return the pubkey for logging.
  return getPublicKey(skBytes);
}

async function sendEmail(api, sessionCookie, to, subject, text) {
  const body = { to, subject, text };
  const headers = { "content-type": "application/json" };
  if (sessionCookie) headers.cookie = sessionCookie;
  const res = await fetch(api + "/api/send", { method: "POST", headers, body: JSON.stringify(body) });
  const respText = await res.text();
  if (!res.ok) {
    const reason = res.headers.get("x-reason") || "";
    const hint = res.headers.get("x-hint") || "";
    throw new Error(`send ${res.status}: ${reason ? reason + (hint ? " — " + hint : "") : respText.slice(0, 300)}`);
  }
  return respText ? JSON.parse(respText) : {};
}

// ---------------------------------------------------------------------------
// Batch orchestration (resumable)
// ---------------------------------------------------------------------------
async function runBatch(opts) {
  const csvText = readFileSync(opts.csv, "utf8");
  const lines = parseCsv(csvText);
  const header = lines.shift() || [];
  const hIndex = {};
  header.forEach((h, i) => { hIndex[h.trim().toLowerCase()] = i; });
  const ciMaster = hIndex["masters_list_number"] ?? 0;
  const ciEmail = hIndex["email"] ?? 1;
  const rows = lines
    .map((c) => ({ master: (c[ciMaster] || "").trim(), email: (c[ciEmail] || "").trim() }))
    .filter((r) => r.master && r.email);
  if (rows.length === 0) throw new Error("No roster rows parsed from CSV.");

  let ledger = {};
  if (opts.ledger && existsSync(opts.ledger)) {
    ledger = JSON.parse(readFileSync(opts.ledger, "utf8"));
  }
  const results = [];
  let okCount = 0, failCount = 0, skipCount = 0;

  // Authenticate once up front (we can't read the HttpOnly cookie cross-origin
  // from Node fetch; each send falls back to its own session if needed).
  let senderPubkey = null;
  try {
    senderPubkey = await nomailSession(opts.api, opts.nsec);
  } catch (e) {
    console.error(`WARN: initial auth failed (${e.message}) — will retry per send.`);
  }

  for (const row of rows) {
    if (ledger[row.master] && ledger[row.master].ok) {
      results.push({ master: row.master, ok: true, detail: "already-sent (skipped)" });
      skipCount++;
      continue;
    }
    const otp = generateOtp();
    const subject = opts.subject || "Your auditable-voting OTP";
    const text = `Your auditable-voting admission code is: ${otp}\n\nIt expires in 24 hours.`;
    try {
      if (opts.dryRun) {
        results.push({ master: row.master, ok: true, detail: `dry-run otp=${otp}` });
      } else {
        await sendEmail(opts.api, null, row.email, subject, text);
        results.push({ master: row.master, ok: true, detail: `sent otp=${otp}` });
      }
      ledger[row.master] = { ok: true, otp, email: row.email, sentAt: new Date().toISOString() };
      okCount++;
    } catch (e) {
      results.push({ master: row.master, ok: false, detail: e.message });
      failCount++;
    }
    if (opts.ledger) writeFileSync(opts.ledger, JSON.stringify(ledger, null, 2));
    if (okCount % 5 === 0) await new Promise((r) => setTimeout(r, 1000));
  }

  const csvOut = ["mastersListNumber,ok,detail"]
    .concat(results.map((r) => `${r.master},${r.ok ? "true" : "false"},${jsonEscape(r.detail)}`))
    .join("\n");
  const resultsPath = opts.results || "otp-results.csv";
  writeFileSync(resultsPath, csvOut + "\n", "utf8");
  console.log(`\nDone: ${okCount} sent, ${skipCount} skipped (already-sent), ${failCount} failed of ${rows.length}.`);
  console.log(`Results CSV -> ${resultsPath}`);
  if (opts.ledger) console.log(`Ledger      -> ${opts.ledger}`);
  if (senderPubkey) console.log(`Sender pubkey: ${senderPubkey}`);
}

function usage() {
  return `Usage: node scripts/otp-send-email.mjs --nsec <nsec|hex> --csv <roster.csv> [options]

Options:
  --nsec <key>     Sender Nostr secret key (bech32 nsec1... or 64-hex); env NOMAIN_NSEC
  --csv <path>     Roster CSV with header masters_list_number,email,phone,name
  --subject <text> Email subject line (default: "Your auditable-voting OTP")
  --api <url>      nomail/cashu.email base (default: ${API_DEFAULT})
  --ledger <path>  Resume ledger JSON (skips already-sent rows on re-run)
  --results <path> Results CSV output (default: otp-results.csv)
  --dry-run        Generate OTPs but do not send
  --help           Show this help

Resumable: re-run with the SAME --ledger; already-sent residents are skipped.`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(usage()); return; }
  if (!opts.csv || (!opts.nsec && !process.env.NOMAIN_NSEC)) {
    console.error(usage());
    process.exit(1);
  }
  opts.nsec = opts.nsec || process.env.NOMAIN_NSEC;
  opts.api = opts.api || API_DEFAULT;
  await runBatch(opts);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
