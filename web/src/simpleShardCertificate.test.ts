import { beforeEach, describe, expect, it, vi } from "vitest";

const querySync = vi.fn();
const subscribeMany = vi.fn();
const resolveNip65OutboxRelays = vi.fn();
const verifyEvent = vi.fn();
const decode = vi.fn();
const npubEncode = vi.fn();

vi.mock("@cloudflare/blindrsa-ts", () => ({
  RSABSSA: {
    SHA384: {
      PSS: {
        Deterministic: () => ({
          prepare: vi.fn(),
          blind: vi.fn(),
          blindSign: vi.fn(),
          finalize: vi.fn(),
          verify: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("nostr-tools", () => ({
  finalizeEvent: vi.fn(),
  getPublicKey: vi.fn(),
  verifyEvent,
  nip19: {
    decode,
    npubEncode,
    nsecEncode: vi.fn(),
  },
}));

vi.mock("./sharedNostrPool", () => ({
  getSharedNostrPool: () => ({ querySync, subscribeMany }),
}));

vi.mock("./nip65RelayHints", () => ({
  publishOwnNip65RelayHints: vi.fn(),
  resolveNip65OutboxRelays,
}));

vi.mock("./nostrPublishQueue", () => ({
  queueNostrPublish: (task: () => Promise<unknown>) => task(),
  publishToRelaysStaggered: async (
    publishSingleRelay: (relay: string) => Promise<unknown>,
    relays: string[],
  ) => Promise.allSettled(relays.map((relay) => publishSingleRelay(relay))),
}));

vi.mock("./wasm/auditableVotingCore", () => ({
  normalizeRelaysRust: (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))),
  sha256HexRust: vi.fn(async (input: string) => {
    // Deterministic mock so token-derivation tests do not depend on the wasm core.
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }),
}));

function makeKeyAnnouncementEvent(input: {
  pubkey: string;
  votingId: string;
  keyId: string;
  created_at?: number;
}): any {
  return {
    id: `key-ann-${input.keyId}`,
    kind: 38993,
    pubkey: input.pubkey,
    created_at: input.created_at ?? 1000,
    sig: `sig-${input.keyId}`,
    tags: [],
    content: JSON.stringify({
      voting_id: input.votingId,
      scheme: "rsabssa-sha384-pss-deterministic-v1",
      key_id: input.keyId,
      bits: 3072,
      hash: "SHA-384",
      salt_length: 48,
      n: `n-${input.keyId}`,
      e: `e-${input.keyId}`,
      created_at: new Date((input.created_at ?? 1000) * 1000).toISOString(),
    }),
  };
}

function makeShardCertificate(input: {
  shareId: string;
  coordinatorNpub: string;
  pubkeyHex: string;
  votingId: string;
  tokenMessage: string;
  shareIndex: number;
  keyId: string;
}) {
  return {
    shareId: input.shareId,
    requestId: `request-${input.shareId}`,
    coordinatorNpub: input.coordinatorNpub,
    votingId: input.votingId,
    tokenMessage: input.tokenMessage,
    unblindedSignature: `sig-${input.shareId}`,
    shareIndex: input.shareIndex,
    createdAt: new Date().toISOString(),
    keyAnnouncementEvent: makeKeyAnnouncementEvent({
      pubkey: input.pubkeyHex,
      votingId: input.votingId,
      keyId: input.keyId,
    }),
  };
}

describe("simpleShardCertificate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decode.mockReturnValue({ type: "npub", data: "ab".repeat(32) });
    // npubEncode maps distinct pubkey hex prefixes to distinct coordinator
    // npubs so multi-coordinator key announcements parse to the right signer.
    npubEncode.mockImplementation((pubkey: string) => {
      if (typeof pubkey !== "string") {
        return "npub1coord";
      }
      switch (pubkey[0]) {
        case "1":
          return "npub1coord1";
        case "2":
          return "npub1coord2";
        default:
          return "npub1coord";
      }
    });
    verifyEvent.mockReturnValue(true);
    resolveNip65OutboxRelays.mockImplementation(async ({ fallbackRelays }: { fallbackRelays: string[] }) => fallbackRelays);
    subscribeMany.mockReturnValue({ close: vi.fn(async () => undefined) });
  });

  it("backfills missed blind key announcements after subscription setup", async () => {
    vi.useRealTimers();
    const mod = await import("./simpleShardCertificate");
    const onAnnouncement = vi.fn();

    querySync
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "blind-key-1",
          kind: mod.SIMPLE_BLIND_KEY_KIND,
          pubkey: "ab".repeat(32),
          created_at: 50,
          content: JSON.stringify({
            voting_id: "vote-1",
            scheme: mod.SIMPLE_BLIND_SCHEME,
            key_id: "key-1",
            bits: mod.SIMPLE_BLIND_KEY_BITS,
            hash: mod.SIMPLE_BLIND_HASH,
            salt_length: mod.SIMPLE_BLIND_SALT_LENGTH,
            n: "n-value",
            e: "e-value",
            created_at: "2026-04-07T01:00:00.000Z",
          }),
        },
      ]);

    const unsubscribe = mod.subscribeLatestSimpleBlindKeyAnnouncement({
      coordinatorNpub: "npub1coord",
      votingId: "vote-1",
      onAnnouncement,
    });

    await vi.waitFor(() => {
      expect(querySync).toHaveBeenCalledTimes(1);
      expect(onAnnouncement).toHaveBeenCalledWith(null);
    });
    await new Promise((resolve) => setTimeout(resolve, 5200));

    await vi.waitFor(() => {
      expect(querySync).toHaveBeenCalledTimes(2);
      expect(onAnnouncement).toHaveBeenLastCalledWith(expect.objectContaining({
        coordinatorNpub: "npub1coord",
        votingId: "vote-1",
        publicKey: expect.objectContaining({
          keyId: "key-1",
        }),
      }));
    });

    unsubscribe();
  }, 10000);
});

describe("shard-derive threshold (t>=2 capability, shipped default t=1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyEvent.mockReturnValue(true);
    // npubEncode maps distinct pubkey hex prefixes to distinct coordinator
    // npubs so each key announcement parses as the intended signer.
    npubEncode.mockImplementation((pubkey: string) => {
      if (typeof pubkey !== "string") {
        return "npub1coord";
      }
      switch (pubkey[0]) {
        case "1":
          return "npub1coord1";
        case "2":
          return "npub1coord2";
        default:
          return "npub1coord";
      }
    });
  });

  it("derives a ballot token with a single coordinator by default (t=1 shipped semantics)", async () => {
    const mod = await import("./simpleShardCertificate");
    // The shipped default is single-coordinator: one valid share is enough.
    expect(mod.SIMPLE_MIN_SIGNER_THRESHOLD).toBe(1);

    const singleCert = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });

    const tokenId = await mod.deriveTokenIdFromSimpleShardCertificates([singleCert]);
    expect(tokenId).toBeTruthy();
    expect(tokenId).toHaveLength(20);
  });

  it("derives a ballot token from two distinct coordinators when threshold=2", async () => {
    const mod = await import("./simpleShardCertificate");

    const cert1 = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });
    const cert2 = makeShardCertificate({
      shareId: "cert-2",
      coordinatorNpub: "npub1coord2",
      pubkeyHex: "22".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 2,
      keyId: "key-2",
    });

    // Two distinct coordinators with a shared token commitment satisfy t=2.
    const tokenId = await mod.deriveTokenIdFromSimpleShardCertificates(
      [cert1, cert2],
      { threshold: 2 },
    );
    expect(tokenId).toBeTruthy();
    expect(tokenId).toHaveLength(20);
  });

  it("returns null with only one coordinator when threshold=2", async () => {
    const mod = await import("./simpleShardCertificate");

    const singleCert = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });

    // A lone coordinator can never satisfy an explicit t>=2 threshold.
    const tokenId = await mod.deriveTokenIdFromSimpleShardCertificates(
      [singleCert],
      { threshold: 2 },
    );
    expect(tokenId).toBeNull();
  });

  it("returns null when both shares come from the same coordinator and threshold=2", async () => {
    const mod = await import("./simpleShardCertificate");

    const cert1 = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });
    const cert2 = makeShardCertificate({
      shareId: "cert-2",
      coordinatorNpub: "npub1coord1", // SAME coordinator, different share
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 2,
      keyId: "key-2",
    });

    // Signer distinctness is counted by coordinator identity, not share index.
    const tokenId = await mod.deriveTokenIdFromSimpleShardCertificates(
      [cert1, cert2],
      { threshold: 2 },
    );
    expect(tokenId).toBeNull();
  });

  it("returns null when token commitments differ across coordinators", async () => {
    const mod = await import("./simpleShardCertificate");

    const cert1 = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });
    const cert2 = makeShardCertificate({
      shareId: "cert-2",
      coordinatorNpub: "npub1coord2",
      pubkeyHex: "22".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-different", // DIFFERENT commitment
      shareIndex: 2,
      keyId: "key-2",
    });

    const tokenId = await mod.deriveTokenIdFromSimpleShardCertificates(
      [cert1, cert2],
      { threshold: 2 },
    );
    expect(tokenId).toBeNull();
  });

  it("derives a token with threshold=0 (legacy opt-out)", async () => {
    const mod = await import("./simpleShardCertificate");

    const singleCert = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });

    // threshold 0 disables the distinct-coordinator check (backwards compat).
    const tokenId = await mod.deriveTokenIdFromSimpleShardCertificates(
      [singleCert],
      { threshold: 0 },
    );
    expect(tokenId).toBeTruthy();
    expect(tokenId).toHaveLength(20);
  });

  it("accepts the legacy numeric length argument unchanged", async () => {
    const mod = await import("./simpleShardCertificate");

    const singleCert = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });

    // Pre-threshold callers passed a numeric token length as the 2nd argument.
    const tokenId = await mod.deriveTokenIdFromSimpleShardCertificates([singleCert], 12);
    expect(tokenId).toBeTruthy();
    expect(tokenId).toHaveLength(12);
  });

  it("applies the same threshold rule to public shard proofs", async () => {
    const mod = await import("./simpleShardCertificate");

    const cert1 = makeShardCertificate({
      shareId: "cert-1",
      coordinatorNpub: "npub1coord1",
      pubkeyHex: "11".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 1,
      keyId: "key-1",
    });
    const proof1 = mod.toSimplePublicShardProof(cert1);

    // One distinct coordinator cannot satisfy an explicit threshold of 2...
    const loneTokenId = await mod.deriveTokenIdFromSimplePublicShardProofs(
      [proof1],
      { threshold: 2 },
    );
    expect(loneTokenId).toBeNull();

    // ...but two distinct coordinators can, and the default t=1 accepts one.
    const cert2 = makeShardCertificate({
      shareId: "cert-2",
      coordinatorNpub: "npub1coord2",
      pubkeyHex: "22".repeat(32),
      votingId: "vote-1",
      tokenMessage: "commit-1",
      shareIndex: 2,
      keyId: "key-2",
    });
    const proof2 = mod.toSimplePublicShardProof(cert2);
    const pairTokenId = await mod.deriveTokenIdFromSimplePublicShardProofs(
      [proof1, proof2],
      { threshold: 2 },
    );
    expect(pairTokenId).toBeTruthy();
    expect(pairTokenId).toHaveLength(20);

    const defaultTokenId = await mod.deriveTokenIdFromSimplePublicShardProofs([proof1]);
    expect(defaultTokenId).toBeTruthy();
    expect(defaultTokenId).toHaveLength(20);
  });
});
