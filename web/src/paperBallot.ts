import type { QuestionnaireDefinition } from "./questionnaireProtocol";
import { deriveNpubFromNsec } from "./nostrIdentity";

export type PaperBallotOption = {
  optionId: string;
  label: string;
};

export type PaperBallotQuestion = {
  questionId: string;
  prompt: string;
  type: string;
  required: boolean;
  options?: PaperBallotOption[];
};

export interface PaperBallot {
  questionnaireId: string;
  questionnaireTitle: string;
  questions: PaperBallotQuestion[];
  voterNsec: string;
  voterNpub: string;
  inviteCode?: string;
  generatedAt: number;
}

function formatQuestion(question: QuestionnaireDefinition["questions"][number]): PaperBallotQuestion {
  const base = {
    questionId: question.questionId,
    prompt: question.prompt,
    type: question.type,
    required: question.required,
  };

  if (question.type === "multiple_choice" || question.type === "rank") {
    return {
      ...base,
      options: question.options.map((opt) => ({
        optionId: opt.optionId,
        label: opt.label,
      })),
    };
  }

  return base;
}

export function generatePaperBallot(input: {
  definition: QuestionnaireDefinition;
  voterNsec: string;
  inviteCode?: string;
}): PaperBallot {
  const voterNpub = deriveNpubFromNsec(input.voterNsec);

  if (!voterNpub) {
    throw new Error("Invalid voter nsec: could not derive npub");
  }

  return {
    questionnaireId: input.definition.questionnaireId,
    questionnaireTitle: input.definition.title,
    questions: input.definition.questions.map(formatQuestion),
    voterNsec: input.voterNsec,
    voterNpub,
    inviteCode: input.inviteCode,
    generatedAt: Date.now(),
  };
}