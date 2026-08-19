import { describe, expect, it } from "vitest";
import { generatePaperBallot } from "./paperBallot";
import type { QuestionnaireDefinition } from "./questionnaireProtocol";
import { deriveNpubFromNsec } from "./nostrIdentity";

const TEST_NSEC = "nsec1c6gfkn8p0kcjn3dws63hgllgu6pa5q37ag084jzg8g6nnkpztxdq6zs0r2";
const TEST_NPUB = "npub1w7vr0zenyuhtzhzwa7yne4zw3gw0aq8mp30r2f9p99e365lh757q77pvrv";

const minimalDefinition: QuestionnaireDefinition = {
  schemaVersion: 1,
  eventType: "questionnaire_definition",
  responseMode: "public_submission_v1",
  questionnaireId: "q_test123",
  title: "Test Ballot",
  createdAt: 1000,
  openAt: 1000,
  closeAt: 2000,
  coordinatorPubkey: "abc123",
  coordinatorEncryptionPubkey: "def456",
  responseVisibility: "public",
  eligibilityMode: "open",
  allowMultipleResponsesPerPubkey: false,
  questions: [
    { questionId: "q1", type: "yes_no", prompt: "Do you agree?", required: true },
    { questionId: "q2", type: "free_text", prompt: "Comments:", required: false, maxLength: 500 },
  ],
};

describe("generatePaperBallot", () => {
  it("generates a paper ballot from a definition with nsec and npub", () => {
    const ballot = generatePaperBallot({ definition: minimalDefinition, voterNsec: TEST_NSEC });

    expect(ballot.questionnaireId).toBe("q_test123");
    expect(ballot.questionnaireTitle).toBe("Test Ballot");
    expect(ballot.voterNsec).toBe(TEST_NSEC);
    expect(ballot.voterNpub).toBe(TEST_NPUB);
    expect(ballot.inviteCode).toBeUndefined();
    expect(ballot.generatedAt).toBeGreaterThan(0);
    expect(typeof ballot.generatedAt).toBe("number");
    expect(ballot.questions).toHaveLength(2);
  });

  it("includes invite code when provided", () => {
    const ballot = generatePaperBallot({
      definition: minimalDefinition,
      voterNsec: TEST_NSEC,
      inviteCode: "abc123def456",
    });

    expect(ballot.inviteCode).toBe("abc123def456");
  });

  it("omits invite code when not provided", () => {
    const ballot = generatePaperBallot({ definition: minimalDefinition, voterNsec: TEST_NSEC });

    expect(ballot.inviteCode).toBeUndefined();
  });

  it("formats questions with correct type and prompt", () => {
    const ballot = generatePaperBallot({ definition: minimalDefinition, voterNsec: TEST_NSEC });

    expect(ballot.questions[0].questionId).toBe("q1");
    expect(ballot.questions[0].prompt).toBe("Do you agree?");
    expect(ballot.questions[0].type).toBe("yes_no");

    expect(ballot.questions[1].questionId).toBe("q2");
    expect(ballot.questions[1].prompt).toBe("Comments:");
    expect(ballot.questions[1].type).toBe("free_text");
  });

  it("formats multiple choice questions with options", () => {
    const mcDefinition: QuestionnaireDefinition = {
      ...minimalDefinition,
      questionnaireId: "q_mc_test",
      title: "MC Ballot",
      questions: [
        {
          questionId: "q1",
          type: "multiple_choice",
          prompt: "Choose one:",
          required: true,
          multiSelect: false,
          options: [
            { optionId: "opt_a", label: "Option A" },
            { optionId: "opt_b", label: "Option B" },
          ],
        },
      ],
    };

    const ballot = generatePaperBallot({ definition: mcDefinition, voterNsec: TEST_NSEC });

    expect(ballot.questions[0].type).toBe("multiple_choice");
    expect(ballot.questions[0].prompt).toBe("Choose one:");
    expect(ballot.questions[0].options).toHaveLength(2);
    expect(ballot.questions[0].options[0].optionId).toBe("opt_a");
    expect(ballot.questions[0].options[0].label).toBe("Option A");
    expect(ballot.questions[0].options[1].optionId).toBe("opt_b");
    expect(ballot.questions[0].options[1].label).toBe("Option B");
  });

  it("formats rank questions with options", () => {
    const rankDefinition: QuestionnaireDefinition = {
      ...minimalDefinition,
      questionnaireId: "q_rank_test",
      title: "Rank Ballot",
      questions: [
        {
          questionId: "q1",
          type: "rank",
          prompt: "Rank these:",
          required: true,
          options: [
            { optionId: "r1", label: "First" },
            { optionId: "r2", label: "Second" },
            { optionId: "r3", label: "Third" },
          ],
          minimumRanked: 2,
        },
      ],
    };

    const ballot = generatePaperBallot({ definition: rankDefinition, voterNsec: TEST_NSEC });

    expect(ballot.questions[0].type).toBe("rank");
    expect(ballot.questions[0].options).toHaveLength(3);
    expect(ballot.questions[0].options[0].label).toBe("First");
  });

  it("uses real current time for generatedAt", () => {
    const before = Date.now();
    const ballot = generatePaperBallot({ definition: minimalDefinition, voterNsec: TEST_NSEC });
    const after = Date.now();

    expect(ballot.generatedAt).toBeGreaterThanOrEqual(before);
    expect(ballot.generatedAt).toBeLessThanOrEqual(after);
  });

  it("derives npub correctly from nsec", () => {
    const ballot = generatePaperBallot({ definition: minimalDefinition, voterNsec: TEST_NSEC });

    expect(ballot.voterNpub).toBe(deriveNpubFromNsec(TEST_NSEC));
  });
});