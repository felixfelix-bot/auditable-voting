import { describe, expect, it } from "vitest";
import { generatePaperBallot } from "./paperBallot";
import type { QuestionnaireDefinition } from "./questionnaireProtocol";

export const paperDefinition: QuestionnaireDefinition = {
  schemaVersion: 1, eventType: "questionnaire_definition", responseMode: "blind_token",
  questionnaireId: "q_paper", title: "Test Ballot", createdAt: 1000, openAt: 1000, closeAt: 2000,
  coordinatorPubkey: "a".repeat(64), coordinatorEncryptionPubkey: "b".repeat(64),
  responseVisibility: "public", eligibilityMode: "open", allowMultipleResponsesPerPubkey: false,
  questions: [
    { questionId: "q1", type: "yes_no", prompt: "Do you agree?", required: true },
    { questionId: "q2", type: "free_text", maxLength: 1000, prompt: "Why?", required: true,
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } } },
  ],
};

describe("generatePaperBallot", () => {
  it("uses paper admission fields without any voter identity or separate serial", () => {
    const ballot = generatePaperBallot({ definition: paperDefinition, masterlistNumber: "ML-001", code: "ABCD1234EF", expiresAt: "2030-01-01T00:00:00Z" });
    expect(ballot).toMatchObject({ questionnaireId: "q_paper", masterlistNumber: "ML-001", code: "ABCD1234EF" });
    expect(Object.keys(ballot)).not.toEqual(expect.arrayContaining(["voterNsec", "voterNpub", "serialNumber"]));
    expect(ballot.questions[1].conditionInstruction).toBe('Answer only if question 1 (Do you agree?) is applicable and answered Yes. Otherwise leave blank.');
  });

  it("prints all-of selection semantics and requires the parent to be applicable", () => {
    const definition: QuestionnaireDefinition = { ...paperDefinition, questions: [
      { questionId: "q1", type: "multiple_choice", multiSelect: true, prompt: "Choose projects", required: true,
        options: [{ optionId: "a", label: "Garden" }, { optionId: "b", label: "Library" }] },
      { questionId: "q2", type: "free_text", maxLength: 1000, prompt: "Why both?", required: true,
        showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["a", "b"] } } },
    ] };
    const ballot = generatePaperBallot({ definition, masterlistNumber: "1", code: "ABCD1234EF", expiresAt: "2030-01-01T00:00:00Z" });
    expect(ballot.questions[1].conditionInstruction).toBe('Answer only if question 1 (Choose projects) is applicable and includes all of: Garden; Library. Other selections are allowed. Otherwise leave blank.');
  });
});
