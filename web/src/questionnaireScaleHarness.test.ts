import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Filter, type NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchQuestionnaireBlindResponses,
  fetchQuestionnaireResultSummary,
  fetchQuestionnaireSubmissionDecisions,
} from "./questionnaireTransport";
import {
  QUESTIONNAIRE_RESULT_SUMMARY_KIND,
} from "./questionnaireNostr";
import {
  QUESTIONNAIRE_RESPONSE_BLIND_KIND,
  QUESTIONNAIRE_SUBMISSION_DECISION_KIND,
} from "./questionnaireResponsePublish";

const relayState = vi.hoisted(() => ({
  events: [] as NostrEvent[],
  activeQueries: 0,
  maxConcurrentQueries: 0,
  queryFilters: [] as Filter[],
  ignoreQFilters: false,
}));

vi.mock("./sharedNostrPool", () => ({
  getSharedNostrPool: () => ({
    querySync: async (_relays: string[], filter: Filter) => {
      relayState.activeQueries += 1;
      relayState.maxConcurrentQueries = Math.max(relayState.maxConcurrentQueries, relayState.activeQueries);
      relayState.queryFilters.push(filter);
      await Promise.resolve();
      try {
        const limit = Math.max(1, Number(filter.limit ?? 200));
        const kinds = filter.kinds ?? [];
        const qTags = (filter as Filter & { "#q"?: string[] })["#q"] ?? [];
        if (relayState.ignoreQFilters && qTags.length > 0) {
          return [];
        }
        const until = typeof filter.until === "number" ? filter.until : Number.POSITIVE_INFINITY;
        return relayState.events
          .filter((event) => kinds.length === 0 || kinds.includes(event.kind))
          .filter((event) => event.created_at <= until)
          .filter((event) => {
            if (qTags.length === 0) {
              return true;
            }
            return event.tags.some((tag) => tag[0] === "q" && qTags.includes(tag[1]));
          })
          .sort((left, right) => Number(right.created_at ?? 0) - Number(left.created_at ?? 0))
          .slice(0, limit);
      } finally {
        relayState.activeQueries -= 1;
      }
    },
  }),
}));

const responseSecretKey = generateSecretKey();
const responsePubkeyHex = getPublicKey(responseSecretKey);
const responseNpub = nip19.npubEncode(responsePubkeyHex);
const coordinatorSecretKey = generateSecretKey();
const coordinatorPubkeyHex = getPublicKey(coordinatorSecretKey);
const coordinatorNpub = nip19.npubEncode(coordinatorPubkeyHex);

// Fixtures now carry real Schnorr signatures (the transport verifies every
// public event it reads), and signing each event is comparatively expensive.
// Keep the full 30-round shape and 100 voters for the selected round — the
// level the assertions care about — while trimming voters in the other rounds
// (they exist only so filtering and kind-only fallback are non-trivial).
const OTHER_ROUND_VOTERS = 3;

describe("questionnaire scale harness", () => {
  beforeEach(() => {
    relayState.events = [];
    relayState.activeQueries = 0;
    relayState.maxConcurrentQueries = 0;
    relayState.queryFilters = [];
    relayState.ignoreQFilters = false;
  });

  it("reads a selected round from 30 rounds and 100 voters without concurrent public REQs", async () => {
    const roundIds = Array.from({ length: 30 }, (_, index) => `q_scale_${String(index + 1).padStart(2, "0")}`);
    const selectedRound = roundIds[20];
    let createdAt = 1_800_000_000;
    for (const questionnaireId of roundIds) {
      const voterCount = questionnaireId === selectedRound ? 100 : OTHER_ROUND_VOTERS;
      for (let voterIndex = 0; voterIndex < voterCount; voterIndex += 1) {
        relayState.events.push(makeBlindResponseEvent({
          questionnaireId,
          responseId: `submission_${questionnaireId}_${voterIndex}`,
          tokenNullifier: `nullifier_${questionnaireId}_${voterIndex}`,
          createdAt: createdAt--,
        }));
        relayState.events.push(makeDecisionEvent({
          questionnaireId,
          submissionId: `submission_${questionnaireId}_${voterIndex}`,
          tokenNullifier: `nullifier_${questionnaireId}_${voterIndex}`,
          createdAt: createdAt--,
        }));
      }
      relayState.events.push(makeResultEvent({ questionnaireId, createdAt: createdAt-- }));
    }

    const [responses, decisions, results] = await Promise.all([
      fetchQuestionnaireBlindResponses({
        questionnaireId: selectedRound,
        limit: 150,
        readRelayLimit: 4,
        preferKindOnly: true,
      }),
      fetchQuestionnaireSubmissionDecisions({
        questionnaireId: selectedRound,
        limit: 150,
        readRelayLimit: 4,
        preferKindOnly: true,
      }),
      fetchQuestionnaireResultSummary({
        questionnaireId: selectedRound,
        limit: 20,
        readRelayLimit: 4,
        preferKindOnly: true,
      }),
    ]);

    expect(responses).toHaveLength(100);
    expect(decisions).toHaveLength(100);
    expect(results).toHaveLength(1);
    expect(relayState.maxConcurrentQueries).toBe(1);
    expect(relayState.queryFilters.some((filter) => (
      Array.isArray((filter as Filter & { "#q"?: string[] })["#q"])
      && (filter as Filter & { "#q"?: string[] })["#q"]?.includes(selectedRound)
    ))).toBe(true);
  }, 30_000);

  it("falls back to paginated kind-only reads when relays do not return tag-filtered events", async () => {
    const roundIds = Array.from({ length: 30 }, (_, index) => `q_scale_fallback_${String(index + 1).padStart(2, "0")}`);
    const selectedRound = roundIds[20];
    let createdAt = 1_800_010_000;
    for (const questionnaireId of roundIds) {
      const voterCount = questionnaireId === selectedRound ? 100 : OTHER_ROUND_VOTERS;
      for (let voterIndex = 0; voterIndex < voterCount; voterIndex += 1) {
        relayState.events.push(makeBlindResponseEvent({
          questionnaireId,
          responseId: `submission_${questionnaireId}_${voterIndex}`,
          tokenNullifier: `nullifier_${questionnaireId}_${voterIndex}`,
          createdAt: createdAt--,
        }));
        relayState.events.push(makeDecisionEvent({
          questionnaireId,
          submissionId: `submission_${questionnaireId}_${voterIndex}`,
          tokenNullifier: `nullifier_${questionnaireId}_${voterIndex}`,
          createdAt: createdAt--,
        }));
      }
      relayState.events.push(makeResultEvent({ questionnaireId, createdAt: createdAt-- }));
    }
    relayState.ignoreQFilters = true;

    const [responses, decisions, results] = await Promise.all([
      fetchQuestionnaireBlindResponses({
        questionnaireId: selectedRound,
        limit: 150,
        readRelayLimit: 4,
      }),
      fetchQuestionnaireSubmissionDecisions({
        questionnaireId: selectedRound,
        limit: 150,
        readRelayLimit: 4,
      }),
      fetchQuestionnaireResultSummary({
        questionnaireId: selectedRound,
        limit: 20,
        readRelayLimit: 4,
      }),
    ]);

    expect(responses).toHaveLength(100);
    expect(decisions).toHaveLength(100);
    expect(results).toHaveLength(1);
    expect(relayState.maxConcurrentQueries).toBe(1);
    expect(relayState.queryFilters.some((filter) => (
      Array.isArray((filter as Filter & { "#q"?: string[] })["#q"])
      && (filter as Filter & { "#q"?: string[] })["#q"]?.includes(selectedRound)
    ))).toBe(true);
    expect(relayState.queryFilters.some((filter) => (
      !Array.isArray((filter as Filter & { "#q"?: string[] })["#q"])
      && filter.kinds?.includes(QUESTIONNAIRE_RESPONSE_BLIND_KIND)
    ))).toBe(true);
  }, 30_000);
});

function baseEvent(input: {
  kind: number;
  secretKey: Uint8Array;
  questionnaireId: string;
  createdAt: number;
  content: unknown;
}): NostrEvent {
  return finalizeEvent({
    kind: input.kind,
    created_at: input.createdAt,
    tags: [
      ["q", input.questionnaireId],
      ["questionnaire", input.questionnaireId],
    ],
    content: JSON.stringify(input.content),
  }, input.secretKey);
}

function makeBlindResponseEvent(input: {
  questionnaireId: string;
  responseId: string;
  tokenNullifier: string;
  createdAt: number;
}) {
  return baseEvent({
    kind: QUESTIONNAIRE_RESPONSE_BLIND_KIND,
    secretKey: responseSecretKey,
    questionnaireId: input.questionnaireId,
    createdAt: input.createdAt,
    content: {
      schemaVersion: 1,
      eventType: "questionnaire_response_blind",
      questionnaireId: input.questionnaireId,
      responseId: input.responseId,
      submittedAt: input.createdAt,
      authorPubkey: responseNpub,
      tokenNullifier: input.tokenNullifier,
      tokenProof: {
        tokenCommitment: `commitment_${input.responseId}`,
        questionnaireId: input.questionnaireId,
        signature: "signature",
      },
      answers: [],
    },
  });
}

function makeDecisionEvent(input: {
  questionnaireId: string;
  submissionId: string;
  tokenNullifier: string;
  createdAt: number;
}) {
  return baseEvent({
    kind: QUESTIONNAIRE_SUBMISSION_DECISION_KIND,
    secretKey: coordinatorSecretKey,
    questionnaireId: input.questionnaireId,
    createdAt: input.createdAt,
    content: {
      schemaVersion: 1,
      eventType: "questionnaire_submission_decision",
      questionnaireId: input.questionnaireId,
      submissionId: input.submissionId,
      tokenNullifier: input.tokenNullifier,
      accepted: true,
      reason: "accepted",
      decidedAt: input.createdAt,
      coordinatorPubkey: coordinatorNpub,
    },
  });
}

function makeResultEvent(input: {
  questionnaireId: string;
  createdAt: number;
}) {
  return baseEvent({
    kind: QUESTIONNAIRE_RESULT_SUMMARY_KIND,
    secretKey: coordinatorSecretKey,
    questionnaireId: input.questionnaireId,
    createdAt: input.createdAt,
    content: {
      schemaVersion: 1,
      eventType: "questionnaire_result_summary",
      questionnaireId: input.questionnaireId,
      createdAt: input.createdAt,
      coordinatorPubkey: coordinatorNpub,
      acceptedResponseCount: 100,
      rejectedResponseCount: 0,
      questionSummaries: [],
    },
  });
}
