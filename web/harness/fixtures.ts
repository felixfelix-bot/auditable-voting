/**
 * Fixture helpers for the deterministic E2E harness.
 *
 * These are thin, readable wrappers over `RoundDriver` so a smoke spec reads
 * like the scenario it is testing:
 *
 * ```ts
 * const harness = await bootHarness();
 * const coordinator = await seedCoordinator(harness.driver);
 * const [voter] = await mintVoterCredentials(harness.driver);
 * await submitVote(harness.driver, voter);
 * const observed = await readObserverOutput(harness.driver);
 * ```
 *
 * Every helper delegates to the application's real interfaces (see
 * `roundDriver.ts`); none of them re-implements protocol behaviour. The
 * functions here add no hidden waits and no randomness.
 */
import {
  SEED_BYTES,
  seededIdentity,
  type RoundDriver,
  type VoterFixture,
  type VoterSession,
} from "./roundDriver";

/** The three fixed voters every harness round starts with. */
export const HARNESS_VOTERS: readonly VoterFixture[] = [
  { ...seededIdentity(SEED_BYTES.voterA), otp: "240401", label: "voter-a" },
  { ...seededIdentity(SEED_BYTES.voterB), otp: "240402", label: "voter-b" },
  { ...seededIdentity(SEED_BYTES.voterC), otp: "240403", label: "voter-c" },
];

/** Seed the coordinator: publishes the round definition and opens the round. */
export function seedCoordinator(driver: RoundDriver) {
  return driver.seedCoordinator();
}

/** Mint a blind credential for one voter. */
export function mintVoterCredential(driver: RoundDriver, voter: VoterFixture) {
  return driver.mintCredential(voter);
}

/** Mint blind credentials for all fixed voters, in fixed order. */
export function mintVoterCredentials(driver: RoundDriver, voters: readonly VoterFixture[] = HARNESS_VOTERS) {
  return voters.reduce<Promise<VoterSession[]>>(
    (chain, voter) => chain.then(async (sessions) => [...sessions, await driver.mintCredential(voter)]),
    Promise.resolve([]),
  );
}

/** Publish a ballot (the harness equivalent of "submit a vote"). */
export function submitVote(driver: RoundDriver, session: VoterSession) {
  return driver.publishBallot(session);
}

/** Read the result and the raw observer output. */
export function readObserverOutput(driver: RoundDriver) {
  return driver.readObserverOutput();
}

/** Read the coordinator's admission decisions over the relay contents. */
export function readAdmissions(driver: RoundDriver) {
  return driver.readAdmissions();
}
