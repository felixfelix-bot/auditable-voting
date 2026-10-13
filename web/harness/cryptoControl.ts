/**
 * Deterministic `crypto.getRandomValues` for the harness.
 *
 * After fixed identities, fixed timestamps and an injected blind-signing keypair,
 * the only remaining entropy on the harness path is the blinding factor that
 * `@cloudflare/blindrsa-ts` draws with `crypto.getRandomValues` when it blinds a
 * token. That is enough to make two otherwise identical rounds produce different
 * signatures, so the harness owns this too.
 *
 * ## Two modes
 *
 * - `"fixed"` — every `getRandomValues` call gets bytes from a deterministic
 *   stream keyed by a fixed seed. Rounds become byte-for-byte reproducible.
 * - `"random"` — delegate to the real CSPRNG. Use this when the test is
 *   specifically about unlinkability: the whole point of a blind signature is
 *   that the same voter minting twice produces different signatures. Freezing
 *   the blinding factor would make the harness *hide* a real privacy bug.
 *
 * `crypto.subtle` is left untouched (captured before the swap and delegated to),
 * so RSA key generation and digesting keep working normally. This module is
 * Node-only, like the rest of `harness/`.
 *
 * Module-level, documented, and restored by `dispose()` — nothing in `src/` is
 * aware of it.
 */
import { createHash } from "node:crypto";

export type CryptoMode = "fixed" | "random";

type CryptoGlobal = Crypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };

let originalDescriptor: PropertyDescriptor | undefined;
let installed = false;
/**
 * The active deterministic byte stream. Read at call time by the wrapper, and
 * RE-CREATED on every `installDeterministicCrypto` call, so two harnesses in the
 * same process each start from the same bytes. Without the reset, a second
 * harness would inherit the first harness's stream position and produce
 * different (though still internally consistent) signatures.
 */
let stream: ((length: number) => Uint8Array) | null = null;

const DEFAULT_SEED = "auditable-voting-harness-v1";

function seedBytes(seed: string): Buffer {
  return createHash("sha256").update(seed).digest();
}

/**
 * Deterministic byte stream: `sha256(seed || counter)` blocks concatenated.
 * Never returns all-zero or low-entropy bytes, so the blinder's coprimality
 * check does not retry thousands of times.
 */
function createSeedStream(seed: string): (length: number) => Uint8Array {
  const prefix = seedBytes(seed);
  let counter = 0;
  return (length: number) => {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const block = createHash("sha256")
        .update(prefix)
        .update(Buffer.from(String(counter), "utf8"))
        .digest();
      counter += 1;
      const take = Math.min(block.length, length - offset);
      out.set(block.subarray(0, take), offset);
      offset += take;
    }
    return out;
  };
}

export type InstallCryptoOptions = {
  mode?: CryptoMode;
  seed?: string;
};

/**
 * Replace `globalThis.crypto` with a wrapper that controls `getRandomValues`.
 * Idempotent; `restoreDeterministicCrypto()` undoes it.
 */
export function installDeterministicCrypto(options: InstallCryptoOptions = {}): void {
  const mode = options.mode ?? "fixed";
  const realCrypto = globalThis.crypto as CryptoGlobal;
  if (!realCrypto) {
    throw new Error("No global crypto available to harness.");
  }
  // Always re-seed, even when the wrapper is already installed, so a second
  // harness in the same process starts from byte zero of the stream.
  stream = mode === "fixed" ? createSeedStream(options.seed ?? DEFAULT_SEED) : null;

  if (installed) {
    return;
  }

  // Capture the real primitives BEFORE swapping the global away.
  const realSubtle = realCrypto.subtle;
  const realGetRandomValues = realCrypto.getRandomValues.bind(realCrypto);
  const realRandomUUID = realCrypto.randomUUID.bind(realCrypto);
  const realTimingSafeEqual = realCrypto.timingSafeEqual;

  const wrapper = Object.create(realCrypto) as CryptoGlobal;
  // `subtle` is typed read-only, but this is a fresh object with the real crypto
  // as its prototype: assigning the captured real value keeps RSA + digests
  // working after the global swap.
  Object.defineProperty(wrapper, "subtle", { value: realSubtle, configurable: true, writable: true });
  wrapper.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (array == null) {
      return array;
    }
    const view = array as unknown as Uint8Array;
    const active = stream;
    if (!active) {
      realGetRandomValues(view);
      return array;
    }
    view.set(active(view.length));
    return array;
  }) as Crypto["getRandomValues"];
  // In fixed mode, UUIDs must also be stable: they are a ready-made entropy
  // source that would otherwise leak in the moment a call site adopts them.
  wrapper.randomUUID = (() => {
    const active = stream;
    if (!active) {
      return realRandomUUID();
    }
    const bytes = active(16);
    // RFC 4122 version 4 layout, from the deterministic stream.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }) as Crypto["randomUUID"];
  if (realTimingSafeEqual) {
    wrapper.timingSafeEqual = realTimingSafeEqual.bind(realCrypto);
  }

  originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: wrapper,
    configurable: true,
    writable: true,
  });
  installed = true;
}

/** Re-seed (or disable) the deterministic stream without touching the globals. */
export function resetDeterministicCryptoStream(seed?: string): void {
  stream = seed === undefined ? null : createSeedStream(seed);
}

/** Restore the real `globalThis.crypto`. Idempotent. */
export function restoreDeterministicCrypto(): void {
  if (!installed) {
    return;
  }
  installed = false;
  stream = null;
  if (originalDescriptor) {
    Object.defineProperty(globalThis, "crypto", originalDescriptor);
  } else {
    delete (globalThis as { crypto?: unknown }).crypto;
  }
  originalDescriptor = undefined;
}

/** True while the deterministic crypto wrapper is installed. */
export function deterministicCryptoInstalled(): boolean {
  return installed;
}
