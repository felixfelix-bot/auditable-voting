import { describe, expect, it } from "vitest";
import {
  questionnaireDefinitionEventHash,
  questionnaireDefinitionHash,
  selectNewestMatchingQuestionnaireDefinition,
} from "./questionnaireDefinitionReference";
import { validateQuestionnaireDefinition, type QuestionnaireDefinition } from "./questionnaireProtocol";

function definition(questionnaireId: string, title: string, createdAt: number): QuestionnaireDefinition {
  return {
    schemaVersion: 1,
    eventType: "questionnaire_definition",
    responseMode: "blind_token",
    questionnaireId,
    title,
    description: "",
    createdAt,
    openAt: createdAt,
    closeAt: createdAt + 3600,
    coordinatorPubkey: "npub1organiser",
    coordinatorEncryptionPubkey: "npub1organiser",
    responseVisibility: "public",
    eligibilityMode: "allowlist",
    allowMultipleResponsesPerPubkey: false,
    questions: [{
      questionId: "q1",
      prompt: "Proceed?",
      required: true,
      type: "yes_no",
    }],
  };
}

describe("selectNewestMatchingQuestionnaireDefinition", () => {
  it("selects the newest matching definition and ignores stale state for the same questionnaire", () => {
    const stale = definition("q_same", "stale", 1781200000);
    const fresh = definition("q_same", "fresh", 1781200100);
    const unrelated = definition("q_other", "unrelated", 1781200200);

    expect(selectNewestMatchingQuestionnaireDefinition("q_same", [
      stale,
      null,
      unrelated,
      fresh,
    ])).toBe(fresh);
  });

  it("returns null when there is no matching questionnaire id", () => {
    expect(selectNewestMatchingQuestionnaireDefinition("q_missing", [
      definition("q_other", "unrelated", 1781200000),
      undefined,
    ])).toBeNull();
  });
});

describe("questionnaireDefinitionHash", () => {
  /**
   * ADR 0003/0004/0007 reasoning depends on the definition hash pinning the
   * publication semantics: if the hash input ignored `publicationMode` /
   * `finalizationGraceSeconds`, a definition could be re-hashed with different
   * release semantics under the same pin. These tests pin the shipped answer.
   */
  const windowed = (
    base: QuestionnaireDefinition,
    finalizationGraceSeconds: number,
    publicationMode: "windowed" | "immediate" = "windowed",
  ): QuestionnaireDefinition => ({ ...base, publicationMode, finalizationGraceSeconds });

  it("covers publicationMode and finalizationGraceSeconds in the hashed input", () => {
    const implicitImmediate = definition("q_hash", "hash", 1781300000);
    const explicitImmediate: QuestionnaireDefinition = { ...implicitImmediate, publicationMode: "immediate" };
    const windowedHour = windowed(implicitImmediate, 3600);
    const windowedDay = windowed(implicitImmediate, 86_400);

    // Every definition here is a legal wire definition, so the difference
    // cannot be dismissed as a malformed input.
    for (const candidate of [implicitImmediate, windowedHour, windowedDay]) {
      expect(validateQuestionnaireDefinition(candidate).valid).toBe(true);
    }

    const digests = [implicitImmediate, explicitImmediate, windowedHour, windowedDay].map(
      (candidate) => questionnaireDefinitionHash(candidate),
    );
    console.log("definition hash discrimination:", {
      implicitImmediate: digests[0],
      explicitImmediate: digests[1],
      windowedHour: digests[2],
      windowedDay: digests[3],
    });

    // Changing the release semantics always changes the pin, and therefore
    // cannot be done under an existing definition reference.
    expect(digests[2]).not.toBe(digests[3]);
    expect(digests[2]).not.toBe(digests[0]);
    // The literal field set is hashed, not the interpreted meaning: an explicit
    // `"immediate"` (which closes nothing but states the mode) hashes apart from
    // an absent field that defaults to immediate.
    expect(digests[1]).not.toBe(digests[0]);
    expect(new Set(digests).size).toBe(4);
  });

  it("hashes a published definition event content to the same pin as the in-memory definition", () => {
    const windowedDefinition = windowed(definition("q_hash_event", "hash event", 1781300100), 3600);

    // The coordinator derives the reference hash from the event it published
    // (QuestionnaireCoordinatorPanel definitionHashOverride), so the two inputs
    // must agree for the pin to be meaningful.
    expect(questionnaireDefinitionEventHash(JSON.stringify(windowedDefinition)))
      .toBe(questionnaireDefinitionHash(windowedDefinition));
  });

  it("is insensitive to key order", () => {
    const ordered = windowed(definition("q_hash_order", "hash order", 1781300200), 3600);
    // Same field set, reversed insertion order: the hash must not depend on how
    // the JSON object happens to be assembled by a publisher or a parser.
    const reversed = Object.fromEntries(Object.entries(ordered).reverse()) as QuestionnaireDefinition;

    expect(Object.keys(reversed).length).toBe(Object.keys(ordered).length);
    expect(questionnaireDefinitionHash(reversed)).toBe(questionnaireDefinitionHash(ordered));
  });
});
