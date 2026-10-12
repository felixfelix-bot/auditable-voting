import React from "react";
import { createRoot } from "react-dom/client";
import PaperBallotPrint from "../src/PaperBallotPrint";
import { generatePaperBallot } from "../src/paperBallot";
import { makeTestVoterIdentity } from "../src/testFixtures";
import type { QuestionnaireDefinition } from "../src/questionnaireProtocol";

/**
 * Mounts PaperBallotPrint with a real, runtime-generated voter key so the
 * review harness exercises the same code path a future batch portal will use.
 * See ballot-print-harness.html for why this exists.
 */
const { nsec } = makeTestVoterIdentity();

const definition: QuestionnaireDefinition = {
  schemaVersion: 1,
  eventType: "questionnaire_definition",
  responseMode: "single",
  questionnaireId: "review-harness-2024",
  title: "Community Garden Budget",
  createdAt: Date.now(),
  openAt: 0,
  closeAt: Number.MAX_SAFE_INTEGER,
  coordinatorPubkey: "0".repeat(64),
  coordinatorEncryptionPubkey: "0".repeat(64),
  responseVisibility: "public",
  eligibilityMode: "open",
  allowMultipleResponsesPerPubkey: false,
  questions: [
    {
      questionId: "q1",
      prompt: "Which option should we fund first?",
      required: true,
      type: "multiple_choice",
      options: [
        { optionId: "o1", label: "Raised beds" },
        { optionId: "o2", label: "Tool library" },
      ],
    },
    {
      questionId: "q2",
      prompt: "Any additional comments?",
      required: false,
      type: "free_text",
    },
  ],
};

const ballot = generatePaperBallot({
  definition,
  voterNsec: nsec,
  inviteCode: "GARDEN-7F3A",
  serialNumber: "SN-0042",
});

const root = document.getElementById("harness-root");
if (!root) {
  throw new Error("harness root missing");
}
createRoot(root).render(React.createElement(PaperBallotPrint, { ballot }));
