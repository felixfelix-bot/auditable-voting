import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN } from "./questionnaireProtocolConstants";
import { QUESTIONNAIRE_DEFINITION_KIND } from "./questionnaireNostr";
import {
  INVALID_QUESTIONNAIRE_CODE,
  isQuestionnaireDefinitionValidForRead,
  parseQuestionnaireDefinitionEvent,
  parseQuestionnaireDefinitionEventWithValidation,
} from "./questionnaireNostr";
import { validateQuestionnaireDefinition } from "./questionnaireProtocol";
import type { QuestionnaireDefinition, QuestionnaireQuestion } from "./questionnaireProtocol";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function cleanDefinition(questions: QuestionnaireQuestion[]): QuestionnaireDefinition {
  return {
    schemaVersion: 1,
    eventType: "questionnaire_definition",
    responseMode: QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN,
    questionnaireId: "q_b4_ingest",
    title: "Read-path validation fixture",
    description: "Drives ingest-time validation.",
    createdAt: 1712530000,
    openAt: 1712531000,
    closeAt: 1712539999,
    coordinatorPubkey: "npub1coordinator",
    coordinatorEncryptionPubkey: "npub1coordinatorenc",
    responseVisibility: "private",
    eligibilityMode: "open",
    allowMultipleResponsesPerPubkey: false,
    questions,
  };
}

function yesNo(questionId: string, showIf?: QuestionnaireQuestion["showIf"]): QuestionnaireQuestion {
  return { questionId, type: "yes_no", prompt: `Q ${questionId}`, required: false, showIf: showIf ?? null };
}

function eventFor(definition: unknown) {
  return {
    id: "def-b4",
    kind: QUESTIONNAIRE_DEFINITION_KIND,
    pubkey: "npub1coordinator",
    created_at: 1712530000,
    tags: [["q", "q_b4_ingest"]],
    content: JSON.stringify(definition),
    sig: "",
  };
}

const HOSTILE_DEFINITION = cleanDefinition([
  yesNo("q1", { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } }),
  yesNo("q2"),
]);

const CLEAN_DEFINITION = cleanDefinition([
  yesNo("q1"),
  yesNo("q2", { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } }),
]);

/* ------------------------------------------------------------------ */
/* ingest: a hostile definition is flagged, not silently accepted      */
/* ------------------------------------------------------------------ */

describe("questionnaireNostr ingest validation (B4)", () => {
  it("flags a self-referential definition as invalid_questionnaire", () => {
    const result = parseQuestionnaireDefinitionEventWithValidation(eventFor(HOSTILE_DEFINITION));

    expect(result.definition).not.toBeNull();
    expect(result.valid).toBe(false);
    expect(result.invalidQuestionnaire).toBe(true);
    expect(result.errorCode).toBe(INVALID_QUESTIONNAIRE_CODE);
    expect(result.errors.join(" ")).toContain("show_if_forward_reference:q1:q1");
  });

  it("accepts a clean definition with no flag", () => {
    const result = parseQuestionnaireDefinitionEventWithValidation(eventFor(CLEAN_DEFINITION));

    expect(result.definition).not.toBeNull();
    expect(result.valid).toBe(true);
    expect(result.invalidQuestionnaire).toBe(false);
    expect(result.errorCode).toBeNull();
    expect(result.errors).toEqual([]);
  });

  it("keeps the lenient parse helper unchanged for legacy readers", () => {
    // The existing parser must still hand back the definition so a caller can
    // render the panel; validation is additive, reported separately.
    expect(parseQuestionnaireDefinitionEvent(eventFor(HOSTILE_DEFINITION))).not.toBeNull();
  });

  it("isQuestionnaireDefinitionValidForRead mirrors the coordinator validator", () => {
    const clean = cleanDefinition([yesNo("q1")]);
    expect(isQuestionnaireDefinitionValidForRead(clean)).toBe(true);
    expect(isQuestionnaireDefinitionValidForRead(HOSTILE_DEFINITION)).toBe(false);
    // Same semantics as the coordinator-side validator: the read path must not
    // invent its own, weaker rule set.
    expect(isQuestionnaireDefinitionValidForRead(clean))
      .toBe(validateQuestionnaireDefinition(clean).valid);
    expect(isQuestionnaireDefinitionValidForRead(HOSTILE_DEFINITION))
      .toBe(validateQuestionnaireDefinition(HOSTILE_DEFINITION).valid);
  });
});
