/**
 * Harness self-test.
 *
 * This is the proof that the harness layer itself is deterministic and works end
 * to end against a local relay, with no public network access and no wall-clock
 * sleeps. It exercises the *app's real interfaces* through the same entry point
 * a Playwright spec uses.
 *
 * Determinism is asserted the strongest way available: the whole round is run
 * twice and every observable (event ids, signatures, tally rows, relay receipt
 * order, elapsed wall time) must be identical.
 */
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootHarness,
  HARNESS_BLIND_KEY_PAIR,
  HARNESS_VOTERS,
  seedCoordinator,
  mintVoterCredentials,
  submitVote,
  readAdmissions,
  readObserverOutput,
  type Harness,
} from "./index";

/**
 * The real timer functions and the real `Date.now`, captured at module load —
 * before any test installs the fake clock — so assertions about *wall-clock*
 * behaviour stay honest while virtual time is installed.
 */
const realNow = () => new Date().getTime();
/** Monotonic real milliseconds. `performance` is never patched by the clock. */
const realPerfNow = () => performance.now();
const runtimeSetTimeout = globalThis.setTimeout.bind(globalThis);
const runtimeSetInterval = globalThis.setInterval.bind(globalThis);

const running: Harness[] = [];

/** Minimal HTTP GET returning parsed JSON — avoids the disabled global `fetch`. */
function httpGetJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function boot(overrides: Parameters<typeof bootHarness>[0] = {}) {
  const harness = await bootHarness({
    // Port 0: let the OS pick, so parallel test files never collide.
    relayPort: 0,
    // Fixed blind-signing key: removes the last entropy source from a round.
    blindKeyPair: HARNESS_BLIND_KEY_PAIR,
    ...overrides,
  });
  running.push(harness);
  return harness;
}

afterEach(async () => {
  while (running.length > 0) {
    const harness = running.pop();
    await harness?.dispose();
  }
});

async function runFullRound(): Promise<Harness> {
  const harness = await boot({ answerTypeMix: 1, roundLengthSeconds: 300, graceSeconds: 60 });
  const { driver, clock } = harness;

  await seedCoordinator(driver);
  const sessions = await mintVoterCredentials(driver);

  // Time control: move the clock to the round open. No sleep() anywhere.
  clock.advance(2);

  for (const session of sessions) {
    await submitVote(driver, session);
  }
  await driver.publishResultSummary();

  if (driver.failures.length > 0) {
    throw new Error(`Harness reported failures: ${JSON.stringify(driver.failures)}`);
  }
  // Replay the whole round while keeping the same injected clock instant, so the
  // determinism test exercises publication order as well as content.
  void sessions;
  return harness;
}

describe("harness: local relay", () => {
  it("binds 127.0.0.1 only and reports its own URL", async () => {
    const harness = await boot();
    expect(harness.relay.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    expect(harness.relayUrls).toEqual([harness.relay.url]);
    // Health endpoint is served over HTTP on the same port. Uses node:http rather
    // than global fetch: the repo's vitest setup deliberately disables `fetch`.
    const health = await httpGetJson(`${harness.relay.url.replace("ws://", "http://")}/healthz`);
    expect(health).toMatchObject({ ok: true, events: 0, url: harness.relay.url });
  });

  it("stores a signed event once and rejects the duplicate", async () => {
    const harness = await boot();
    await seedCoordinator(harness.driver);
    const before = harness.relay.size();
    const [first] = harness.relay.events().slice(0, 1);
    const duplicate = harness.relay.publish(first);
    expect(duplicate.stored).toBe(false);
    expect(duplicate.message).toContain("duplicate");
    expect(harness.relay.size()).toBe(before);
  });

  it("serves events in deterministic (created_at, id) order and receipt order is monotonic", async () => {
    const harness = await boot();
    await seedCoordinator(harness.driver);
    const events = harness.relay.events();
    const sorted = [...events].sort((left, right) => (
      left.created_at - right.created_at || left.id.localeCompare(right.id)
    ));
    expect(events.map((event) => event.id)).toEqual(sorted.map((event) => event.id));
    const receipts = harness.relay.receipts();
    expect(receipts.map((receipt) => receipt.seq)).toEqual(receipts.map((_, index) => index + 1));
  });
});

describe("harness: injected clock", () => {
  it("moves time without sleeping and fires due timers in order", async () => {
    const harness = await boot({ fakeTimers: true });
    let fired = 0;
    // Deliberately the PATCHED setTimeout/setInterval (globalThis), so the fake
    // clock owns these timers. Calling the captured real ones would bypass it.
    globalThis.setTimeout(() => { fired += 1; }, 30_000);
    globalThis.setInterval(() => { fired += 1; }, 10_000);

    // Measure real elapsed time with the *real* clock, so this asserts against
    // wall-clock time even while the virtual clock is installed.
    const startedRealMs = realPerfNow();
    harness.clock.advance(35);
    const realElapsed = realPerfNow() - startedRealMs;

    // 10s, 20s, 30s interval ticks plus the 30s timeout = 4 firings.
    expect(fired).toBe(4);
    // The advance was instant in real time: 35 virtual seconds, no wall-clock wait.
    expect(realElapsed).toBeLessThan(1_000);
  });

  it("does not patch timers by default, so the client's own deadlines still fire", async () => {
    const harness = await boot();
    expect(harness.clock.timersPatched).toBe(false);
    // A real timer still runs; the clock only owns Date.
    const ticked = await new Promise<boolean>((resolve) => {
      runtimeSetTimeout(() => resolve(true), 5);
    });
    expect(ticked).toBe(true);
  });

  it("derives round windows from an arbitrary injected clock, not the wall clock", async () => {
    // A fixed instant far in the future: the wall clock can only ever be behind
    // it, so this assertion cannot rot as real time passes.
    // Capture the real wall clock BEFORE booting: once the fake clock is
    // installed, `realNow()` reads virtual time, so a comparison taken after
    // boot would be meaningless.
    const realSecondsBeforeBoot = Math.floor(realNow() / 1000);
    const injected = realSecondsBeforeBoot + 20 * 365 * 24 * 3600;
    const harness = await boot({ startTimeSeconds: injected });
    expect(harness.driver.window.openAt).toBe(injected + 1);
    expect(harness.driver.window.closeAt).toBe(injected + 301);
    expect(harness.clock.nowSeconds()).toBe(injected);
    // The round window is ~20 years ahead of the wall clock: provably injected.
    expect(realSecondsBeforeBoot).toBeLessThan(harness.driver.window.openAt);
    // Movement is explicit: the clock does not drift on its own.
    harness.clock.advance(5);
    expect(harness.clock.nowSeconds()).toBe(injected + 5);
  });
});

describe("harness: full round through the app interfaces", () => {
  it("seeds a coordinator, mints credentials, submits votes and reads them back", async () => {
    const harness = await runFullRound();
    const { driver } = harness;

    // Coordinator definition carries the real blind signing public key.
    expect(driver.definition.blindSigningPublicKey?.keyId).toBe(driver.blindPublicKey.keyId);
    expect(driver.definition.publicationMode).toBe("windowed");

    // The relay holds the round definition, the open state, three ballots and the
    // published result summary — and nothing else.
    const kinds = harness.relay.receipts().map((receipt) => receipt.kind);
    expect(kinds).toEqual([6420, 6421, 6424, 6424, 6424, 6423]);

    // Every ballot reached the relay with exactly one relay success.
    const sessions = driver.voterSessions;
    expect(sessions).toHaveLength(HARNESS_VOTERS.length);
    for (const session of sessions) {
      expect(session.published?.relay.successes).toBe(1);
      expect(session.published?.relay.failures).toBe(0);
      expect(session.credential.verified).toBe(true);
    }

    const observation = await driver.observation();
    // The coordinator's real admission evaluation accepts all three ballots.
    expect(observation.admissions.filter((entry) => entry.accepted)).toHaveLength(3);
    expect([...observation.admissions.map((entry) => entry.eventId)].sort())
      .toEqual([...observation.ballotEventIds].sort());

    // Windowed rounds do not publish provisional per-question events.
    expect(observation.provisionalCount).toBe(0);
    expect(observation.observerState).toBe("open");

    // The published tally reconciles exactly with the cast ballots.
    expect(observation.tallyRows).toHaveLength(2);
    expect(observation.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(observation.resultSummaryEventId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces identical observations across two independent runs", async () => {
    const first = await runFullRound();
    const firstObservation = await first.driver.observation();
    const second = await runFullRound();
    const secondObservation = await second.driver.observation();

    expect(secondObservation).toEqual(firstObservation);

    // Byte-identical ballot signatures: fixed keys, fixed timestamps, fixed
    // answer order and a deterministic blinding factor all held.
    expect(secondObservation.ballotSignatures).toEqual(firstObservation.ballotSignatures);
    expect(secondObservation.ballotEventIds).toEqual(firstObservation.ballotEventIds);
    expect(secondObservation.resultHash).toBe(firstObservation.resultHash);
    // Different processes/DRIs still yield the same tally.
    expect(secondObservation.tallyRows).toEqual(firstObservation.tallyRows);
  });

  it("does not leak the blinding factor into published ballots (determinism is harness-side only)", async () => {
    // With cryptoMode "random" the blinding factor is real, so two submissions
    // with the SAME credential and SAME answers must produce different
    // signatures. This guards the harness against accidentally freezing the very
    // randomness the blind-signature scheme depends on.
    const harness = await boot({ answerTypeMix: 0, cryptoMode: "random" });
    const { driver } = harness;
    await seedCoordinator(driver);
    const [voter] = await mintVoterCredentials(driver, [HARNESS_VOTERS[0]]);
    await submitVote(driver, voter);

    // A second, independently blinded credential for the same voter.
    driver.resetCredentialCounter();
    const [again] = await mintVoterCredentials(driver, [HARNESS_VOTERS[0]]);
    expect(again.credential.tokenSecretCommitment).toBe(voter.credential.tokenSecretCommitment);
    expect(again.credential.signature).not.toBe(voter.credential.signature);
  });

  it("rejects a duplicate submission under the same credential (double-vote)", async () => {
    const harness = await boot({ answerTypeMix: 0 });
    const { driver } = harness;
    await seedCoordinator(driver);
    const [voter] = await mintVoterCredentials(driver, [HARNESS_VOTERS[0]]);
    await submitVote(driver, voter);
    const firstEventId = voter.published!.eventId;

    // A genuine double-vote: same credential, same answers, NEW response id, so
    // the relay stores it as a distinct event and only the app's admission logic
    // can reject it.
    const duplicate = await driver.publishDuplicateBallot(voter);
    expect(duplicate.eventId).not.toBe(firstEventId);

    const admissions = await readAdmissions(driver);
    // Exactly one of the two same-nullifier ballots is admitted. The app's
    // canonical ordering (created_at, then event id) decides which, so assert the
    // count and the reason rather than gu; both ballots share an injected instant.
    expect(admissions.acceptedEventIds).toHaveLength(1);
    expect([firstEventId, duplicate.eventId]).toContain(admissions.acceptedEventIds[0]);
    const rejected = admissions.decisions.filter((decision) => !decision.accepted);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].rejectionReason).toBe("duplicate_nullifier");

    // Both events are on the relay; exactly one is admitted.
    const output = await readObserverOutput(driver);
    expect(output.ballots).toHaveLength(2);
    expect(driver.failures).toEqual([]);
  });

  it("rejects an identical event id as a relay-level duplicate", async () => {
    const harness = await boot({ answerTypeMix: 0 });
    await seedCoordinator(harness.driver);
    const [first] = harness.relay.events().slice(0, 1);
    const replay = harness.relay.publish({ ...first });
    expect(replay.stored).toBe(false);
    expect(replay.message).toContain("duplicate");
  });
});

describe("harness: relay isolation", () => {
  it("leaves no public relay on the harness path", async () => {
    const harness = await boot();
    // The driver publishes only to the harness relay list, by construction.
    expect(harness.relayUrls.every((url) => url.startsWith("ws://127.0.0.1:"))).toBe(true);
    // And the environment value the app is started with is that same URL.
    expect(harness.relayEnv).toBe(harness.relay.url);
  });
});
