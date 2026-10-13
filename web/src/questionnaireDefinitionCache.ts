import type { QuestionnaireDefinition, QuestionnaireDefinitionReference } from "./questionnaireProtocol";
import {
  INVALID_QUESTIONNAIRE_CODE,
  canonicaliseQuestionnaireDefinitionText,
  validateQuestionnaireDefinition,
} from "./questionnaireProtocol";
import { buildNamespacedLocalStorageKey as buildSimpleNamespacedLocalStorageKey } from "./appStorageNamespace";

const QUESTIONNAIRE_DEFINITION_CACHE_KEY = "questionnaire:definitions:v1";
const QUESTIONNAIRE_DEFINITION_REFERENCE_CACHE_KEY = "questionnaire:definition-references:v1";

/**
 * A cached definition plus its read-path validation verdict (B4).
 *
 * `invalidQuestionnaire` means the definition was structurally invalid (for
 * example a cyclic `showIf` graph) and must be surfaced to the caller as
 * `invalid_questionnaire` rather than silently accepted.
 */
export type QuestionnaireDefinitionCacheResult = {
  definition: QuestionnaireDefinition | null;
  valid: boolean;
  invalidQuestionnaire: boolean;
  errorCode: string | null;
  errors: string[];
};

function emptyCacheResult(): QuestionnaireDefinitionCacheResult {
  return {
    definition: null,
    valid: false,
    invalidQuestionnaire: false,
    errorCode: null,
    errors: [],
  };
}

function storageKey() {
  return buildSimpleNamespacedLocalStorageKey(QUESTIONNAIRE_DEFINITION_CACHE_KEY);
}

/**
 * Definitions cached by an older build, or written before multi-language
 * support, store plain strings for `title`, `description`, question `prompt` and
 * option `label`. Upgrade every entry to the canonical multilingual shape as it
 * is read so callers never have to care which shape was written.
 */
function canonicaliseCachedDefinitions(cache: Record<string, QuestionnaireDefinition>) {
  const canonical: Record<string, QuestionnaireDefinition> = {};
  for (const [id, definition] of Object.entries(cache)) {
    canonical[id] = canonicaliseQuestionnaireDefinitionText(definition);
  }
  return canonical;
}

function readCache() {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(storageKey());
    return raw
      ? canonicaliseCachedDefinitions(JSON.parse(raw) as Record<string, QuestionnaireDefinition>)
      : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, QuestionnaireDefinition>) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(cache));
  } catch {
    // Cache writes must never block the voting flow.
  }
}

export function storeCachedQuestionnaireDefinition(definition: QuestionnaireDefinition) {
  return storeCachedQuestionnaireDefinitionWithValidation(definition).definition;
}

/**
 * Cache put + read-path validation (B4).
 *
 * The cache is a read boundary: a definition arrives either from the coordinator
 * (already validated at publish) or from an ingested Nostr event. Validating on
 * the way in means a hostile definition is flagged `invalid_questionnaire` at the
 * boundary rather than being silently accepted and crashing whichever consumer
 * reads it back. The definition is still stored - failing closed is a *visibility*
 * decision, not a silent drop, so a caller can show the voter why.
 */
export function storeCachedQuestionnaireDefinitionWithValidation(
  definition: QuestionnaireDefinition,
): QuestionnaireDefinitionCacheResult {
  // Persist the canonical multilingual shape so a cached definition reads back
  // with every locale it was created or parsed with, and a plain-string
  // definition is stored as `{ en: "<text>" }`.
  const canonicalDefinition = canonicaliseQuestionnaireDefinitionText(definition);
  const id = canonicalDefinition.questionnaireId.trim();
  if (!id) {
    return emptyCacheResult();
  }
  const validation = validateQuestionnaireDefinition(canonicalDefinition);
  const cache = readCache();
  const existing = cache[id] ?? null;
  if (
    existing
    && Number.isFinite(existing.createdAt)
    && Number.isFinite(canonicalDefinition.createdAt)
    && existing.createdAt > canonicalDefinition.createdAt
  ) {
    return {
      definition: existing,
      valid: validation.valid,
      invalidQuestionnaire: !validation.valid,
      errorCode: validation.valid ? null : INVALID_QUESTIONNAIRE_CODE,
      errors: validation.errors,
    };
  }
  writeCache({
    ...cache,
    [id]: canonicalDefinition,
  });
  return {
    definition: canonicalDefinition,
    valid: validation.valid,
    invalidQuestionnaire: !validation.valid,
    errorCode: validation.valid ? null : INVALID_QUESTIONNAIRE_CODE,
    errors: validation.errors,
  };
}

export function readCachedQuestionnaireDefinition(questionnaireId: string) {
  return readCachedQuestionnaireDefinitionWithValidation(questionnaireId).definition;
}

/**
 * Cache load + read-path validation (B4).
 *
 * A definition that was written by an older build, hand-edited in
 * `localStorage`, or ingested before validation existed is validated on the way
 * out and flagged `invalid_questionnaire`. The definition is still returned so
 * the caller can render the panel and surface the flag; it is never silently
 * accepted as healthy.
 */
export function readCachedQuestionnaireDefinitionWithValidation(
  questionnaireId: string,
): QuestionnaireDefinitionCacheResult {
  const id = questionnaireId.trim();
  if (!id) {
    return emptyCacheResult();
  }
  const definition = readCache()[id] ?? null;
  if (!definition) {
    return emptyCacheResult();
  }
  const validation = validateQuestionnaireDefinition(definition);
  return {
    definition,
    valid: validation.valid,
    invalidQuestionnaire: !validation.valid,
    errorCode: validation.valid ? null : INVALID_QUESTIONNAIRE_CODE,
    errors: validation.errors,
  };
}

function referenceStorageKey() {
  return buildSimpleNamespacedLocalStorageKey(QUESTIONNAIRE_DEFINITION_REFERENCE_CACHE_KEY);
}

export function storeCachedQuestionnaireDefinitionReference(reference: QuestionnaireDefinitionReference) {
  const questionnaireId = reference.questionnaireId.trim();
  const definitionEventId = reference.definitionEventId?.trim() ?? "";
  const definitionHash = reference.definitionHash?.trim() ?? "";
  if (!questionnaireId || !definitionEventId || !definitionHash || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(referenceStorageKey());
    const cache = raw ? JSON.parse(raw) as Record<string, QuestionnaireDefinitionReference> : {};
    cache[questionnaireId] = { ...reference, questionnaireId, definitionEventId, definitionHash };
    window.localStorage.setItem(referenceStorageKey(), JSON.stringify(cache));
    return cache[questionnaireId];
  } catch {
    return null;
  }
}

export function readCachedQuestionnaireDefinitionReference(questionnaireId: string) {
  const id = questionnaireId.trim();
  if (!id || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(referenceStorageKey());
    const reference = raw
      ? (JSON.parse(raw) as Record<string, QuestionnaireDefinitionReference>)[id] ?? null
      : null;
    return reference?.definitionEventId?.trim() && reference.definitionHash?.trim() ? reference : null;
  } catch {
    return null;
  }
}
