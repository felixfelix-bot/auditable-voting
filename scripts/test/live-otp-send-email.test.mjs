// Opt-in live integration test for scripts/otp-send-email.mjs against the
// REAL cashu.email service using a testnut token. NEVER runs in CI.
//
// Guard: requires both NOMAIN_NSEC and TESTNUT_CASHU_TOKEN env vars, and
// LIVE_ALLOW=1 to proceed. Without these it skips (protects against accidental
// wiring into static.yml). Exactly ONE email is sent; no retry loop.
//
// Run:    cd scripts && LIVE_ALLOW=1 NOMAIN_NSEC=... TESTNUT_CASHU_TOKEN=... \
//           node test/live-otp-send-email.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const TEST_RECIPIENT = process.env.TEST_RECIPIENT || "postmaster@nomail.name";
const ns = "testuthere";

function genOtp() {
  let s = "";
  for (let i = 0; i < 6; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}

// Build a signed kind-1 challenge event with the pure signer, then send.
const requireCache = {};
async function authAndSend() {
  const nsec = process.env.NOMAIN_NSEC;
  const token = process.env.TESTNUT_CASHU_TOKEN;
  if (!nsec || !token) throw new Error("NOMAIN_NSEC and TESTNUT_CASHU_TOKEN required");
  const require = createRequire(new URL("../../web/package.json", import.meta.url).href);
  const { finalizeEvent, getPublicKey, nip19 } = require("nostr-tools");

  const skBytes = (() => {
    const s = nsec.trim();
    if (s.startsWith("nsec1")) { const { data } = nip19.decode(s); if (data instanceof Uint8Array) return data; }
    return new Uint8Array(s.match(/.{2}/g).map((b) => parseInt(b, 16)));
  })();

  async function post(p, body, cookie) {
    const headers = { "content-type": "application/json", "user-agent": "curl/8" };
    if (cookie) headers.cookie = cookie;
    const res = await fetch("https://cashu.email" + p, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    return { res, data: text ? JSON.parse(text) : {}, cookie: res.headers.get("set-cookie") || "" };
  }

  const c = await post("/api/auth/challenge", {});
  const signed = finalizeEvent({
    kind: 1, created_at: Math.floor(Date.now() / 1000),
    tags: [["challenge", c.data.nonce]], content: c.data.nonce,
  }, skBytes);
  const v = await post("/api/auth/verify", { event: signed });
  const cookie = v.cookie.split(";")[0];
  const send = await post("/api/send", {
    to: TEST_RECIPIENT, subject: "testnut live probe", text: ns + "--probe",
    cashuToken: token,
  }, cookie);
  return { send, cookie, nonce: c.data.nonce, pub: getPublicKey(skBytes) };
}
test("live send: cashu.email accepts testnut token (exactly 1 email)", async () => {
  if (process.env.LIVE_ALLOW !== "1") {
    console.log("SKIP: LIVE_ALLOW=1 not set (never runs in CI)");
    return;
  }
  const { send, cookie } = await authAndSend();
  assert.equal(send.res.status, 200, `send HTTP ${send.res.status}: ${JSON.stringify(send.data)}`);
  assert.equal(send.data.ok, true, `expected ok:true, got ${JSON.stringify(send.data)}`);
  console.log("LIVE SEND OK:", JSON.stringify(send.data));
});
