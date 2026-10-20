import { useRef, useState } from "react";
import type { QuestionnaireDefinition } from "./questionnaireProtocol";
import PaperBallotPrint from "./PaperBallotPrint";
import { generatePaperBallot } from "./paperBallot";
import type { QuestionnaireOptionACoordinatorRuntime } from "./questionnaireOptionARuntime";
import { createPaperBallotAdmissionSheet, normalisePaperBallotMasterlistNumber, paperBallotExpiryToIsoUtc, type PrintablePaperBallotAdmission } from "./paperBallotAdmission";
import { UiButton, UiTextArea } from "./ui/DesignLayer";

export default function PaperBallotCoordinatorPanel(props: {
  electionId: string;
  definition: QuestionnaireDefinition | null;
  runtime: QuestionnaireOptionACoordinatorRuntime | null;
  onAdmissionsChanged?: () => void;
}) {
  const [masterlistNumbers, setMasterlistNumbers] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [sheet, setSheet] = useState<PrintablePaperBallotAdmission[]>([]);
  const [status, setStatus] = useState("");
  const generating = useRef(false);

  async function generate() {
    if (generating.current) return;
    if (!props.runtime || !props.definition || props.definition.questionnaireId !== props.electionId) {
      setStatus("Open the questionnaire before generating paper ballots.");
      return;
    }
    const expiry = paperBallotExpiryToIsoUtc(expiresAt);
    const expiryMs = Date.parse(expiry);
    if (Number.isFinite(expiryMs) && expiryMs <= Date.now()) {
      setStatus("Code expiry must be in the future.");
      return;
    }
    const numbers = masterlistNumbers.split(/[\n,]+/).map(normalisePaperBallotMasterlistNumber).filter(Boolean);
    if (numbers.length && numbers.every((number) => sheet.some((entry) => entry.masterlistNumber === number))) {
      setStatus("Codes already generated for these numbers in this print batch. Print the existing ballots.");
      return;
    }
    generating.current = true;
    try {
      const next = await createPaperBallotAdmissionSheet({
        electionId: props.electionId,
        masterlistNumbers: numbers.filter((number) => !sheet.some((entry) => entry.masterlistNumber === number)),
        expiresAt: expiry,
      });
      if (!next.length) {
        setStatus("Enter one or more master-list numbers and a valid future expiry time.");
        return;
      }
      next.forEach((entry) => props.runtime?.addPaperBallotAdmission(entry.admission));
      props.onAdmissionsChanged?.();
      setSheet([...sheet, ...next]);
      setStatus(`${next.length} paper ballot code${next.length === 1 ? "" : "s"} saved. Print this page now; codes are not retained here after reload.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not generate paper ballot codes.");
    } finally {
      generating.current = false;
    }
  }

  return <section className='simple-settings-card' aria-label='Paper ballot access'>
    <h3 className='simple-voter-question'>Paper ballot access</h3>
    <p className='simple-voter-note'>Generate one code for each master-list record. The organiser stores only an opaque admission key; print the codes before leaving this page.</p>
    <p className='simple-voter-note'>Duplicate numbers are detected only in this open print batch. After reload, new codes cannot replace or revoke earlier codes for the same number. Earlier codes remain usable until redeemed, expired or explicitly revoked by admission key. Do not generate another batch for the same roster.</p>
    <UiTextArea
      label='Master-list numbers'
      textAreaClassName='simple-voter-input'
      textAreaProps={{ value: masterlistNumbers, rows: 3, placeholder: "ML-001\nML-002", onChange: (event) => setMasterlistNumbers(event.target.value) }}
    />
    <label className='simple-voter-field'>
      <span>Code expiry</span>
      <input className='simple-voter-input' type='datetime-local' value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
    </label>
    <div className='simple-voter-action-row simple-voter-action-row-inline'>
      <UiButton icon='key' className='simple-voter-secondary' onPress={() => void generate()} isDisabled={!props.electionId}>Generate printable codes</UiButton>
      {sheet.length ? <UiButton icon='export' className='simple-voter-secondary' onPress={() => window.print()}>Print ballot instructions</UiButton> : null}
    </div>
    {status ? <p className='simple-voter-note' role='status'>{status}</p> : null}
    {sheet.length ? <div className='simple-paper-ballot-sheet' aria-label='Printable paper ballot instructions'>
      {props.definition ? sheet.map((entry) => <PaperBallotPrint key={entry.admission.registryKey} ballot={generatePaperBallot({ definition: props.definition!, masterlistNumber: entry.masterlistNumber, code: entry.code, expiresAt: entry.admission.expiresAt })} />) : null}
    </div> : null}
  </section>;
}
