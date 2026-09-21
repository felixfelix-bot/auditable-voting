import {
  QUESTIONNAIRE_FLOW_MODE_LEGACY_PRIVATE_DM,
  QUESTIONNAIRE_FLOW_MODE_PUBLIC_SUBMISSION_V1,
  QUESTIONNAIRE_MAX_FINALIZATION_GRACE_SECONDS,
  QUESTIONNAIRE_PROTOCOL_VERSION_V1,
  QUESTIONNAIRE_PUBLICATION_MODE_IMMEDIATE,
  QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED,
  QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN,
  QUESTIONNAIRE_RESPONSE_MODE_LEGACY_PRIVATE_ENVELOPE,
  type QuestionnaireFlowMode,
  type QuestionnairePublicationMode,
  type QuestionnaireResponseMode,
} from "./questionnaireProtocolConstants";
import type { QuestionnaireBlindPublicKey } from "./questionnaireBlindSignature";
import {
  normalizeQuestionnaireRelays,
  questionnaireRelaysForMetadata,
} from "./questionnaireRelays";

export type QuestionnaireQuestionBase = {
  questionId: string;
  prompt: string;
  required: boolean;
  ballotSlot?: QuestionnaireBallotSlot | null;
  requiredScope?: string | null;
  /** Legacy alias for requiredScope. */
  ballotGroup?: string | null;
};

export type QuestionnaireBallotCredentialMode = "questionnaire" | "per_question";

export type QuestionnaireBallotSlot = {
  slotId: string;
  slotIndex: number;
  version: number;
};

export type QuestionnaireCredentialsPerVoter = 1 | 2;

export type QuestionnaireVoterGroup = {
  id: string;
  label: string;
};

export const QUESTIONNAIRE_PRIVATE_INVITE_MAX_REDEMPTIONS = 10_000;

export function normaliseQuestionnairePrivateInviteMaxRedemptions(value: unknown): number {
  const count = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.min(QUESTIONNAIRE_PRIVATE_INVITE_MAX_REDEMPTIONS, Math.max(1, count));
}

export function normaliseQuestionnaireScope(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (!normalised || normalised === "main" || normalised === "0") {
    return null;
  }
  if (normalised === "a") {
    return "1";
  }
  if (normalised === "b") {
    return "2";
  }
  if (normalised === "c") {
    return "3";
  }
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalised) ? normalised : null;
}

export const normaliseQuestionnaireBallotGroup = normaliseQuestionnaireScope;

export function questionRequiredScope(question: Pick<QuestionnaireQuestionBase, "requiredScope" | "ballotGroup">): string | null {
  return normaliseQuestionnaireScope(question.requiredScope ?? question.ballotGroup);
}

export function allowedScopesForRequiredScope(requiredScope?: string | null): string[] {
  const normalised = normaliseQuestionnaireScope(requiredScope);
  return normalised ? ["0", normalised] : ["0"];
}

export function normaliseQuestionnaireAllowedScopes(value: unknown, fallbackRequiredScope?: string | null): string[] {
  const scopes = new Set<string>(["0"]);
  const entries = Array.isArray(value) ? value : [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalised = normaliseQuestionnaireScope(entry);
    scopes.add(normalised ?? "0");
  }
  const fallback = normaliseQuestionnaireScope(fallbackRequiredScope);
  if (fallback) {
    scopes.add(fallback);
  }
  return [...scopes].sort((left, right) => {
    if (left === "0") {
      return -1;
    }
    if (right === "0") {
      return 1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export type QuestionnaireYesNoQuestion = QuestionnaireQuestionBase & {
  type: "yes_no";
};

export type QuestionnaireMultipleChoiceOption = {
  optionId: string;
  label: string;
};

export type QuestionnaireMultipleChoiceQuestion = QuestionnaireQuestionBase & {
  type: "multiple_choice";
  multiSelect: boolean;
  options: QuestionnaireMultipleChoiceOption[];
};

export type QuestionnaireRankQuestion = QuestionnaireQuestionBase & {
  type: "rank";
  options: QuestionnaireMultipleChoiceOption[];
  minimumRanked: number;
};

export type QuestionnaireFreeTextQuestion = QuestionnaireQuestionBase & {
  type: "free_text";
  maxLength: number;
  encryptResponses?: boolean;
};

export type QuestionnaireQuestion =
  | QuestionnaireYesNoQuestion
  | QuestionnaireMultipleChoiceQuestion
  | QuestionnaireRankQuestion
  | QuestionnaireFreeTextQuestion;

export type QuestionnaireDefinition = {
  schemaVersion: 1;
  eventType: "questionnaire_definition";
  protocolVersion?: 1 | 2;
  flowMode?: QuestionnaireFlowMode;
  responseMode: QuestionnaireResponseMode;
  questionnaireId: string;
  title: string;
  description?: string;
  createdAt: number;
  openAt: number;
  closeAt: number;
  coordinatorPubkey: string;
  coordinatorEncryptionPubkey: string;
  responseVisibility: "public" | "private";
  eligibilityMode: "open" | "allowlist";
  /** Leading zero SHA-256 bits required for general blind-ballot requests. */
  generalInvitePowDifficulty?: number;
  /**
   * How public blind-token submissions are published.
   * - `immediate` (default): published as soon as the voter submits.
   * - `windowed`: held locally and released once at `closeAt`, then accepted
   *   until `closeAt + finalizationGraceSeconds`.
   */
  publicationMode?: QuestionnairePublicationMode;
  /** Seconds after `closeAt` during which late windowed releases are still valid. */
  finalizationGraceSeconds?: number;
  allowMultipleResponsesPerPubkey: boolean;
  ballotCredentialMode?: QuestionnaireBallotCredentialMode;
  credentialsPerVoter?: QuestionnaireCredentialsPerVoter;
  blindSigningPublicKey?: QuestionnaireBlindPublicKey | null;
  questionnaireRelays?: string[];
  voterGroups?: QuestionnaireVoterGroup[];
  questions: QuestionnaireQuestion[];
};

export type QuestionnaireDefinitionReference = {
  questionnaireId: string;
  coordinatorNpub?: string | null;
  relays?: string[];
  definitionHash?: string | null;
  definitionEventId?: string | null;
  createdAt?: number | null;
};

export type QuestionnaireParticipantCountEvent = {
  schemaVersion: 1;
  eventType: "questionnaire_participant_count";
  questionnaireId: string;
  expectedInviteeCount: number;
  createdAt: number;
  coordinatorPubkey: string;
};

export type QuestionnaireStateValue = "draft" | "open" | "closed" | "results_published";

export type QuestionnaireStateEvent = {
  schemaVersion: 1;
  eventType: "questionnaire_state";
  questionnaireId: string;
  state: QuestionnaireStateValue;
  createdAt: number;
  coordinatorPubkey: string;
  closedBy?: "audit_proxy" | "coordinator";
  delegationId?: string;
  workerPubkey?: string;
};

export type QuestionnairePrivateInviteStatusEvent = {
  schemaVersion: 1;
  eventType: "questionnaire_private_invite_status";
  questionnaireId: string;
  codeHash: string;
  state: "available" | "redeemed" | "revoked";
  createdAt: number;
  coordinatorPubkey: string;
  redeemedNpubHash?: string | null;
  redemptionCount?: number;
  maxRedemptions?: number;
  redeemedAt?: string | null;
  revokedAt?: string | null;
};

export type QuestionnaireResponseAnswer =
  | {
      questionId: string;
      answerType: "yes_no";
      value: boolean;
    }
  | {
      questionId: string;
      answerType: "multiple_choice";
      selectedOptionIds: string[];
    }
  | {
      questionId: string;
      answerType: "rank";
      rankedOptionIds: string[];
    }
  | {
      questionId: string;
      answerType: "free_text";
      text: string;
    };

export type QuestionnaireResponsePayload = {
  schemaVersion: 1;
  kind: "questionnaire_response_payload";
  questionnaireId: string;
  responseId: string;
  submittedAt: number;
  answers: QuestionnaireResponseAnswer[];
};

export type QuestionnaireResponsePrivateEnvelope = {
  schemaVersion: 1;
  eventType: "questionnaire_response_private";
  questionnaireId: string;
  responseId: string;
  createdAt: number;
  authorPubkey: string;
  ciphertextScheme: "nip44v2";
  ciphertextRecipient: string;
  ciphertext: string;
  payloadHash: string;
};

export type QuestionnaireResultQuestionSummary =
  | {
      questionId: string;
      answerType: "yes_no";
      yesCount: number;
      noCount: number;
    }
  | {
      questionId: string;
      answerType: "multiple_choice";
      optionCounts: Record<string, number>;
    }
  | {
      questionId: string;
      answerType: "rank";
      optionScores: Record<string, number>;
      rankCounts: Record<string, Record<string, number>>;
      responseCount: number;
      blankResponseCount: number;
    }
  | {
      questionId: string;
      answerType: "free_text";
      freeTextCount: number;
    };

export type QuestionnairePublishedResponseRef = {
  responseId: string;
  authorPubkey: string;
  submittedAt: number;
  accepted: boolean;
  tokenNullifier?: string;
  tokenNullifiers?: Array<{
    questionId?: string | null;
    tokenNullifier: string;
    ballotScope?: {
      questionId?: string | null;
      slotId?: string | null;
      slotIndex?: number | null;
      version?: number | null;
      credentialIndex?: number | null;
    } | null;
  }>;
  tokenProof?: {
    tokenCommitment: string;
    questionnaireId: string;
    signature: string;
    questionId?: string | null;
    ballotScope?: {
      questionId?: string | null;
      slotId?: string | null;
      slotIndex?: number | null;
      version?: number | null;
      credentialIndex?: number | null;
    } | null;
  };
  tokenProofs?: Array<NonNullable<QuestionnairePublishedResponseRef["tokenProof"]>>;
  answers?: QuestionnaireResponseAnswer[];
  rejectionReason?: string | null;
};

export type QuestionnaireResultPackReference = {
  url: string;
  sha256: string;
  size: number;
  type: "text/csv" | "application/vnd.auditable-voting.result-pack+json";
  compression: "none" | "gzip";
  uploadEncoding?: "csv" | "gzip" | "json+base64url-gzip";
  payloadSha256?: string;
  payloadSize?: number;
  uploadedAt: number;
  server?: string;
  mirrors?: Array<{
    url: string;
    server?: string;
  }>;
};

export type QuestionnaireResultSummary = {
  schemaVersion: 1;
  eventType: "questionnaire_result_summary";
  questionnaireId: string;
  createdAt: number;
  coordinatorPubkey: string;
  acceptedResponseCount: number;
  rejectedResponseCount: number;
  acceptedNullifierCount?: number;
  questionSummaries: QuestionnaireResultQuestionSummary[];
  publishedResponseRefs?: QuestionnairePublishedResponseRef[];
  resultPack?: QuestionnaireResultPackReference;
  resultHash?: string;
};

export type QuestionnaireSubmissionDecisionReason =
  | "accepted"
  | "duplicate_nullifier"
  | "invalid_token_proof"
  | "invalid_payload_shape"
  | "questionnaire_closed";

export type QuestionnaireSubmissionDecision = {
  schemaVersion: 1;
  eventType: "questionnaire_submission_decision";
  questionnaireId: string;
  submissionId: string;
  tokenNullifier: string;
  accepted: boolean;
  reason: QuestionnaireSubmissionDecisionReason;
  decidedAt: number;
  coordinatorPubkey: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

function isNonEmpty(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function questionnaireUsesPerQuestionCredentials(definition: Pick<QuestionnaireDefinition, "ballotCredentialMode"> | null | undefined) {
  return definition?.ballotCredentialMode === "per_question";
}

/**
 * True when public blind-token submissions for this questionnaire are held and
 * released in a single slot at `closeAt` rather than published on submit.
 */
export function questionnaireIsWindowedPublication(
  definition: Pick<QuestionnaireDefinition, "publicationMode"> | null | undefined,
): boolean {
  return definition?.publicationMode === QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED;
}

/** Unix seconds at which windowed submissions are released. */
export function questionnaireReleaseAt(
  definition: Pick<QuestionnaireDefinition, "publicationMode" | "closeAt"> | null | undefined,
): number | null {
  if (!definition || !questionnaireIsWindowedPublication(definition)) {
    return null;
  }
  return Number.isFinite(definition.closeAt) ? definition.closeAt : null;
}

/** Unix seconds after which a windowed release is no longer accepted. */
export function questionnaireGraceUntil(
  definition: Pick<QuestionnaireDefinition, "publicationMode" | "closeAt" | "finalizationGraceSeconds"> | null | undefined,
): number | null {
  const releaseAt = questionnaireReleaseAt(definition);
  if (releaseAt === null) {
    return null;
  }
  const grace = definition?.finalizationGraceSeconds;
  return releaseAt + (Number.isFinite(grace) && (grace as number) > 0 ? (grace as number) : 0);
}

/**
 * Snapshot of the release policy persisted into voter-local state (A6).
 *
 * The shared definition cache can be evicted between the vote and the release.
 * Without a local copy of the mode an evicted cache looks like "no window at
 * all" and the ballot is published immediately with its real submission time,
 * which is precisely the timing leak windowed publication exists to prevent.
 */
export type QuestionnairePublicationPolicy = {
  publicationMode: QuestionnairePublicationMode;
  /** Positive grace in seconds; null when the policy is malformed (fail closed). */
  finalizationGraceSeconds: number | null;
  closeAt: number;
};

function normaliseQuestionnaireGraceSeconds(value: unknown): number | null {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : null;
}

/** Builds the persistable policy snapshot from a definition. */
export function questionnairePublicationPolicyFromDefinition(
  definition: Pick<QuestionnaireDefinition, "publicationMode" | "closeAt" | "finalizationGraceSeconds"> | null | undefined,
): QuestionnairePublicationPolicy | null {
  if (!definition || !Number.isFinite(definition.closeAt)) {
    // No definition (cache evicted) or no closeAt: we genuinely cannot tell the
    // mode, so the caller must fail closed (A6) rather than publish immediately.
    return null;
  }
  const mode = definition.publicationMode;
  // A missing / undefined mode is the historical default and means "immediate":
  // the round was never declared windowed, so releasing right away is correct.
  // Only a windowed mode needs the fail-closed guard.
  if (mode === QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED) {
    return {
      publicationMode: QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED,
      finalizationGraceSeconds: normaliseQuestionnaireGraceSeconds(definition.finalizationGraceSeconds),
      closeAt: Math.floor(definition.closeAt),
    };
  }
  if (mode !== undefined && mode !== QUESTIONNAIRE_PUBLICATION_MODE_IMMEDIATE) {
    // An explicit, unrecognised mode (e.g. a future format) must not be silently
    // downgraded to immediate publication.
    return null;
  }
  return {
    publicationMode: QUESTIONNAIRE_PUBLICATION_MODE_IMMEDIATE,
    finalizationGraceSeconds: null,
    closeAt: Math.floor(definition.closeAt),
  };
}

/** Validates an untrusted persisted policy snapshot; null means "unknown, fail closed". */
export function normaliseQuestionnairePublicationPolicy(value: unknown): QuestionnairePublicationPolicy | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as {
    publicationMode?: unknown;
    finalizationGraceSeconds?: unknown;
    closeAt?: unknown;
  };
  const mode = candidate.publicationMode;
  if (mode !== QUESTIONNAIRE_PUBLICATION_MODE_IMMEDIATE && mode !== QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED) {
    return null;
  }
  if (!Number.isFinite(candidate.closeAt)) {
    return null;
  }
  return {
    publicationMode: mode,
    finalizationGraceSeconds: mode === QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED
      ? normaliseQuestionnaireGraceSeconds(candidate.finalizationGraceSeconds)
      : null,
    closeAt: Math.floor(candidate.closeAt as number),
  };
}

/** Policy-level twin of questionnaireReleaseAt. */
export function questionnairePublicationPolicyReleaseAt(
  policy: Pick<QuestionnairePublicationPolicy, "publicationMode" | "closeAt"> | null | undefined,
): number | null {
  if (!policy || policy.publicationMode !== QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED) {
    return null;
  }
  return Number.isFinite(policy.closeAt) ? Math.floor(policy.closeAt) : null;
}

/**
 * Policy-level twin of questionnaireGraceUntil. Returns null when the grace is
 * missing or non-positive so callers can fail closed instead of degrading a
 * windowed round into an immediate publication (A3).
 */
export function questionnairePublicationPolicyGraceUntil(
  policy: QuestionnairePublicationPolicy | null | undefined,
): number | null {
  const releaseAt = questionnairePublicationPolicyReleaseAt(policy);
  if (releaseAt === null) {
    return null;
  }
  const grace = policy?.finalizationGraceSeconds;
  return Number.isFinite(grace) && (grace as number) > 0 ? releaseAt + Math.floor(grace as number) : null;
}

/**
 * Timestamp a public blind-token submission should carry. Windowed rounds use
 * the shared release slot so the public record does not reveal per-voter
 * submission time; immediate rounds use the supplied wall-clock time.
 */
export function questionnaireSubmissionTimestamp(
  definition: Pick<QuestionnaireDefinition, "publicationMode" | "closeAt"> | null | undefined,
  nowSeconds: number,
): number {
  return questionnaireReleaseAt(definition) ?? nowSeconds;
}

export function questionnaireCredentialsPerVoter(definition: Pick<QuestionnaireDefinition, "credentialsPerVoter"> | null | undefined): QuestionnaireCredentialsPerVoter {
  return normaliseQuestionnaireCredentialsPerVoter(definition?.credentialsPerVoter);
}

/**
 * True when a published result summary was signed before the windowed
 * finalization grace elapsed, i.e. it may have missed late releases.
 */
export function questionnaireResultSummaryIsPremature(
  summary: Pick<QuestionnaireResultSummary, "createdAt"> | null | undefined,
  definition: Pick<QuestionnaireDefinition, "publicationMode" | "closeAt" | "finalizationGraceSeconds"> | null | undefined,
): boolean {
  if (!summary) {
    return false;
  }
  const allowedAt = questionnaireGraceUntil(definition);
  if (allowedAt === null) {
    return false;
  }
  return Number.isFinite(summary.createdAt) && summary.createdAt < allowedAt;
}

export function normaliseQuestionnaireCredentialsPerVoter(value: unknown): QuestionnaireCredentialsPerVoter {
  return value === 2 ? 2 : 1;
}

export function normaliseQuestionBallotSlot(question: QuestionnaireQuestion, index: number): QuestionnaireBallotSlot {
  const slot = question.ballotSlot ?? null;
  const rawSlotIndex = slot?.slotIndex;
  const rawVersion = slot?.version;
  const slotIndex = Number.isFinite(rawSlotIndex)
    ? Math.max(1, Math.floor(rawSlotIndex as number))
    : index + 1;
  const version = Number.isFinite(rawVersion)
    ? Math.max(1, Math.floor(rawVersion as number))
    : 1;
  const slotId = typeof slot?.slotId === "string" && slot.slotId.trim()
    ? slot.slotId.trim()
    : question.questionId.trim();
  return {
    slotId,
    slotIndex,
    version,
  };
}

export function questionBallotScopeKey(question: QuestionnaireQuestion, index: number, credentialIndex = 1) {
  const slot = normaliseQuestionBallotSlot(question, index);
  const requiredScope = questionRequiredScope(question);
  const scopePrefix = requiredScope ? `scopes:${requiredScope}:` : "";
  const credentialSuffix = Number.isFinite(credentialIndex) && Math.floor(credentialIndex) > 1
    ? `:c${Math.floor(credentialIndex)}`
    : "";
  return `${scopePrefix}slot:${slot.slotIndex}:v${slot.version}${credentialSuffix}`;
}

export function questionBallotCredentialScope(question: QuestionnaireQuestion, index: number, credentialIndex = 1) {
  const slot = normaliseQuestionBallotSlot(question, index);
  const normalizedCredentialIndex = Number.isFinite(credentialIndex)
    ? Math.max(1, Math.floor(credentialIndex))
    : 1;
  const requiredScope = questionRequiredScope(question);
  return {
    slotIndex: slot.slotIndex,
    version: slot.version,
    ...(requiredScope ? { allowedScopes: allowedScopesForRequiredScope(requiredScope) } : {}),
    ...(normalizedCredentialIndex > 1 ? { credentialIndex: normalizedCredentialIndex } : {}),
  };
}

export function clampRankMinimum(question: Pick<QuestionnaireRankQuestion, "options" | "minimumRanked">) {
  const optionCount = Array.isArray(question.options) ? question.options.length : 0;
  if (!Number.isFinite(question.minimumRanked)) {
    return 0;
  }
  return Math.min(optionCount, Math.max(0, Math.floor(question.minimumRanked)));
}

export function normaliseRankedOptionIds(question: Pick<QuestionnaireRankQuestion, "options">, rankedOptionIds: unknown) {
  const validOptions = new Set(question.options.map((option) => option.optionId));
  const seen = new Set<string>();
  const normalised: string[] = [];
  if (!Array.isArray(rankedOptionIds)) {
    return normalised;
  }
  for (const optionId of rankedOptionIds) {
    if (typeof optionId !== "string" || !validOptions.has(optionId) || seen.has(optionId)) {
      continue;
    }
    seen.add(optionId);
    normalised.push(optionId);
  }
  return normalised.slice(0, question.options.length);
}

export function calculateRankQuestionScores(
  question: Pick<QuestionnaireRankQuestion, "options">,
  rankedOptionIds: unknown,
) {
  const normalised = normaliseRankedOptionIds(question, rankedOptionIds);
  const optionCount = question.options.length;
  const optionScores = Object.fromEntries(question.options.map((option) => [option.optionId, 0]));
  normalised.forEach((optionId, index) => {
    optionScores[optionId] = optionCount - index;
  });
  return optionScores;
}

export function validateQuestionnaireDefinition(input: QuestionnaireDefinition): ValidationResult {
  const errors: string[] = [];
  if (
    input.flowMode !== undefined
    && input.flowMode !== QUESTIONNAIRE_FLOW_MODE_LEGACY_PRIVATE_DM
    && input.flowMode !== QUESTIONNAIRE_FLOW_MODE_PUBLIC_SUBMISSION_V1
  ) {
    errors.push("flow_mode_invalid");
  }
  if (
    input.ballotCredentialMode !== undefined
    && input.ballotCredentialMode !== "questionnaire"
    && input.ballotCredentialMode !== "per_question"
  ) {
    errors.push("ballot_credential_mode_invalid");
  }
  if (
    input.credentialsPerVoter !== undefined
    && input.credentialsPerVoter !== 1
    && input.credentialsPerVoter !== 2
  ) {
    errors.push("credentials_per_voter_invalid");
  }
  if (
    input.generalInvitePowDifficulty !== undefined
    && (!Number.isInteger(input.generalInvitePowDifficulty)
      || input.generalInvitePowDifficulty < 0
      || input.generalInvitePowDifficulty > 24)
  ) {
    errors.push("general_invite_pow_difficulty_invalid");
  }
  if (
    input.publicationMode !== undefined
    && input.publicationMode !== QUESTIONNAIRE_PUBLICATION_MODE_IMMEDIATE
    && input.publicationMode !== QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED
  ) {
    errors.push("publication_mode_invalid");
  }
  if (input.publicationMode === QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED) {
    if (
      input.finalizationGraceSeconds === undefined
      || !Number.isInteger(input.finalizationGraceSeconds)
      || input.finalizationGraceSeconds < 0
      || input.finalizationGraceSeconds > QUESTIONNAIRE_MAX_FINALIZATION_GRACE_SECONDS
    ) {
      errors.push("finalization_grace_seconds_invalid");
    }
  } else if (input.finalizationGraceSeconds !== undefined) {
    errors.push("finalization_grace_seconds_unexpected");
  }
  if (
    input.responseMode !== QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN
    && input.responseMode !== QUESTIONNAIRE_RESPONSE_MODE_LEGACY_PRIVATE_ENVELOPE
  ) {
    errors.push("response_mode_invalid");
  }
  if (!isNonEmpty(input.questionnaireId)) {
    errors.push("questionnaire_id_missing");
  }
  if (!isNonEmpty(input.coordinatorPubkey)) {
    errors.push("coordinator_pubkey_missing");
  }
  if (!isNonEmpty(input.coordinatorEncryptionPubkey)) {
    errors.push("coordinator_encryption_pubkey_missing");
  }
  if (input.questionnaireRelays !== undefined) {
    const normalizedRelays = normalizeQuestionnaireRelays(input.questionnaireRelays);
    if (!Array.isArray(input.questionnaireRelays) || normalizedRelays.length !== input.questionnaireRelays.length) {
      errors.push("questionnaire_relays_invalid");
    }
  }
  const voterGroupIds = new Set<string>();
  const voterGroupLabels = new Set<string>();
  if (input.voterGroups !== undefined) {
    if (!Array.isArray(input.voterGroups) || input.voterGroups.length > 100) {
      errors.push("voter_groups_invalid");
    } else {
      for (const group of input.voterGroups) {
        const id = normaliseQuestionnaireScope(group?.id);
        const label = typeof group?.label === "string" ? group.label.trim() : "";
        if (!id || !label) {
          errors.push("voter_group_invalid");
          continue;
        }
        if (voterGroupIds.has(id)) {
          errors.push(`voter_group_id_duplicate:${id}`);
        }
        const labelKey = label.toLowerCase();
        if (voterGroupLabels.has(labelKey)) {
          errors.push(`voter_group_label_duplicate:${labelKey}`);
        }
        voterGroupIds.add(id);
        voterGroupLabels.add(labelKey);
      }
    }
  }
  if (!Number.isFinite(input.openAt) || !Number.isFinite(input.closeAt) || input.openAt >= input.closeAt) {
    errors.push("invalid_open_close_window");
  }
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    errors.push("questions_missing");
  } else {
    const questionIds = new Set<string>();
    for (const [index, question] of input.questions.entries()) {
      if (!isNonEmpty(question.questionId)) {
        errors.push("question_id_missing");
        continue;
      }
      if (questionIds.has(question.questionId)) {
        errors.push(`question_id_duplicate:${question.questionId}`);
      }
      questionIds.add(question.questionId);
      if (question.requiredScope !== undefined && question.requiredScope !== null && !normaliseQuestionnaireScope(question.requiredScope)) {
        errors.push(`required_scope_invalid:${question.questionId}`);
      }
      if (question.ballotGroup !== undefined && question.ballotGroup !== null && !normaliseQuestionnaireScope(question.ballotGroup)) {
        errors.push(`ballot_group_invalid:${question.questionId}`);
      }
      const requiredScope = questionRequiredScope(question);
      if (requiredScope && Array.isArray(input.voterGroups) && !voterGroupIds.has(requiredScope)) {
        errors.push(`required_scope_unknown:${question.questionId}`);
      }
      if (input.ballotCredentialMode === "per_question") {
        const slot = normaliseQuestionBallotSlot(question, index);
        if (!isNonEmpty(slot.slotId)) {
          errors.push(`ballot_slot_id_missing:${question.questionId}`);
        }
        if (!Number.isFinite(slot.slotIndex) || slot.slotIndex <= 0) {
          errors.push(`ballot_slot_index_invalid:${question.questionId}`);
        }
        if (!Number.isFinite(slot.version) || slot.version <= 0) {
          errors.push(`ballot_slot_version_invalid:${question.questionId}`);
        }
      }

      if (question.type === "multiple_choice" || question.type === "rank") {
        if (!Array.isArray(question.options) || question.options.length < 2) {
          errors.push(`${question.type}_insufficient_options:${question.questionId}`);
          continue;
        }
        const optionIds = new Set<string>();
        for (const option of question.options) {
          if (!isNonEmpty(option.optionId)) {
            errors.push(`option_id_missing:${question.questionId}`);
            continue;
          }
          if (optionIds.has(option.optionId)) {
            errors.push(`option_id_duplicate:${question.questionId}:${option.optionId}`);
          }
          optionIds.add(option.optionId);
        }
      }

      if (question.type === "rank") {
        if (
          !Number.isFinite(question.minimumRanked)
          || Math.floor(question.minimumRanked) !== question.minimumRanked
          || question.minimumRanked < 0
          || question.minimumRanked > question.options.length
        ) {
          errors.push(`rank_minimum_invalid:${question.questionId}`);
        }
      }

      if (question.type === "free_text") {
        if (!Number.isFinite(question.maxLength) || question.maxLength <= 0) {
          errors.push(`invalid_free_text_max_length:${question.questionId}`);
        }
        if (question.encryptResponses !== undefined && typeof question.encryptResponses !== "boolean") {
          errors.push(`invalid_free_text_encrypt_responses:${question.questionId}`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeQuestionnaireDefinition(
  input: Omit<QuestionnaireDefinition, "responseMode" | "flowMode"> & {
    responseMode?: QuestionnaireResponseMode | null;
    flowMode?: QuestionnaireFlowMode | null;
  },
): QuestionnaireDefinition {
  const responseMode = input.responseMode ?? QUESTIONNAIRE_RESPONSE_MODE_LEGACY_PRIVATE_ENVELOPE;
  const flowMode = input.flowMode
    ?? (responseMode === QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN
      ? QUESTIONNAIRE_FLOW_MODE_PUBLIC_SUBMISSION_V1
      : QUESTIONNAIRE_FLOW_MODE_LEGACY_PRIVATE_DM);
  const questionnaireRelays = questionnaireRelaysForMetadata(input.questionnaireRelays ?? []);
  return {
    ...input,
    responseMode,
    flowMode,
    protocolVersion: input.protocolVersion ?? QUESTIONNAIRE_PROTOCOL_VERSION_V1,
    ...(questionnaireRelays ? { questionnaireRelays } : { questionnaireRelays: undefined }),
  };
}

export function validateQuestionnaireResponsePayload(input: {
  definition: QuestionnaireDefinition;
  payload: QuestionnaireResponsePayload;
}): ValidationResult {
  const errors: string[] = [];
  const { definition, payload } = input;
  if (payload.questionnaireId !== definition.questionnaireId) {
    errors.push("questionnaire_id_mismatch");
  }
  const byQuestionId = new Map(definition.questions.map((question) => [question.questionId, question]));
  const seenAnswers = new Set<string>();

  for (const answer of payload.answers) {
    const question = byQuestionId.get(answer.questionId);
    if (!question) {
      errors.push(`unknown_question_id:${answer.questionId}`);
      continue;
    }
    if (seenAnswers.has(answer.questionId)) {
      errors.push(`duplicate_answer:${answer.questionId}`);
      continue;
    }
    seenAnswers.add(answer.questionId);

    if (question.type === "yes_no") {
      if (answer.answerType !== "yes_no") {
        errors.push(`invalid_answer_type:${answer.questionId}`);
      }
      continue;
    }

    if (question.type === "multiple_choice") {
      if (answer.answerType !== "multiple_choice") {
        errors.push(`invalid_answer_type:${answer.questionId}`);
        continue;
      }
      const selected = Array.isArray(answer.selectedOptionIds) ? answer.selectedOptionIds : [];
      if (!question.multiSelect && selected.length !== 1) {
        errors.push(`invalid_selection_count:${answer.questionId}`);
      }
      const validOptions = new Set(question.options.map((option) => option.optionId));
      for (const optionId of selected) {
        if (!validOptions.has(optionId)) {
          errors.push(`invalid_option_id:${answer.questionId}:${optionId}`);
        }
      }
      continue;
    }

    if (question.type === "rank") {
      if (answer.answerType !== "rank") {
        errors.push(`invalid_answer_type:${answer.questionId}`);
        continue;
      }
      const ranked = Array.isArray(answer.rankedOptionIds) ? answer.rankedOptionIds : [];
      const minimumRanked = clampRankMinimum(question);
      if (ranked.length < minimumRanked) {
        errors.push(`rank_selection_count:${answer.questionId}`);
      }
      if (ranked.length > question.options.length) {
        errors.push(`rank_selection_count:${answer.questionId}`);
      }
      const validOptions = new Set(question.options.map((option) => option.optionId));
      const seenRankedOptions = new Set<string>();
      for (const optionId of ranked) {
        if (typeof optionId !== "string" || !validOptions.has(optionId)) {
          errors.push(`invalid_option_id:${answer.questionId}:${String(optionId)}`);
          continue;
        }
        if (seenRankedOptions.has(optionId)) {
          errors.push(`duplicate_ranked_option:${answer.questionId}:${optionId}`);
        }
        seenRankedOptions.add(optionId);
      }
      continue;
    }

    if (answer.answerType !== "free_text") {
      errors.push(`invalid_answer_type:${answer.questionId}`);
      continue;
    }
    if (answer.text.length > question.maxLength) {
      errors.push(`free_text_too_long:${answer.questionId}`);
    }
  }

  for (const question of definition.questions) {
    const rankMinimumMissing = question.type === "rank"
      && clampRankMinimum(question) > 0
      && !seenAnswers.has(question.questionId);
    if ((question.required && !seenAnswers.has(question.questionId)) || rankMinimumMissing) {
      errors.push(`missing_required_answer:${question.questionId}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
