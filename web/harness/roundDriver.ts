/**
 * Round driver for the deterministic E2E harness.
 *
 * Every step here goes through the application's **real public interfaces** —
 * the same modules the UI calls — against the local harness relay:
 *
 * - seed a coordinator — `nostr-tools` keygen plus
 *   `publishQuestionnaireDefinition`;
 * - open the round — `publishQuestionnaireState`;
 * - mint a voter blind credential — the `questionnaireBlindSignature` module
 *   (blind, blindSign, finalize, verify);
 * - publish a ballot — `publishQuestionnaireBlindResponsePublic`;
 * - decide a ballot (accept/reject) — `evaluateQuestionnaireBlindAdmissions` plus
 *   `verifyQuestionnaireBlindResponseProofVerdicts` plus
 *   `publishQuestionnaireSubmissionDecisionPublic`;
 * - read the result and observer output — `fetchQuestionnaireBlindResponses`
 *   plus `fetchQuestionnaireResultSummary`.
 *
 * Nothing here re-implements protocol logic. If a change to the app breaks the
 * protocol, the harness fails.
 *
 * Determinism: identities are derived from fixed seeds, the questionnaire id and
 * timestamps come from the injected clock, and every list is sorted. There is no
 * randomness in publication order and no `sleep()` anywhere — time is moved with
 * the injected clock only.
 */
import {
  buildQuestionnaireBlindTokenSignedMessage,
  deriveQuestionnaireTokenNullifier,
} from "../src/questionnaireBlindToken";
import {
  blindQuestionnaireToken,
  finalizeQuestionnaireBlindSignature,
  generateQuestionnaireBlindKeyPair,
  signBlindedQuestionnaireToken,
  toQuestionnaireBlindPublicKey,
  verifyQuestionnaireBlindSignature,
  type QuestionnaireBlindPrivateKey,
  type QuestionnaireBlindPublicKey,
} from "../src/questionnaireBlindSignature";
import { getPublicKey, nip19, type NostrEvent } from "nostr-tools";
import {
  QUESTIONNAIRE_RESPONSE_PROVISIONAL_KIND,
  publishQuestionnaireBlindResponsePublic,
  publishQuestionnaireSubmissionDecisionPublic,
} from "../src/questionnaireResponsePublish";
import {
  QUESTIONNAIRE_DEFINITION_KIND,
  QUESTIONNAIRE_RESULT_SUMMARY_KIND,
  QUESTIONNAIRE_STATE_KIND,
  publishQuestionnaireDefinition,
  publishQuestionnaireResultSummary,
  publishQuestionnaireState,
} from "../src/questionnaireNostr";
import {
  evaluateQuestionnaireBlindAdmissions,
  fetchQuestionnaireBlindResponses,
  fetchQuestionnaireDefinitions,
  fetchQuestionnaireResultSummary,
  fetchQuestionnaireState,
  type QuestionnaireBlindAdmissionDecision,
} from "../src/questionnaireTransport";
import { fetchSharedNostrPoolHelpers } from "./poolBridge";
import {
  buildQuestionnaireResultSummary,
  selectLatestQuestionnaireDefinition,
  selectLatestQuestionnaireState,
} from "../src/questionnaireRuntime";
import {
  normalizeQuestionnaireDefinition,
  validateQuestionnaireDefinition,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
  type QuestionnaireResponseAnswer,
} from "../src/questionnaireProtocol";
import {
  QUESTIONNAIRE_FLOW_MODE_PUBLIC_SUBMISSION_V1,
  QUESTIONNAIRE_PUBLICATION_MODE_IMMEDIATE,
  QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED,
  QUESTIONNAIRE_PROTOCOL_VERSION_V1,
  QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN,
} from "../src/questionnaireProtocolConstants";
import {
  ANSWER_TYPE_MIX_MIXED,
  normaliseAnswerTypeMix,
  type QuestionnaireAnswerTypeMix,
} from "./answerTypeMix";
import type { FakeClock } from "./timeControl";
import type { RelayServer } from "./relayServer";

/** Fixed key material. Identities are seeded, never random. */
export type SeededIdentity = {
  seedByte: number;
  nsec: string;
  npub: string;
  pubkeyHex: string;
};

export type CoordinatorFixture = SeededIdentity;

export type VoterFixture = SeededIdentity & {
  /** Deterministic OTP for this voter. */
  otp: string;
  label: string;
};

export type RoundWindow = {
  openAt: number;
  closeAt: number;
  graceSeconds: number;
};

export type HarnessFailure = {
  step: string;
  message: string;
};

export type RelayPublishSummary = {
  relayResults: Array<{ relay: string; success: boolean; error?: string }>;
  successes: number;
  failures: number;
};

export type RoundResult = {
  questionnaireId: string;
  definitionEventId: string;
  stateEvents: NostrEvent[];
  options: Record<string, unknown>;
};

export type TallyRow = {
  questionId: string;
  /** Canonical JSON of the question summary, for stable comparison. */
  summary: string;
};

/** Canonical, sortable snapshot of one round's observable output. */
export type RoundObservation = {
  definitionEventIds: string[];
  /** Ballot event ids, sorted. */
  ballotEventIds: string[];
  /** Ballot signatures, sorted — the strongest determinism witness. */
  ballotSignatures: string[];
  /** Admission decisions: event id → accepted, sorted by event id. */
  admissions: Array<{ eventId: string; accepted: boolean; rejectionReason: string | null }>;
  /** Credential nullifiers, sorted. */
  nullifiers: string[];
  /** Relay receipt order: kind per seq. */
  receiptKinds: number[];
  /** Tally rows, sorted by question id. */
  tallyRows: TallyRow[];
  /** Result summary hash + published event id, when a summary was published. */
  resultHash: string | null;
  resultSummaryEventId: string | null;
  observerState: string | null;
  provisionalCount: number;
};

export type RoundDriverConfig = {
  relay: RelayServer;
  clock: FakeClock;
  questionnaireId: string;
  /**
   * Inject a fixed blind-signing keypair. WebCrypto RSA key generation is the
   * only entropy-consuming step on the harness path, so injecting a keypair here
   * is what makes a whole round byte-for-byte reproducible. When omitted, a
   * keypair is generated once per driver (still a fixed input *for that run*:
   * its public key is published in the definition and so is fully observable).
   */
  blindKeyPair?: QuestionnaireBlindPrivateKey;
  /** Seconds the round stays open. Default 300. */
  roundLengthSeconds?: number;
  /** Grace after closeAt during which windowed releases are valid. Default 60. */
  graceSeconds?: number;
  /** 0 → immediate publication; 1 → windowed publication. */
  answerTypeMix?: QuestionnaireAnswerTypeMix;
};

/** Default answer-type mix for harness rounds. */
export const HARNESS_QUESTIONNAIRE_TYPES: QuestionnaireAnswerTypeMix = ANSWER_TYPE_MIX_MIXED;

/**
 * Real SHA-256 hex, matching the client's own `sha256Hex` helper.
 *
 * Deliberately NOT `sha256HexRust` (the wasm-backed 32-bit FNV stand-in used for
 * content fingerprints): the token commitment is a cryptographic commitment and
 * must be a real digest, otherwise the issuer's signature will not verify.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeNsecHex(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error("Expected an nsec secret key.");
  }
  return decoded.data as Uint8Array;
}

/**
 * Derive a fixed secp256k1 identity from a single seed byte.
 *
 * The key is `sha256(<seedByte> repeated 32 times)` — a constant expression, so
 * the same seed always yields the same nsec/npub across processes, machines and
 * CI runs. `nostr-tools` validates the scalar and would reject invalid keys, so
 * seed bytes are chosen from a small verified set (see `SEED_BYTES`).
 */
export function seededIdentity(seedByte: number): SeededIdentity {
  const secret = new Uint8Array(32).fill(seedByte);
  const pubkeyHex = getPublicKey(secret);
  return {
    seedByte,
    nsec: nip19.nsecEncode(secret),
    npub: nip19.npubEncode(pubkeyHex),
    pubkeyHex,
  };
}

/** Seed bytes verified to produce valid keys. */
export const SEED_BYTES = {
  coordinator: 1,
  voterA: 2,
  voterB: 3,
  voterC: 4,
} as const;

/**
 * Build the harness questionnaire definition.
 *
 * `publicationMode: "immediate"` when `answerTypeMix` is 0, `"windowed"` when 1.
 * This is refused rather than coerced if an unsupported mix is passed.
 */
export function buildHarnessDefinition(input: {
  coordinator: CoordinatorFixture;
  questionnaireId: string;
  window: RoundWindow;
  answerTypeMix?: QuestionnaireAnswerTypeMix;
  title?: string;
}): QuestionnaireDefinition {
  const mix = normaliseAnswerTypeMix(input.answerTypeMix ?? HARNESS_QUESTIONNAIRE_TYPES);
  const windowed = mix === ANSWER_TYPE_MIX_MIXED;
  const questionIdFor = (questionId: string) => `${input.questionnaireId}_${questionId}`;
  const questions: QuestionnaireQuestion[] = [
    {
      questionId: questionIdFor("q_alpha"),
      prompt: "Alpha question",
      required: true,
      type: "yes_no",
    },
    {
      questionId: questionIdFor("q_beta"),
      prompt: "Beta question",
      required: false,
      type: "multiple_choice",
      multiSelect: false,
      options: [
        { optionId: "opt_beta_one", label: "One" },
        { optionId: "opt_beta_two", label: "Two" },
      ],
    },
  ];
  return normalizeQuestionnaireDefinition({
    schemaVersion: 1,
    eventType: "questionnaire_definition",
    protocolVersion: QUESTIONNAIRE_PROTOCOL_VERSION_V1,
    flowMode: QUESTIONNAIRE_FLOW_MODE_PUBLIC_SUBMISSION_V1,
    responseMode: QUESTIONNAIRE_RESPONSE_MODE_BLIND_TOKEN,
    questionnaireId: input.questionnaireId,
    title: input.title ?? "Harness round",
    description: "Deterministic E2E harness round.",
    createdAt: input.window.openAt,
    openAt: input.window.openAt,
    closeAt: input.window.closeAt,
    coordinatorPubkey: input.coordinator.npub,
    coordinatorEncryptionPubkey: input.coordinator.npub,
    responseVisibility: "public",
    eligibilityMode: "open",
    allowMultipleResponsesPerPubkey: false,
    ...(windowed
      ? {
          publicationMode: QUESTIONNAIRE_PUBLICATION_MODE_WINDOWED,
          finalizationGraceSeconds: input.window.graceSeconds,
        }
      : { publicationMode: QUESTIONNAIRE_PUBLICATION_MODE_IMMEDIATE }),
    questions,
  });
}

/** Deterministic ballot for a voter — a pure function of the voter fixture. */
export function buildHarnessBallot(input: {
  definition: QuestionnaireDefinition;
  voter: VoterFixture;
  credentialIndex: number;
}): QuestionnaireResponseAnswer[] {
  return [
    {
      questionId: `${input.definition.questionnaireId}_q_alpha`,
      answerType: "yes_no",
      value: input.voter.seedByte % 2 === 0,
    },
    {
      questionId: `${input.definition.questionnaireId}_q_beta`,
      answerType: "multiple_choice",
      selectedOptionIds: [input.voter.seedByte % 2 === 0 ? "opt_beta_one" : "opt_beta_two"],
    },
  ];
}

export type VoterSession = {
  voter: VoterFixture;
  /** The minted, finalized, verified credential. */
  credential: {
    tokenSecret: string;
    tokenSecretCommitment: string;
    nullifier: string;
    signature: string;
    keyId: string;
    verified: boolean;
  };
  /** Published ballot details, available after `publishBallot`. */
  published?: {
    eventId: string;
    event: NostrEvent;
    responseId: string;
    submittedAt: number;
    relay: RelayPublishSummary;
  };
};

export type RoundDriver = {
  readonly questionnaireId: string;
  readonly coordinator: CoordinatorFixture;
  readonly definition: QuestionnaireDefinition;
  readonly window: RoundWindow;
  readonly blindPublicKey: QuestionnaireBlindPublicKey;
  readonly voterSessions: VoterSession[];
  readonly failures: HarnessFailure[];

  /** Publish the round definition (kind 6420) and open state (kind 6421). */
  seedCoordinator(): Promise<RoundResult>;
  /** Mint a verified blind credential for a voter, through the app's blind-signature interface. */
  mintCredential(voter: VoterFixture): Promise<VoterSession>;
  /** Mint credentials for every configured voter, in fixed order. */
  mintAllCredentials(): Promise<VoterSession[]>;
  /**
   * Reset the mint counter so the next `mintCredential` for a voter reuses that
   * voter's credential-index-derived token secret. Used by unlinkability tests to
   * mint the SAME commitment twice under fresh blinding factors.
   */
  resetCredentialCounter(): void;
  /** Sign and publish a voter's ballot (kind 6424). */
  publishBallot(session: VoterSession): Promise<VoterSession>;
  /**
   * Sign and publish a SECOND ballot with the same voter credential but a new
   * response id — a genuine double-vote. The relay stores it as a distinct
   * event; only the coordinator's admission logic can reject it.
   */
  publishDuplicateBallot(session: VoterSession): Promise<{ eventId: string; event: NostrEvent; responseId: string }>;
  /** Publish every ballot, in fixed voter order. */
  publishAllBallots(): Promise<VoterSession[]>;
  /** Run the coordinator's real admission evaluation over the relay contents. */
  readAdmissions(): Promise<{
    decisions: QuestionnaireBlindAdmissionDecision[];
    acceptedEventIds: string[];
    rejected: Array<{ eventId: string; reason: string | null }>;
  }>;
  /** Publish a signed accept/reject decision for a ballot (kind 6425). */
  publishDecision(input: {
    session: VoterSession;
    accepted: boolean;
    reason?: "ok" | "duplicate_nullifier" | "duplicate_response" | "invalid_token_proof";
  }): Promise<{ eventId: string }>;
  /** Read the observer output: everything the app's transports can see on the relay. */
  readObserverOutput(): Promise<{
    definition: QuestionnaireDefinition | null;
    state: string | null;
    ballots: Array<{ eventId: string; responseId: string; submittedAt: number }>;
    provisionalCount: number;
    resultSummary: unknown;
  }>;
  /** Build and publish a result summary with the app's real tally logic. */
  publishResultSummary(): Promise<{
    eventId: string;
    resultHash: string;
    summary: unknown;
  }>;
  /** Deterministic, sorted tally rows for stable cross-run comparison. */
  tallyRows(): Promise<TallyRow[]>;
  /** Raw relay dump used as the evidence artefact. */
  relaySnapshot(): ReturnType<RelayServer["snapshot"]>;
  /**
   * Canonical, sorted snapshot of everything the round produced. Two independent
   * rounds with the same inputs and the same injected clock must return equal
   * `observation()` values — this is the harness's determinism contract.
   */
  observation(): Promise<RoundObservation>;
};

const HARNESS_QUERY_OPTIONS = { timeoutMs: 2_000, maxPages: 1 } as const;

/**
 * Create a round driver. The relay must already be running and the clock
 * installed; the driver never starts or stops either.
 */
export function createRoundDriver(config: RoundDriverConfig): RoundDriver {
  const roundLengthSeconds = config.roundLengthSeconds ?? 300;
  const graceSeconds = config.graceSeconds ?? 60;
  const openAt = config.clock.nowSeconds() + 1;
  const window: RoundWindow = { openAt, closeAt: openAt + roundLengthSeconds, graceSeconds };
  const coordinator = seededIdentity(SEED_BYTES.coordinator);
  const definition = buildHarnessDefinition({
    coordinator,
    questionnaireId: config.questionnaireId,
    window,
    answerTypeMix: config.answerTypeMix,
  });
  const definitionValidation = validateQuestionnaireDefinition(definition);
  if (!definitionValidation.valid) {
    throw new Error(`Invalid harness definition: ${definitionValidation.errors.join(", ")}`);
  }

  const voterSessions: VoterSession[] = [];
  const failures: HarnessFailure[] = [];
  let blindPrivateKey: QuestionnaireBlindPrivateKey | null = null;
  let credentialsMinted = 0;
  // The definition actually published (carries the blind signing public key).
  let publishedDefinition: QuestionnaireDefinition = definition;

  const noteFailure = (step: string, error: unknown) => {
    failures.push({ step, message: error instanceof Error ? error.message : String(error) });
  };

  const relays = () => [config.relay.url];

  const assertAllRelayPublishesSucceeded = (step: string, summary: RelayPublishSummary) => {
    if (summary.failures > 0 || summary.successes === 0) {
      noteFailure(step, `relay publish reported ${summary.failures} failure(s): ${JSON.stringify(summary.relayResults)}`);
    }
  };

  const driver: RoundDriver = {
    questionnaireId: config.questionnaireId,
    coordinator,
    // After seeding, this is the definition that was actually published —
    // including the blind-signing public key used to verify the ballots.
    get definition() {
      return publishedDefinition;
    },
    window,
    get blindPublicKey() {
      if (!blindPrivateKey) {
        throw new Error("Blind signing key has not been created yet; call seedCoordinator() first.");
      }
      return toQuestionnaireBlindPublicKey(blindPrivateKey);
    },
    voterSessions,
    failures,

    async seedCoordinator() {
      if (!blindPrivateKey) {
        blindPrivateKey = config.blindKeyPair ?? await generateQuestionnaireBlindKeyPair();
      }
      const signingKey = blindPrivateKey;
      publishedDefinition = {
        ...definition,
        blindSigningPublicKey: toQuestionnaireBlindPublicKey(signingKey),
      };
      const published = await publishQuestionnaireDefinition({
        coordinatorNsec: coordinator.nsec,
        definition: publishedDefinition,
        relays: relays(),
      });
      assertAllRelayPublishesSucceeded("seedCoordinator:definition", published);

      const openState = await publishQuestionnaireState({
        coordinatorNsec: coordinator.nsec,
        stateEvent: {
          schemaVersion: 1,
          eventType: "questionnaire_state",
          questionnaireId: config.questionnaireId,
          state: "open",
          createdAt: openAt,
          coordinatorPubkey: coordinator.npub,
        },
        relays: relays(),
      });
      assertAllRelayPublishesSucceeded("seedCoordinator:state", openState);

      return {
        questionnaireId: config.questionnaireId,
        definitionEventId: published.eventId,
        stateEvents: [openState.event],
        options: { window, publicationMode: definition.publicationMode },
      };
    },

    async mintCredential(voter: VoterFixture) {
      if (!blindPrivateKey) {
        throw new Error("Call seedCoordinator() before minting credentials.");
      }
      credentialsMinted += 1;
      const credentialIndex = credentialsMinted;
      // This mirrors the client's issuance path exactly
      // (`questionnaireOptionARuntime` mint): a random-per-real-voter token
      // secret, committed with real SHA-256, and the *canonical message string*
      // — not a hash — is what the issuer blinds and signs. Hashing the
      // commitment here instead produces a signature that verifies as invalid.
      const tokenSecret = `${config.questionnaireId}:voter:${voter.seedByte}:credential:${credentialIndex}`;
      const tokenSecretCommitment = await sha256Hex(tokenSecret);
      const nullifier = deriveQuestionnaireTokenNullifier({
        questionnaireId: config.questionnaireId,
        tokenSecret,
      });
      const message = buildQuestionnaireBlindTokenSignedMessage({
        questionnaireId: config.questionnaireId,
        tokenSecretCommitment,
      });
      const publicKey = toQuestionnaireBlindPublicKey(blindPrivateKey);
      const { blindedMessage, blindingFactor } = await blindQuestionnaireToken({ publicKey, message });
      const blindSignature = await signBlindedQuestionnaireToken({
        privateKey: blindPrivateKey,
        blindedMessage,
      });
      const signature = await finalizeQuestionnaireBlindSignature({
        publicKey,
        message,
        blindSignature,
        blindingFactor,
      });
      // Verify locally the same way the client does before it submits.
      const verified = await verifyQuestionnaireBlindSignature({ publicKey, message, signature });
      if (!verified) {
        noteFailure(`mintCredential:${voter.label}`, "issued blind credential failed local verification");
      }
      const session: VoterSession = {
        voter,
        credential: {
          tokenSecret,
          tokenSecretCommitment,
          nullifier,
          signature,
          keyId: publicKey.keyId,
          verified,
        },
      };
      voterSessions.push(session);
      return session;
    },

    resetCredentialCounter() {
      credentialsMinted = 0;
    },

    async mintAllCredentials() {
      const voters: VoterFixture[] = [
        { ...seededIdentity(SEED_BYTES.voterA), otp: "240401", label: "voter-a" },
        { ...seededIdentity(SEED_BYTES.voterB), otp: "240402", label: "voter-b" },
        { ...seededIdentity(SEED_BYTES.voterC), otp: "240403", label: "voter-c" },
      ];
      const sessions: VoterSession[] = [];
      for (const voter of voters) {
        sessions.push(await driver.mintCredential(voter));
      }
      return sessions;
    },

    async publishBallot(session: VoterSession) {
      const answers = buildHarnessBallot({ definition, voter: session.voter, credentialIndex: 1 });
      const responseId = `${config.questionnaireId}:response:${session.voter.seedByte}`;
      const submittedAt = config.clock.nowSeconds();
      const result = await publishQuestionnaireBlindResponsePublic({
        responseNsec: session.voter.nsec,
        questionnaireId: config.questionnaireId,
        responseId,
        submittedAt,
        tokenNullifier: session.credential.nullifier,
        tokenProof: {
          tokenCommitment: session.credential.tokenSecretCommitment,
          questionnaireId: config.questionnaireId,
          signature: session.credential.signature,
          blindSigningKeyId: session.credential.keyId,
        },
        answers,
        relays: relays(),
        usePublishQueue: false,
      });
      session.published = {
        eventId: result.eventId,
        event: result.event,
        responseId,
        submittedAt,
        relay: { relayResults: result.relayResults, successes: result.successes, failures: result.failures },
      };
      assertAllRelayPublishesSucceeded(`publishBallot:${session.voter.label}`, session.published.relay);
      return session;
    },

    async publishDuplicateBallot(session: VoterSession) {
      const answers = buildHarnessBallot({ definition, voter: session.voter, credentialIndex: 1 });
      const responseId = `${config.questionnaireId}:response:${session.voter.seedByte}:replay`;
      const submittedAt = config.clock.nowSeconds();
      const result = await publishQuestionnaireBlindResponsePublic({
        responseNsec: session.voter.nsec,
        questionnaireId: config.questionnaireId,
        responseId,
        submittedAt,
        tokenNullifier: session.credential.nullifier,
        tokenProof: {
          tokenCommitment: session.credential.tokenSecretCommitment,
          questionnaireId: config.questionnaireId,
          signature: session.credential.signature,
          blindSigningKeyId: session.credential.keyId,
        },
        answers,
        relays: relays(),
        usePublishQueue: false,
      });
      assertAllRelayPublishesSucceeded(
        `publishDuplicateBallot:${session.voter.label}`,
        { relayResults: result.relayResults, successes: result.successes, failures: result.failures },
      );
      return { eventId: result.eventId, event: result.event, responseId };
    },

    async publishAllBallots() {
      for (const session of voterSessions) {
        if (!session.published) {
          await driver.publishBallot(session);
        }
      }
      return voterSessions;
    },

    async readAdmissions() {
      const helpers = fetchSharedNostrPoolHelpers();
      const entries = await fetchQuestionnaireBlindResponses({
        questionnaireId: config.questionnaireId,
        relays: relays(),
        ...HARNESS_QUERY_OPTIONS,
      });
      const verdicts = await helpers.verifyProofVerdicts(entries, publishedDefinition.blindSigningPublicKey ?? null);
      const evaluation = evaluateQuestionnaireBlindAdmissions({
        entries,
        proofVerdicts: verdicts,
      });
      return {
        decisions: evaluation.decisions,
        acceptedEventIds: evaluation.decisions.filter((entry) => entry.accepted).map((entry) => entry.event.id),
        rejected: evaluation.decisions
          .filter((entry) => !entry.accepted)
          .map((entry) => ({ eventId: entry.event.id, reason: entry.rejectionReason })),
      };
    },

    async publishDecision(input) {
      const result = await publishQuestionnaireSubmissionDecisionPublic({
        coordinatorNsec: coordinator.nsec,
        questionnaireId: config.questionnaireId,
        submissionId: input.session.published?.responseId ?? `${config.questionnaireId}:response:${input.session.voter.seedByte}`,
        tokenNullifier: input.session.credential.nullifier,
        accepted: input.accepted,
        reason: (input.reason ?? (input.accepted ? "ok" : "invalid_token_proof")) as Parameters<typeof publishQuestionnaireSubmissionDecisionPublic>[0]["reason"],
        coordinatorNpub: coordinator.npub,
        decidedAt: config.clock.nowSeconds(),
        relays: relays(),
      });
      return { eventId: result.eventId };
    },

    async readObserverOutput() {
      const definitionEntries = await fetchQuestionnaireDefinitions({
        questionnaireId: config.questionnaireId,
        relays: relays(),
        ...HARNESS_QUERY_OPTIONS,
      });
      const stateEntries = await fetchQuestionnaireState({
        questionnaireId: config.questionnaireId,
        relays: relays(),
        ...HARNESS_QUERY_OPTIONS,
      });
      const ballots = await fetchQuestionnaireBlindResponses({
        questionnaireId: config.questionnaireId,
        relays: relays(),
        ...HARNESS_QUERY_OPTIONS,
      });
      const provisional = await config.relay.eventsOfKind(QUESTIONNAIRE_RESPONSE_PROVISIONAL_KIND);
      const resultEntries = await fetchQuestionnaireResultSummary({
        questionnaireId: config.questionnaireId,
        relays: relays(),
        ...HARNESS_QUERY_OPTIONS,
      });
      const latestResult = [...resultEntries].sort((left, right) => (
        Number(left.event.created_at ?? 0) - Number(right.event.created_at ?? 0)
      )).at(-1);
      return {
        definition: selectLatestQuestionnaireDefinition(definitionEntries.map((entry) => entry.event)),
        state: selectLatestQuestionnaireState(stateEntries.map((entry) => entry.event))?.state ?? null,
        ballots: ballots
          .map((entry) => ({
            eventId: entry.event.id,
            responseId: entry.response.responseId,
            submittedAt: entry.response.submittedAt,
          }))
          .sort((left, right) => left.eventId.localeCompare(right.eventId)),
        provisionalCount: provisional.filter((event) => event.kind === QUESTIONNAIRE_RESPONSE_PROVISIONAL_KIND).length,
        resultSummary: latestResult?.summary ?? null,
      };
    },

    async publishResultSummary() {
      const entries = await fetchQuestionnaireBlindResponses({
        questionnaireId: config.questionnaireId,
        relays: relays(),
        ...HARNESS_QUERY_OPTIONS,
      });
      const acceptedPayloads = entries.map((entry) => ({
        eventId: entry.event.id,
        authorPubkey: entry.response.authorPubkey,
        envelope: {
          schemaVersion: 1 as const,
          eventType: "questionnaire_response_private" as const,
          questionnaireId: config.questionnaireId,
          responseId: entry.response.responseId,
          createdAt: entry.response.submittedAt,
          authorPubkey: entry.response.authorPubkey,
          ciphertextScheme: "nip44v2" as const,
          ciphertextRecipient: coordinator.npub,
          ciphertext: "",
          payloadHash: "",
        },
        payload: {
          schemaVersion: 1 as const,
          kind: "questionnaire_response_payload" as const,
          questionnaireId: config.questionnaireId,
          responseId: entry.response.responseId,
          submittedAt: entry.response.submittedAt,
          answers: entry.response.answers ?? [],
        },
      }));
      const summary = buildQuestionnaireResultSummary({
        definition,
        coordinatorPubkey: coordinator.npub,
        acceptedResponses: acceptedPayloads,
        rejectedResponses: [],
      });
      const published = await publishQuestionnaireResultSummary({
        coordinatorNsec: coordinator.nsec,
        resultSummary: summary,
        relays: relays(),
      });
      assertAllRelayPublishesSucceeded("publishResultSummary", published);
      return { eventId: published.eventId, resultHash: summary.resultHash ?? "", summary };
    },

    async tallyRows() {
      const output = await driver.readObserverOutput();
      const summary = output.resultSummary as { questionSummaries?: Array<{ questionId: string }> } | null;
      const rows: TallyRow[] = (summary?.questionSummaries ?? []).map((entry) => ({
        questionId: entry.questionId,
        summary: JSON.stringify(entry),
      }));
      return rows.sort((left, right) => left.questionId.localeCompare(right.questionId));
    },

    relaySnapshot() {
      return config.relay.snapshot();
    },

    async observation() {
      const admissions = await driver.readAdmissions();
      const output = await driver.readObserverOutput();
      const snapshot = config.relay.snapshot();
      const summary = output.resultSummary as { resultHash?: string } | null;
      return {
        definitionEventIds: snapshot.events
          .filter((event) => event.kind === QUESTIONNAIRE_DEFINITION_KIND)
          .map((event) => event.id)
          .sort(),
        ballotEventIds: voterSessions
          .map((session) => session.published?.eventId ?? "")
          .filter(Boolean)
          .sort(),
        ballotSignatures: voterSessions
          .map((session) => session.published?.event.sig ?? "")
          .filter(Boolean)
          .sort(),
        admissions: admissions.decisions
          .map((decision) => ({
            eventId: decision.event.id,
            accepted: decision.accepted,
            rejectionReason: decision.rejectionReason,
          }))
          .sort((left, right) => left.eventId.localeCompare(right.eventId)),
        nullifiers: voterSessions.map((session) => session.credential.nullifier).sort(),
        receiptKinds: snapshot.receipts.map((receipt) => receipt.kind),
        tallyRows: await driver.tallyRows(),
        resultHash: summary?.resultHash ?? null,
        resultSummaryEventId: snapshot.receipts.find((receipt) => receipt.kind === QUESTIONNAIRE_RESULT_SUMMARY_KIND)?.id ?? null,
        observerState: output.state,
        provisionalCount: output.provisionalCount,
      };
    },
  };

  return driver;
}
