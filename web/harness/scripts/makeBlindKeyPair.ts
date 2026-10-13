#!/usr/bin/env node
/**
 * Generate `harness/blindKeyPair.ts` from a PEM RSA private key.
 *
 * Usage:
 *   openssl genrsa -out /tmp/av-harness-blind.pem 3072
 *   node harness/scripts/makeBlindKeyPair.ts /tmp/av-harness-blind.pem
 *
 * The harness needs a FIXED RSA keypair so that a whole round is byte-for-byte
 * reproducible: WebCrypto key generation is the only entropy-consuming step on
 * the harness path. This script exports OpenSSL's deterministic-NIST key as the
 * JWK pair the app's blind-signature module expects.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [, , pemPath, outPathArg] = process.argv;
if (!pemPath) {
  console.error("usage: node makeBlindKeyPair.ts <private-key.pem> [out.ts]");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = outPathArg ? resolve(outPathArg) : resolve(here, "../blindKeyPair.ts");

const privateKey = createPrivateKey(readFileSync(pemPath, "utf8"));
if (privateKey.asymmetricKeyType !== "rsa") {
  console.error(`expected an RSA key, got ${String(privateKey.asymmetricKeyType)}`);
  process.exit(1);
}

const privateJwk = privateKey.export({ format: "jwk" }) as Record<string, string>;
const publicJwk = createPublicKey(privateKey).export({ format: "jwk" }) as Record<string, string>;

// keyId must match the app: sha256(JSON({n,e})).slice(0, 24), lowercase hex.
const { createHash } = await import("node:crypto");
const keyId = createHash("sha256")
  .update(JSON.stringify({ n: publicJwk.n, e: publicJwk.e }))
  .digest("hex")
  .slice(0, 24);

const publicFields = {
  kty: "RSA",
  n: publicJwk.n,
  e: publicJwk.e,
  alg: "PS384",
  ext: true,
};
const privateFields = {
  kty: "RSA",
  n: privateJwk.n,
  e: privateJwk.e,
  d: privateJwk.d,
  p: privateJwk.p,
  q: privateJwk.q,
  dp: privateJwk.dp,
  dq: privateJwk.dq,
  qi: privateJwk.qi,
  alg: "PS384",
  ext: true,
};

const body = `/**
 * A fixed blind-signing keypair for the harness.
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *
 *   openssl genrsa -out /tmp/av-harness-blind.pem 3072
 *   node harness/scripts/makeBlindKeyPair.ts /tmp/av-harness-blind.pem
 *
 * WebCrypto RSA key generation is the only entropy-consuming step on the harness
 * path, so committing a fixed keypair is what makes a whole round byte-for-byte
 * reproducible. The key is a PUBLIC test fixture with no value; it must never be
 * used outside the harness.
 */
import type { QuestionnaireBlindPrivateKey } from "../src/questionnaireBlindSignature";

export const HARNESS_BLIND_KEY_SCHEME = "rsabssa-sha384-pss-deterministic-v1";

export const HARNESS_BLIND_KEY_ID = ${JSON.stringify(keyId)};

export const HARNESS_BLIND_KEY_PAIR: QuestionnaireBlindPrivateKey = {
  scheme: HARNESS_BLIND_KEY_SCHEME,
  keyId: HARNESS_BLIND_KEY_ID,
  jwk: ${JSON.stringify(publicFields, null, 2)},
  privateJwk: ${JSON.stringify(privateFields, null, 2)},
};
`;

writeFileSync(outPath, body, "utf8");
console.log(`wrote ${outPath} (keyId ${keyId})`);
