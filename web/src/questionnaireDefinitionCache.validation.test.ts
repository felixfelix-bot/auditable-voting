// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readCachedQuestionnaireDefinition,
  readCachedQuestionnaireDefinitionWithValidation,
  storeCachedQuestionnaireDefinition,
  storeCachedQuestionnaireDefinitionWithValidation,
} from "./questionnaireDefinitionCache";
import { buildNamespacedLocalStorageKey } from "./appStorageNamespace";
import { QUESTIONNAIRE_DEFINITION_KIND } from "./questionnaireNostr";
import { QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN } from "./questionnaireProtocolConstants";
import type { QuestionnaireDefinition, QuestionnaireQuestion } from "./questionnaireProtocol";

function cleanDefinition(questions: QuestionnaireQuestion[]): QuestionnaireDefinition {
  return {
    schemaVersion: 1,
    eventType: "questionnaire_definition",
    responseMode: QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN,
    questionnaireId: "q_b4_cache",
    title: "Cache validation fixture",
    description: "Drives cache-boundary validation.",
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

const HOSTILE_DEFINITION = cleanDefinition([
  yesNo("q1", { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } }),
]);

const CLEAN_DEFINITION = cleanDefinition([yesNo("q1")]);

describe("questionnaireDefinitionCache read-path validation (B4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("flags a hostile definition on the cache put", () => {
    const result = storeCachedQuestionnaireDefinitionWithValidation(HOSTILE_DEFINITION);

    expect(result.definition).not.toBeNull();
    expect(result.valid).toBe(false);
    expect(result.invalidQuestionnaire).toBe(true);
    expect(result.errorCode).toBe("invalid_questionnaire");
  });

  it("flags a hostile definition on the cache load", () => {
    // Write it through the unvalidated writer so the load path has to catch it.
    storeCachedQuestionnaireDefinition(HOSTILE_DEFINITION);

    const result = readCachedQuestionnaireDefinitionWithValidation("q_b4_cache");

    expect(result.definition).not.toBeNull();
    expect(result.valid).toBe(false);
    expect(result.invalidQuestionnaire).toBe(true);
    expect(result.errorCode).toBe("invalid_questionnaire");
  });

  it("leaves a clean definition unflagged on put and load", () => {
    expect(storeCachedQuestionnaireDefinitionWithValidation(CLEAN_DEFINITION).valid).toBe(true);

    const loaded = readCachedQuestionnaireDefinitionWithValidation("q_b4_cache");
    expect(loaded.valid).toBe(true);
    expect(loaded.invalidQuestionnaire).toBe(false);
    expect(loaded.errorCode).toBeNull();
  });

  it("keeps the unvalidated cache accessors behaving exactly as before", () => {
    storeCachedQuestionnaireDefinition(CLEAN_DEFINITION);
    expect(readCachedQuestionnaireDefinition("q_b4_cache")?.questionnaireId).toBe("q_b4_cache");

    storeCachedQuestionnaireDefinition(HOSTILE_DEFINITION);
    // The legacy readers must not reject payloads on the coordinator's behalf.
    expect(readCachedQuestionnaireDefinition("q_b4_cache")).not.toBeNull();
  });

  it("flags a hostile definition that was hand-written into localStorage", () => {
    window.localStorage.setItem(
      buildNamespacedLocalStorageKey("questionnaire:definitions:v1"),
      JSON.stringify({ q_b4_cache: HOSTILE_DEFINITION }),
    );

    const loaded = readCachedQuestionnaireDefinitionWithValidation("q_b4_cache");
    expect(loaded.invalidQuestionnaire).toBe(true);
    expect(loaded.definition?.questionnaireId).toBe("q_b4_cache");
  });

  it("returns a null definition for an unknown id without flagging", () => {
    const loaded = readCachedQuestionnaireDefinitionWithValidation("nope");
    expect(loaded.definition).toBeNull();
    expect(loaded.invalidQuestionnaire).toBe(false);
  });

  it("still exposes the definition kind constant used by the fixture", () => {
    expect(QUESTIONNAIRE_DEFINITION_KIND).toBeGreaterThan(0);
  });
});
