import { describe, expect, it, vi } from "vitest";
import { validateSimpleSubmittedVotes } from "./simpleVoteValidation";

vi.mock("./simpleShardCertificate", () => ({
  SIMPLE_MIN_SIGNER_THRESHOLD: 2,
  verifySimplePublicShardProof: async (proof: { id: string }) => (
    proof.id === "valid-proof"
      ? {
          coordinatorNpub: "npub1coord",
          votingId: "vote-1",
          tokenCommitment: "commit-1",
          shareIndex: 1,
          publicKey: { keyId: "key-1" },
          keyAnnouncement: { votingId: "vote-1" },
          event: proof,
        }
      : proof.id === "valid-proof-2"
        ? {
            coordinatorNpub: "npub1coord2",
            votingId: "vote-1",
            tokenCommitment: "commit-1",
            shareIndex: 1,
            publicKey: { keyId: "key-2" },
            keyAnnouncement: { votingId: "vote-1" },
            event: proof,
          }
        : proof.id === "valid-proof-3"
          ? {
              coordinatorNpub: "npub1coord3",
              votingId: "vote-1",
              tokenCommitment: "commit-1",
              shareIndex: 1,
              publicKey: { keyId: "key-3" },
              keyAnnouncement: { votingId: "vote-1" },
              event: proof,
            }
          : proof.id === "wrong-round"
            ? {
                coordinatorNpub: "npub1coord2",
                votingId: "vote-x",
                tokenCommitment: "commit-1",
                shareIndex: 1,
                publicKey: { keyId: "key-2" },
                keyAnnouncement: { votingId: "vote-x" },
                event: proof,
              }
            : null
  ),
  parseSimplePublicShardProof: () => null,
}));

function makeVote(input: {
  eventId: string;
  shardProofs: Array<{ id: string }>;
  tokenId?: string | null;
  createdAt?: string;
}): any {
  return {
    eventId: input.eventId,
    votingId: "vote-1",
    voterNpub: "npub1ballot",
    choice: "Yes",
    shardProofs: input.shardProofs,
    tokenId: input.tokenId === undefined ? "token-1" : input.tokenId,
    createdAt: input.createdAt ?? "2026-03-31T00:00:00.000Z",
  };
}

describe("simpleVoteValidation", () => {
  it("marks votes valid when two distinct coordinators have signed shard proofs", async () => {
    const results = await validateSimpleSubmittedVotes([
      makeVote({
        eventId: "vote-1",
        shardProofs: [{ id: "valid-proof" }, { id: "valid-proof-2" }],
      }),
    ], 2, ["npub1coord", "npub1coord2"]);

    expect(results[0]).toEqual({
      vote: makeVote({
        eventId: "vote-1",
        shardProofs: [{ id: "valid-proof" }, { id: "valid-proof-2" }],
      }),
      valid: true,
      reason: "Valid",
    });
  });

  it("rejects a ballot minted by a single corrupt coordinator (threshold 2 lock)", async () => {
    const results = await validateSimpleSubmittedVotes([
      makeVote({
        eventId: "vote-1",
        shardProofs: [{ id: "valid-proof" }],
      }),
    ], 2, ["npub1coord"]);

    expect(results[0].valid).toBe(false);
    expect(results[0].reason).toBe("Not enough valid shards");
  });

  it("clamps a call-site threshold of 1 up to the minimum of 2", async () => {
    const results = await validateSimpleSubmittedVotes([
      makeVote({
        eventId: "vote-1",
        shardProofs: [{ id: "valid-proof" }],
      }),
    ], 1, ["npub1coord"]);

    expect(results[0].valid).toBe(false);
    expect(results[0].reason).toBe("Not enough valid shards");
  });

  it("marks votes invalid when shard proofs are missing", async () => {
    const results = await validateSimpleSubmittedVotes([
      makeVote({ eventId: "vote-1", shardProofs: [], tokenId: null }),
    ], 2, ["npub1coord"]);

    expect(results[0].valid).toBe(false);
    expect(results[0].reason).toBe("Not enough valid shards");
  });

  it("marks duplicate combined tokens invalid using canonical event ordering", async () => {
    const twoShards = [{ id: "valid-proof" }, { id: "valid-proof-2" }];
    const results = await validateSimpleSubmittedVotes([
      makeVote({ eventId: "vote-later", shardProofs: twoShards, createdAt: "2026-03-31T00:01:00.000Z" }),
      makeVote({ eventId: "vote-earlier", shardProofs: twoShards, createdAt: "2026-03-31T00:00:00.000Z" }),
    ], 2, ["npub1coord", "npub1coord2"]);

    expect(results[0].vote.eventId).toBe("vote-earlier");
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].reason).toBe("Duplicate token");
  });

  it("accepts distinct authorized coordinator shares even when share indexes match", async () => {
    const results = await validateSimpleSubmittedVotes([
      makeVote({
        eventId: "vote-1",
        shardProofs: [{ id: "valid-proof" }, { id: "valid-proof-2" }],
      }),
    ], 2, ["npub1coord", "npub1coord2"]);

    expect(results[0].valid).toBe(true);
    expect(results[0].reason).toBe("Valid");
  });

  it("rejects shares from unauthorized coordinators", async () => {
    const results = await validateSimpleSubmittedVotes([
      makeVote({
        eventId: "vote-1",
        shardProofs: [{ id: "valid-proof" }, { id: "valid-proof-3" }],
      }),
    ], 2, ["npub1coord", "npub1coord2"]);

    expect(results[0].valid).toBe(false);
    expect(results[0].reason).toBe("Unauthorized organiser share");
  });

  it("rejects proofs that bind to a different round", async () => {
    const results = await validateSimpleSubmittedVotes([
      makeVote({
        eventId: "vote-1",
        shardProofs: [{ id: "valid-proof" }, { id: "wrong-round" }],
      }),
    ], 2, ["npub1coord", "npub1coord2"]);

    expect(results[0].valid).toBe(false);
    expect(results[0].reason).toBe("Mismatched voting id");
  });
});
