import { describe, expect, it } from "vitest";
import { shouldShowQuestion } from "./questionConditionEvaluator";
import { validateBallotSubmission, type BallotSubmission } from "./questionnaireOptionA";
import { validateQuestionnaireDefinition, validateQuestionnaireResponsePayload, type QuestionnaireDefinition, type QuestionnaireResponseAnswer } from "./questionnaireProtocol";

const condition = (id: string) => ({ dependsOnQuestionId: id, requiredAnswer: { answerType: "yes_no" as const, value: true } });
const definition: QuestionnaireDefinition = {
  schemaVersion: 1, eventType: "questionnaire_definition", responseMode: "blind_token",
  questionnaireId: "conditions", title: "Conditions", createdAt: 1, openAt: 1, closeAt: 999,
  coordinatorPubkey: "npub1" + "b".repeat(58), coordinatorEncryptionPubkey: "npub1" + "b".repeat(58),
  responseVisibility: "private", eligibilityMode: "open", allowMultipleResponsesPerPubkey: false,
  questions: [
    { questionId: "q1", type: "yes_no", prompt: "Root", required: true },
    { questionId: "q2", type: "yes_no", prompt: "Child", required: true, showIf: condition("q1") },
    { questionId: "q3", type: "yes_no", prompt: "Grandchild", required: true, showIf: condition("q2") },
  ],
};
const answer = (questionId: string, value: boolean): QuestionnaireResponseAnswer => ({ questionId, answerType: "yes_no", value });
const payload = (answers: QuestionnaireResponseAnswer[]) => ({ schemaVersion: 1 as const, kind: "questionnaire_response_payload" as const, questionnaireId: "conditions", responseId: "r", submittedAt: 1, answers });
function ballot(answers: QuestionnaireResponseAnswer[]) {
  return { electionId: "conditions", credential: "sig", nullifier: "n", tokenCommitment: "t", blindSigningKeyId: "k", payload: { electionId: "conditions", responses: answers.map(a => ({ questionId: a.questionId, type: "yes_no", answer: a.answerType === "yes_no" && a.value ? "yes" : "no" })) } } as BallotSubmission;
}
const validate = (answers: QuestionnaireResponseAnswer[]) => validateBallotSubmission({ submission: ballot(answers), definition, electionId: "conditions", electionState: "open", requiredQuestionIds: ["q1", "q2", "q3"] });

describe("conditional acceptance", () => {
  it("does not use a stale hidden ancestor answer", () => {
    const answers = [answer("q1", false), answer("q2", true)];
    expect(shouldShowQuestion(definition.questions[2], new Map(answers.map(a => [a.questionId, a])), new Map(definition.questions.map(q => [q.questionId, q])))).toBe(false);
    const result = validateQuestionnaireResponsePayload({ definition, payload: payload([...answers, answer("q3", true)]) });
    expect(result.errors).toContain("answer_for_hidden_question:q3");
    expect(result.errors).not.toContain("missing_required_answer:q3");
  });
  it("accepts omitted hidden required questions in Option A", () => expect(validate([answer("q1", false)])).toBe(true));
  it("rejects hidden answers in Option A", () => expect(validate([answer("q1", false), answer("q2", true), answer("q3", true)])).toBe(false));
  it("requires visible descendants in Option A", () => expect(validate([answer("q1", true)])).toBe(false));
  it("derives visible conditional requiredness from the definition when the caller omits required IDs", () => {
    expect(validateBallotSubmission({ submission: ballot([answer("q1", true)]), definition, electionId: "conditions", electionState: "open", requiredQuestionIds: [] })).toBe(false);
  });
  it("accepts visible descendants in Option A", () => expect(validate([answer("q1", true), answer("q2", true), answer("q3", true)])).toBe(true));
  it("rejects a dependency answer with the wrong type", () => {
    const submission = ballot([answer("q1", false)]);
    submission.payload.responses = [{ questionId: "q1", type: "text", answer: "true" }];
    expect(validateBallotSubmission({ submission, definition, electionId: "conditions", electionState: "open", requiredQuestionIds: ["q1"] })).toBe(false);
  });
  it("rejects a per-question proof without the conditional question's required scope", () => {
    const scoped = { ...definition, ballotCredentialMode: "per_question" as const, questions: definition.questions.map((q, i) => ({ ...q, requiredScope: i === 0 ? null : "1", ballotSlot: { slotId: q.questionId, slotIndex: i + 1, version: 1 } })) };
    const submission = ballot([answer("q1", true), answer("q2", true), answer("q3", true)]);
    submission.credentialBundle = scoped.questions.map((q, i) => ({ questionId: q.questionId, tokenCommitment: `t${i}`, blindSigningKeyId: "k", credential: "sig", nullifier: `n${i}`, ballotScope: { ...q.ballotSlot, questionId: q.questionId, allowedScopes: ["0"] } }));
    expect(validateBallotSubmission({ submission, definition: scoped, electionId: "conditions", electionState: "open", requiredQuestionIds: [] })).toBe(false);
  });
  it.each([undefined, null, {}, { answerType: "yes_no", value: "true" }, { answerType: "yes_no" }, { answerType: "rank", value: true }])("returns a definition error for malformed requiredAnswer %j", requiredAnswer => {
    const malformed = structuredClone(definition);
    malformed.questions[1].showIf = { dependsOnQuestionId: "q1", requiredAnswer } as never;
    expect(validateQuestionnaireDefinition(malformed).valid).toBe(false);
  });
  it.each([null, "yes", 1, undefined])("returns a response error for malformed boolean %j", value => {
    expect(validateQuestionnaireResponsePayload({ definition, payload: payload([{ questionId: "q1", answerType: "yes_no", value } as never]) }).valid).toBe(false);
  });
  it.each([null, "a", {}, [1]])("returns a response error for malformed selections %j", selectedOptionIds => {
    const multiple = { ...definition, questions: [{ questionId: "q1", type: "multiple_choice" as const, prompt: "Choice", required: true, multiSelect: true, options: [{ optionId: "a", label: "A" }] }, { ...definition.questions[1], showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "multiple_choice" as const, selectedOptionIds: ["a"] } } }] };
    expect(validateQuestionnaireResponsePayload({ definition: multiple, payload: payload([{ questionId: "q1", answerType: "multiple_choice", selectedOptionIds } as never]) }).valid).toBe(false);
  });
});
