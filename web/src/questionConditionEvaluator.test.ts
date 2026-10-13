import { describe, expect, it } from "vitest";
import {
  CircularDependencyError,
  checkForCycle,
  evaluateDefinitionVisibility,
  evaluateQuestionVisibility,
  shouldShowQuestion,
} from "./questionConditionEvaluator";
import type {
  QuestionnaireDefinition,
  QuestionnaireQuestion,
  QuestionnaireResponseAnswer,
} from "./questionnaireProtocol";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function makeYesNoQuestion(id: string, opts?: { showIf?: QuestionnaireQuestion["showIf"] }): QuestionnaireQuestion {
  return {
    questionId: id,
    type: "yes_no",
    prompt: `Question ${id}`,
    required: false,
    showIf: opts?.showIf ?? null,
  };
}

function makeMultipleChoiceQuestion(
  id: string,
  optionIds: string[],
  opts?: { showIf?: QuestionnaireQuestion["showIf"] },
): QuestionnaireQuestion {
  return {
    questionId: id,
    type: "multiple_choice",
    prompt: `Question ${id}`,
    required: false,
    multiSelect: false,
    options: optionIds.map((oid) => ({ optionId: oid, label: oid })),
    showIf: opts?.showIf ?? null,
  };
}

function yesNoAnswer(questionId: string, value: boolean): QuestionnaireResponseAnswer {
  return { questionId, answerType: "yes_no", value };
}

function multipleChoiceAnswer(questionId: string, selectedOptionIds: string[]): QuestionnaireResponseAnswer {
  return { questionId, answerType: "multiple_choice", selectedOptionIds };
}

function answeredMap(...answers: QuestionnaireResponseAnswer[]): Map<string, QuestionnaireResponseAnswer> {
  const m = new Map<string, QuestionnaireResponseAnswer>();
  for (const a of answers) {
    m.set(a.questionId, a);
  }
  return m;
}

function makeDefinition(questions: QuestionnaireQuestion[]): QuestionnaireDefinition {
  return {
    schemaVersion: 1,
    eventType: "questionnaire_definition",
    responseMode: "blind_token",
    questionnaireId: "q_b4_hostile",
    title: "Hostile definition fixture",
    description: "Fixture used to drive the fail-closed visibility path.",
    createdAt: 1712530000,
    openAt: 1712531000,
    closeAt: 1712539999,
    coordinatorPubkey: "npub1coordinator",
    coordinatorEncryptionPubkey: "npub1coordinatorenc",
    responseVisibility: "private",
    eligibilityMode: "open",
    allowMultipleResponsesPerPubkey: false,
    questions: questions.map((question) => ({ ...question, showIf: question.showIf ?? null })),
  };
}

/* ------------------------------------------------------------------ */
/* 1. No condition → always true                                      */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — no condition", () => {
  it("returns true when showIf is null", () => {
    const q = makeYesNoQuestion("q1");
    expect(shouldShowQuestion(q, answeredMap())).toBe(true);
  });

  it("returns true when showIf is undefined", () => {
    const q: QuestionnaireQuestion = { ...makeYesNoQuestion("q1") };
    delete (q as Partial<QuestionnaireQuestion>).showIf;
    expect(shouldShowQuestion(q, answeredMap())).toBe(true);
  });

  it("returns true regardless of answered questions", () => {
    const q = makeYesNoQuestion("q1");
    expect(shouldShowQuestion(q, answeredMap(yesNoAnswer("other", true)))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Condition on unanswered question → false                        */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — dependency unanswered", () => {
  it("returns false when dependsOn question is not in answered map", () => {
    const q = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    expect(shouldShowQuestion(q, answeredMap())).toBe(false);
  });

  it("returns false when answered map is empty but condition exists", () => {
    const q = makeMultipleChoiceQuestion("q2", ["a", "b"], {
      showIf: {
        dependsOnQuestionId: "q1",
        requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["a"] },
      },
    });
    expect(shouldShowQuestion(q, new Map())).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Condition met (yes_no=true) → true                              */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — yes_no condition met", () => {
  it("returns true when dependency answered true and condition requires true", () => {
    const q = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    expect(shouldShowQuestion(q, answeredMap(yesNoAnswer("q1", true)))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Condition not met (yes_no=false) → false                        */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — yes_no condition not met", () => {
  it("returns false when dependency answered true but condition requires false", () => {
    const q = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: false } },
    });
    expect(shouldShowQuestion(q, answeredMap(yesNoAnswer("q1", true)))).toBe(false);
  });

  it("returns true when dependency answered false and condition requires false", () => {
    const q = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: false } },
    });
    expect(shouldShowQuestion(q, answeredMap(yesNoAnswer("q1", false)))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Multiple choice condition with matching option → true           */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — multiple_choice condition matching", () => {
  it("returns true when selected options include required option", () => {
    const q = makeYesNoQuestion("q3", {
      showIf: {
        dependsOnQuestionId: "q1",
        requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["opt_a"] },
      },
    });
    expect(shouldShowQuestion(q, answeredMap(multipleChoiceAnswer("q1", ["opt_a", "opt_b"])))).toBe(true);
  });

  it("returns true when multiple required options all present in answer", () => {
    const q = makeYesNoQuestion("q3", {
      showIf: {
        dependsOnQuestionId: "q1",
        requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["opt_a", "opt_c"] },
      },
    });
    expect(shouldShowQuestion(q, answeredMap(multipleChoiceAnswer("q1", ["opt_a", "opt_b", "opt_c"])))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Multiple choice condition with non-matching option → false      */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — multiple_choice condition non-matching", () => {
  it("returns false when selected options do not include required option", () => {
    const q = makeYesNoQuestion("q3", {
      showIf: {
        dependsOnQuestionId: "q1",
        requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["opt_a"] },
      },
    });
    expect(shouldShowQuestion(q, answeredMap(multipleChoiceAnswer("q1", ["opt_b"])))).toBe(false);
  });

  it("returns false when only one of two required options is present", () => {
    const q = makeYesNoQuestion("q3", {
      showIf: {
        dependsOnQuestionId: "q1",
        requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["opt_a", "opt_c"] },
      },
    });
    expect(shouldShowQuestion(q, answeredMap(multipleChoiceAnswer("q1", ["opt_a", "opt_b"])))).toBe(false);
  });

  it("returns false when answer is empty selection", () => {
    const q = makeYesNoQuestion("q3", {
      showIf: {
        dependsOnQuestionId: "q1",
        requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["opt_a"] },
      },
    });
    expect(shouldShowQuestion(q, answeredMap(multipleChoiceAnswer("q1", [])))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Answer type mismatch between condition and actual answer        */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — answer type mismatch", () => {
  it("returns false when condition expects yes_no but answer is multiple_choice", () => {
    const q = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    expect(shouldShowQuestion(q, answeredMap(multipleChoiceAnswer("q1", ["x"])))).toBe(false);
  });

  it("returns false when condition expects multiple_choice but answer is yes_no", () => {
    const q = makeYesNoQuestion("q2", {
      showIf: {
        dependsOnQuestionId: "q1",
        requiredAnswer: { answerType: "multiple_choice", selectedOptionIds: ["x"] },
      },
    });
    expect(shouldShowQuestion(q, answeredMap(yesNoAnswer("q1", true)))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 8. Hostile definitions fail closed and are REPORTED                */
/* ------------------------------------------------------------------ */

describe("shouldShowQuestion — fail closed on a hostile definition (B4)", () => {
  it("reports a direct self-reference as hidden instead of throwing", () => {
    const q = makeYesNoQuestion("q1", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    expect(() => shouldShowQuestion(q, answeredMap(yesNoAnswer("q1", true)))).not.toThrow();
    expect(shouldShowQuestion(q, answeredMap(yesNoAnswer("q1", true)))).toBe(false);
  });

  it("reports a direct self-reference as hidden when a definitions map is supplied", () => {
    const q = makeYesNoQuestion("q1", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    const allQuestions = new Map([["q1", q]]);
    expect(shouldShowQuestion(q, answeredMap(yesNoAnswer("q1", true)), allQuestions)).toBe(false);
  });

  it("hides a transitive showIf cycle without throwing", () => {
    const q1 = makeYesNoQuestion("q1", {
      showIf: { dependsOnQuestionId: "q2", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    const q2 = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    const allQuestions = new Map([["q1", q1], ["q2", q2]]);
    const answers = answeredMap(yesNoAnswer("q1", true));
    expect(() => shouldShowQuestion(q1, answers, allQuestions)).not.toThrow();
    expect(shouldShowQuestion(q1, answers, allQuestions)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 9. The hostile definition is surfaced as invalid_questionnaire     */
/* ------------------------------------------------------------------ */

describe("hostile definition is reported as invalid_questionnaire (B4)", () => {
  it("checkForCycle still detects the cycle for definition-time validation", () => {
    // The coordinator path keeps its explicit rejection: cycle detection is
    // untouched, it is just no longer reachable from `shouldShowQuestion`.
    expect(() => checkForCycle("q1", "q1", undefined, new Set())).toThrow(CircularDependencyError);
    expect(CircularDependencyError.name).toBe("CircularDependencyError");
  });

  it("evaluateQuestionVisibility reports a self-reference as hidden + invalid_questionnaire", () => {
    const q = makeYesNoQuestion("q1", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    const result = evaluateQuestionVisibility(q, answeredMap(), new Map([["q1", q]]));
    expect(result.visible).toBe(false);
    expect(result.invalidQuestionnaire).toBe(true);
    expect(result.errors.join(" ")).toContain("invalid_questionnaire");
  });

  it("evaluateQuestionVisibility reports a transitive cycle as hidden + invalid_questionnaire", () => {
    const q1 = makeYesNoQuestion("q1", {
      showIf: { dependsOnQuestionId: "q2", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    const q2 = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    const result = evaluateQuestionVisibility(q1, answeredMap(), new Map([["q1", q1], ["q2", q2]]));
    expect(result.visible).toBe(false);
    expect(result.invalidQuestionnaire).toBe(true);
  });

  it("evaluateQuestionVisibility leaves a clean definition unflagged", () => {
    const q = makeYesNoQuestion("q2", {
      showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
    });
    const result = evaluateQuestionVisibility(q, answeredMap(yesNoAnswer("q1", true)));
    expect(result.visible).toBe(true);
    expect(result.invalidQuestionnaire).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it("evaluateDefinitionVisibility collects invalid_questionnaire for a hostile definition", () => {
    const definition = makeDefinition([
      makeYesNoQuestion("q1", {
        showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
      }),
      makeYesNoQuestion("q2"),
    ]);
    const result = evaluateDefinitionVisibility(definition, answeredMap());
    expect(result.invalidQuestionnaire).toBe(true);
    expect(result.errors.join(" ")).toContain("invalid_questionnaire");
    // Fail closed: q1 is hidden; the self-reference must not make q2 blow up.
    expect(result.visibleQuestionIds.has("q1")).toBe(false);
    expect(result.visibleQuestionIds.has("q2")).toBe(true);
  });

  it("evaluateDefinitionVisibility leaves a clean definition unflagged", () => {
    const definition = makeDefinition([
      makeYesNoQuestion("q1"),
      makeYesNoQuestion("q2", {
        showIf: { dependsOnQuestionId: "q1", requiredAnswer: { answerType: "yes_no", value: true } },
      }),
    ]);
    const result = evaluateDefinitionVisibility(definition, answeredMap(yesNoAnswer("q1", true)));
    expect(result.invalidQuestionnaire).toBe(false);
    expect(result.errors).toEqual([]);
    expect([...result.visibleQuestionIds].sort()).toEqual(["q1", "q2"]);
  });
});