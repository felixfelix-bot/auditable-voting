/**
 * Answer-type mix for a harness round.
 *
 * Kept in its own module (rather than importing a `src/` type) so the harness
 * owns this knob explicitly: the harness decides which questions a round asks,
 * the application decides how they are validated, signed and tallied.
 *
 * - `0` — "minimal": yes/no question only, round publishes immediately.
 * - `1` — "mixed": a yes/no question plus a single-select multiple-choice
 *   question, round uses windowed publication (the production default for
 *   privacy-sensitive rounds).
 */
export type QuestionnaireAnswerTypeMix = 0 | 1;

export const ANSWER_TYPE_MIX_MINIMAL: QuestionnaireAnswerTypeMix = 0;
export const ANSWER_TYPE_MIX_MIXED: QuestionnaireAnswerTypeMix = 1;

/** Normalise an arbitrary input into a supported mix, or throw. */
export function normaliseAnswerTypeMix(value: unknown): QuestionnaireAnswerTypeMix {
  if (value === undefined || value === null) {
    return ANSWER_TYPE_MIX_MIXED;
  }
  if (value === 0 || value === "0") {
    return ANSWER_TYPE_MIX_MINIMAL;
  }
  if (value === 1 || value === "1") {
    return ANSWER_TYPE_MIX_MIXED;
  }
  throw new Error(`Unsupported answer type mix: ${String(value)} (expected 0 or 1).`);
}
