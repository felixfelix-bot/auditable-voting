/**
 * Condition evaluator for follow-up / conditional questions.
 *
 * Given a question and a map of answers collected so far, determines whether
 * the question should be visible to the voter.
 *
 * Visibility rules:
 * 1. No `showIf` → always visible.
 * 2. `showIf` present but the dependency question has not been answered → hidden.
 * 3. `showIf` present and the dependency has been answered → evaluate the condition:
 *    - yes_no: compare boolean value.
 *    - multiple_choice: every required option id must be present in the selected set.
 * 4. If the condition's answer type does not match the actual answer type → hidden.
 * 5. A self-referential (circular) `showIf` is a hostile definition. On the voter
 *    read path it must never throw: the question is reported hidden (fail closed)
 *    and the definition is surfaced as `invalid_questionnaire` via
 *    `evaluateQuestionVisibility` / `evaluateDefinitionVisibility`, which is what
 *    the ingest and cache boundaries consume (B4).
 */

import type {
  QuestionnaireDefinition,
  QuestionnaireQuestion,
  QuestionnaireResponseAnswer,
} from "./questionnaireProtocol";
import { INVALID_QUESTIONNAIRE_CODE } from "./questionnaireProtocol";

/**
 * Thrown when a question's `showIf` chain contains a cycle (e.g. a question
 * that depends on itself, directly or transitively).
 */
export class CircularDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircularDependencyError";
    Object.setPrototypeOf(this, CircularDependencyError.prototype);
  }
}

/**
 * A visibility decision plus the validation signal the read path needs (B4).
 *
 * `invalidQuestionnaire` is `true` when the definition is hostile (its `showIf`
 * graph contains a cycle) or structurally invalid. The evaluator fails closed -
 * the question is reported hidden - and the caller can surface
 * `invalid_questionnaire` instead of the voter panel exploding.
 */
export type QuestionVisibility = {
  visible: boolean;
  invalidQuestionnaire: boolean;
  errors: string[];
};

/** The definition-level visibility result (B4). `visible` is always `true` at
 * this level - the per-question decisions live in `visibleQuestionIds`. */
export type DefinitionVisibility = Omit<QuestionVisibility, "visible"> & {
  visibleQuestionIds: Set<string>;
};

/**
 * Determine whether a question should be shown given the answers collected so far.
 *
 * @param question          The question to evaluate.
 * @param answeredQuestions Map of questionId → answer for all questions answered so far.
 * @param allQuestions      Optional map of all questions in the definition (for cycle detection).
 *                          When provided, transitive `showIf` chains are checked for cycles.
 * @returns `true` if the question should be visible, `false` if it should be hidden.
 *
 * Never throws: a hostile (cyclic) `showIf` graph is reported as hidden. Callers
 * that need to *report* the hostile definition use `evaluateQuestionVisibility`.
 */
export function shouldShowQuestion(
  question: QuestionnaireQuestion,
  answeredQuestions: Map<string, QuestionnaireResponseAnswer>,
  allQuestions?: Map<string, QuestionnaireQuestion>,
): boolean {
  return evaluateQuestionVisibility(question, answeredQuestions, allQuestions).visible;
}

/**
 * Like `shouldShowQuestion`, but also reports *why* a question was hidden (B4).
 *
 * A cyclic `showIf` graph - a self-reference or a transitive `q1 → q2 → q1` chain
 * - is attacker-controlled input: definition ingest only checks shape
 * (`questionnaireNostr.ts`), and the cache only canonicalises text
 * (`questionnaireDefinitionCache.ts`). Throwing here aborted whichever read path
 * happened to call it first (the voter render, the response-payload validator,
 * the runtime publish filter, the ballot validator). Reporting the question as
 * hidden instead means a hostile definition can only ever *hide* questions: it
 * cannot crash a voter, and it cannot make a hidden answer publishable.
 *
 * `CircularDependencyError` is still thrown by `checkForCycle`, which stays
 * exported so definition-time validation can keep rejecting hostile graphs.
 */
export function evaluateQuestionVisibility(
  question: QuestionnaireQuestion,
  answeredQuestions: Map<string, QuestionnaireResponseAnswer>,
  allQuestions?: Map<string, QuestionnaireQuestion>,
): QuestionVisibility {
  const condition = question.showIf;
  if (condition === undefined || condition === null) {
    return { visible: true, invalidQuestionnaire: false, errors: [] };
  }

  const visited = new Set<string>();
  try {
    checkForCycle(question.questionId, condition.dependsOnQuestionId, allQuestions, visited);
  } catch {
    // Hostile definition: fail closed AND report it.
    return {
      visible: false,
      invalidQuestionnaire: true,
      errors: [`${INVALID_QUESTIONNAIRE_CODE}:circular_show_if:${question.questionId}`],
    };
  }

  const depAnswer = answeredQuestions.get(condition.dependsOnQuestionId);
  if (depAnswer === undefined) {
    // Dependency not yet answered → hide.
    return { visible: false, invalidQuestionnaire: false, errors: [] };
  }

  return {
    visible: evaluateCondition(condition.requiredAnswer, depAnswer),
    invalidQuestionnaire: false,
    errors: [],
  };
}

/* ------------------------------------------------------------------ */
/* internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Walk the `showIf` chain from `currentId` → `dependsOnId` and detect cycles.
 *
 * We follow the chain: starting from the original question, we check whether
 * its dependency points back to it. When `allQuestions` is available we can
 * walk transitively; otherwise we only catch the direct self-reference.
 *
 * Exported (B4) so definition-time validation can reject a hostile graph
 * explicitly. `shouldShowQuestion` / `evaluateQuestionVisibility` catch the
 * `CircularDependencyError` instead of letting it escape on the voter read path.
 */
export function checkForCycle(
  originalId: string,
  dependsOnId: string,
  allQuestions: Map<string, QuestionnaireQuestion> | undefined,
  visited: Set<string>,
): void {
  // Direct self-reference.
  if (dependsOnId === originalId) {
    throw new CircularDependencyError(
      `Circular dependency detected: question "${originalId}" depends on itself.`,
    );
  }

  // Without the full question map we can only catch direct self-references.
  if (!allQuestions) {
    return;
  }

  // Transitive cycle detection: walk the chain.
  let currentId = dependsOnId;
  while (currentId !== undefined) {
    if (currentId === originalId) {
      throw new CircularDependencyError(
        `Circular dependency detected: question "${originalId}" is part of a showIf cycle.`,
      );
    }
    if (visited.has(currentId)) {
      // Already traversed this node from a different branch — not a cycle
      // involving originalId, so stop.
      break;
    }
    visited.add(currentId);

    const depQuestion = allQuestions.get(currentId);
    if (!depQuestion || !depQuestion.showIf) {
      break;
    }
    currentId = depQuestion.showIf.dependsOnQuestionId;
  }
}

/**
 * Evaluate whether the actual answer satisfies the required answer.
 *
 * Returns `false` (hidden) when the answer types don't match — this is a
 * data inconsistency that the protocol validator should catch at definition
 * time, but at runtime we fail safe by hiding the question.
 */
function evaluateCondition(
  required: QuestionnaireResponseAnswer | { answerType: "yes_no"; value: boolean } | { answerType: "multiple_choice"; selectedOptionIds: string[] },
  actual: QuestionnaireResponseAnswer,
): boolean {
  if (required.answerType === "yes_no" && actual.answerType === "yes_no") {
    return required.value === actual.value;
  }

  if (required.answerType === "multiple_choice" && actual.answerType === "multiple_choice") {
    const requiredSet = new Set(required.selectedOptionIds);
    // Every required option must be present in the actual selection.
    for (const reqId of requiredSet) {
      if (!actual.selectedOptionIds.includes(reqId)) {
        return false;
      }
    }
    return true;
  }

  // Answer type mismatch → fail safe (hide).
  return false;
}
/**
 * The question ids that the voter can currently see under their `showIf` rules.
 *
 * Visibility is transitive along the `showIf` chain: a question whose dependency is itself hidden
 * stays hidden even when the retained answer to that dependency would satisfy its condition. A
 * voter who answered Q2 while Q1 was "yes" and then flips Q1 to "no" must not have a stale Q2
 * answer satisfy a Q3 that depends on Q2 - otherwise the chained follow-up leaks the answer to a
 * question the voter can no longer see. `showIf` may only reference an earlier question in the
 * definition (see `validateQuestionnaireDefinition`), so one ordered pass is exact.
 *
 * `answeredQuestions` may itself contain answers for hidden questions; that is precisely the state
 * this function has to reason about. It is the single source of truth used to keep hidden answers
 * out of published payloads.
 */
export function visibleQuestionIds(
  definition: QuestionnaireDefinition,
  answeredQuestions: Map<string, QuestionnaireResponseAnswer>,
): Set<string> {
  return evaluateDefinitionVisibility(definition, answeredQuestions).visibleQuestionIds;
}

/**
 * The visible-question set plus the hostile-definition signal (B4).
 *
 * Same ordered single pass as `visibleQuestionIds`, but it also collects
 * `invalidQuestionnaire` when the definition's `showIf` graph is cyclic. This is
 * the entry point the ingest and cache boundaries use so a hostile definition is
 * *reported* rather than silently evaluated question by question.
 */
export function evaluateDefinitionVisibility(
  definition: QuestionnaireDefinition,
  answeredQuestions: Map<string, QuestionnaireResponseAnswer>,
): DefinitionVisibility {
  const questionMap = new Map<string, QuestionnaireQuestion>(
    definition.questions.map((question) => [question.questionId, question]),
  );
  const visible = new Set<string>();
  const errors: string[] = [];
  let invalidQuestionnaire = false;

  for (const question of definition.questions) {
    const dependencyId = question.showIf?.dependsOnQuestionId;
    // Evaluate first so a cyclic `showIf` is reported even when the dependency
    // is hidden: a hostile definition must be surfaced, not skipped.
    const result = evaluateQuestionVisibility(question, answeredQuestions, questionMap);
    if (result.invalidQuestionnaire) {
      invalidQuestionnaire = true;
      errors.push(...result.errors);
    }
    // Transitive hiding: a question whose dependency is not itself visible stays
    // hidden (this also keeps self/forward references closed).
    if (dependencyId !== undefined && !visible.has(dependencyId)) {
      continue;
    }
    if (result.visible) {
      visible.add(question.questionId);
    }
  }

  return { visibleQuestionIds: visible, invalidQuestionnaire, errors };
}
