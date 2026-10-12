// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import PaperBallotPrint from "./PaperBallotPrint";
import { maskNsec, type PaperBallot } from "./paperBallot";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,MOCKQR") },
}));

// Realistic test fixture: the nsec is a REAL credential for the voter it names.
const VOTER_NSEC = "nsec1abcdefghijklmnopqrstuv01234567890123456789012345678901234wxyz9";
const VOTER_NPUB = "npub1fakefakefakefakefakefakefakefakefakefakefakefakefakefakefakef";

function baseBallot(): PaperBallot {
  return {
    questionnaireId: "q-demo-01",
    questionnaireTitle: "Community Garden Budget",
    questions: [
      {
        questionId: "q1",
        prompt: "Approve the budget?",
        type: "yes_no",
        required: true,
      },
    ],
    voterNsec: VOTER_NSEC,
    voterNpub: VOTER_NPUB,
    generatedAt: 1_000_000_000_000,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PaperBallotPrint", () => {
  it("renders the questionnaire title and ID", () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    expect(screen.getByText("Community Garden Budget")).toBeTruthy();
    expect(screen.getByText(/Ballot ID: q-demo-01/)).toBeTruthy();
  });

  it("displays all question prompts", () => {
    const ballot = baseBallot();
    ballot.questions = [
      ...ballot.questions,
      { questionId: "q2", prompt: "Any comments?", type: "free_text", required: false },
    ];
    render(<PaperBallotPrint ballot={ballot} />);
    expect(screen.getByText(/1\. Approve the budget\?/)).toBeTruthy();
    expect(screen.getByText(/2\. Any comments\?/)).toBeTruthy();
  });

  it("renders a yes/no question with Yes/No checkboxes", () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    expect(screen.getAllByText("Yes")).toBeTruthy();
    expect(screen.getAllByText("No")).toBeTruthy();
  });

  it("renders a free_text question with blank lines", () => {
    const ballot = baseBallot();
    ballot.questions = [{ questionId: "q2", prompt: "Any comments?", type: "free_text", required: false }];
    render(<PaperBallotPrint ballot={ballot} />);
    expect(document.querySelectorAll(".ballot-blank-line").length).toBe(4);
  });

  it("renders a multiple_choice question with checkboxes for each option", () => {
    const ballot = baseBallot();
    ballot.questions = [{
      questionId: "q3",
      prompt: "Pick one",
      type: "multiple_choice",
      required: true,
      options: [
        { optionId: "a", label: "Option A" },
        { optionId: "b", label: "Option B" },
      ],
    }];
    render(<PaperBallotPrint ballot={ballot} />);
    expect(screen.getByText("Option A")).toBeTruthy();
    expect(screen.getByText("Option B")).toBeTruthy();
  });

  // ── F3-1: the nsec must be masked on screen ─────────────────────────────
  it("masks the nsec on screen: shows first 8 and last 4 chars only", () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    // The raw key must NOT be present anywhere in the rendered output
    expect(document.body.textContent).not.toContain(VOTER_NSEC);
    // The masked form (derived from the same function the component uses)
    expect(screen.getByText(maskNsec(VOTER_NSEC))).toBeTruthy();
  });

  it("exposes the full nsec only via the reveal control, not the initial DOM", () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    expect(document.body.textContent).not.toContain(VOTER_NSEC);
    // Clicking "Reveal" must expose the full key (the print flow's source of truth)
    fireEvent.click(screen.getByText("Reveal"));
    expect(document.body.textContent).toContain(VOTER_NSEC);
  });

  it("displays the voter npub as monospace text", () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    expect(screen.getByText(VOTER_NPUB)).toBeTruthy();
  });

  it("renders a QR code image for the npub", async () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    await waitFor(() => {
      expect(document.querySelector("img.ballot-qr-image")).toBeTruthy();
    });
  });

  // ── F3-2: ballot serial ────────────────────────────────────────────────
  it("displays the ballot serial number when present", () => {
    const ballot = { ...baseBallot(), serialNumber: "AV-000042" };
    render(<PaperBallotPrint ballot={ballot} />);
    expect(screen.getByText(/Serial: AV-000042/)).toBeTruthy();
  });

  it("omits the serial row when the ballot has no serial", () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    expect(screen.queryByText(/Serial:/)).toBeNull();
  });

  it("displays the invite code", () => {
    const ballot = { ...baseBallot(), inviteCode: "INVITE-9A7B" };
    render(<PaperBallotPrint ballot={ballot} />);
    expect(screen.getByText("INVITE-9A7B")).toBeTruthy();
  });

  it("displays relay URLs", () => {
    render(<PaperBallotPrint ballot={baseBallot()} />);
    expect(screen.getAllByText(/wss:\/\//).length).toBeGreaterThan(0);
  });
});