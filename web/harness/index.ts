/**
 * Deterministic E2E harness — single documented entry point.
 *
 * ## What this is
 *
 * One call boots a complete, hermetic voting stack for a smoke test:
 *
 * ```ts
 * import { bootHarness } from "./harness";
 *
 * const harness = await bootHarness();
 * // harness.relay.url      -> ws://127.0.0.1:7799   (no public relays)
 * // harness.clock          -> injected, controllable time
 * // harness.driver         -> seed coordinator / mint credential / vote / observe
 * harness.clock.advance(301);          // move time; no sleep()
 * await harness.dispose();             // stop the relay, restore the clock
 * ```
 *
 * There is no wall-clock waiting anywhere: `clock.advance()` fires every timer
 * that falls due, so windowed-releaset work runs immediately.
 *
 * ## Guarantees
 *
 * - **No public relays.** The relay is a local in-process server on 127.0.0.1 and
 *   the pool is pinned to refuse every other URL. The browser side is pointed at
 *   it with `VITE_AV_HARNESS_RELAYS` (see `viteConfigForHarness()`).
 * - **Fixed identities.** Coordinator and voters are derived from fixed seed
 *   bytes (see `roundDriver.SEED_BYTES`), so pubkeys and signatures are stable
 *   across runs, machines and CI.
 * - **Fixed ordering.** Relay replay is `(created_at, event id)`; ballots are
 *   published in voter order; tallies are sorted by question id.
 * - **Seeded randomness.** No `Math.random()` / key generation on the harness
 *   path uses the system RNG except the blind-signing keypair, which is created
 *   once per round and published in the definition, so it is part of the
 *   observed artefact rather than a hidden input.
 *
 * ## Playwright
 *
 * ```ts
 * // playwright.config.ts
 * import { viteConfigForHarness } from "./harness";
 *
 * export default defineConfig({ use: { baseURL: "http://127.0.0.1:5173" } });
 * // The dev server must be started with VITE_AV_HARNESS_RELAYS pointing at the
 * // relay — use `harnessDevServerCommand()` or the `harness:e2e` npm script.
 * ```
 *
 * A browser page cannot run this module's Node-side relay, so a Playwright spec
 * boots the relay + driver here and, for UI assertions, uses
 * `harnessPageInitScript()` to point the page at the same relay and inject the
 * same clock.
 */
import { RelayServer, startRelay, type RelayServerOptions } from "./relayServer";
import { createFakeClock, PAGE_CLOCK_INIT_SCRIPT, type FakeClock } from "./timeControl";
import { createRoundDriver, type RoundDriver, type RoundDriverConfig } from "./roundDriver";
import { pinHarnessRelay, resetHarnessPool } from "./poolBridge";
import {
  installDeterministicCrypto,
  restoreDeterministicCrypto,
  type CryptoMode,
} from "./cryptoControl";

/** Default local relay port used by the harness. */
export const HARNESS_RELAY_DEFAULT_PORT = 7799;
/** Default web origin the harness dev server listens on. */
export const HARNESS_WEB_ORIGIN = "http://127.0.0.1:5173";
/** Default questionnaire id for harness rounds. */
export const HARNESS_QUESTIONNAIRE_ID = "harness_round_1";

export type HarnessOptions = {
  /** Fixed virtual start time, unix seconds. Default 1_750_000_000. */
  startTimeSeconds?: number;
  /** Relay port. Default 7799; pass 0 for an OS-assigned free port. */
  relayPort?: number;
  /** Questionnaire id for the round. Default `harness_round_1`. */
  questionnaireId?: string;
  /** Round length in seconds. Default 300. */
  roundLengthSeconds?: number;
  /** Windowed-publication grace in seconds. Default 60. */
  graceSeconds?: number;
  /** 0 = minimal yes/no, immediate publication; 1 = mixed, windowed. Default 1. */
  answerTypeMix?: RoundDriverConfig["answerTypeMix"];
  /** Inject a fixed blind-signing keypair for byte-for-byte reproducibility. */
  blindKeyPair?: RoundDriverConfig["blindKeyPair"];
  /** Extra relay server options (host, signature verification). */
  relayOptions?: Omit<RelayServerOptions, "port" | "now">;
  /**
   * Patch `setTimeout`/`setInterval` as well as `Date`, so `clock.advance()`
   * fires scheduled work. Off by default (see `ClockInstallOptions`).
   */
  fakeTimers?: boolean;
  /**
   * `crypto.getRandomValues` policy. `"fixed"` (default) makes rounds
   * byte-for-byte reproducible by seeding the blinding factor. `"random"` uses
   * the real CSPRNG — use it when the test is about unlinkability, since a frozen
   * blinding factor would mask a real privacy bug.
   */
  cryptoMode?: CryptoMode;
  /** Seed for `cryptoMode: "fixed"`. */
  cryptoSeed?: string;
};

export type Harness = {
  /** The local relay. `relay.url` is what the app is configured with. */
  relay: RelayServer;
  /** Injected clock. Move time with `clock.advance()`; never sleep. */
  clock: FakeClock;
  /** Round driver: coordinator, credentials, ballots, results. */
  driver: RoundDriver;
  /** Relay URLs the app must be pointed at. */
  relayUrls: string[];
  /** Value to export as `VITE_AV_HARNESS_RELAYS` for the dev server / build. */
  relayEnv: string;
  /** Seed + open a coordinator round. */
  seedCoordinator: RoundDriver["seedCoordinator"];
  /** Stop the relay, tear down the pool and restore the real clock. */
  dispose: () => Promise<void>;
};

const DEFAULT_START_SECONDS = 1_750_000_000;

/**
 * Boot the whole stack in one call.
 *
 * Side effects, all undone by `dispose()`: installs the fake clock, starts the
 * local relay, installs the Node WebSocket implementation and pins the client
 * pool to the relay.
 */
export async function bootHarness(options: HarnessOptions = {}): Promise<Harness> {
  const startTimeSeconds = options.startTimeSeconds ?? DEFAULT_START_SECONDS;
  const questionnaireId = options.questionnaireId ?? HARNESS_QUESTIONNAIRE_ID;

  installDeterministicCrypto({ mode: options.cryptoMode ?? "fixed", seed: options.cryptoSeed });

  const clock = createFakeClock(startTimeSeconds);
  // Date-only by default: the client's transport relies on `setTimeout` for its
  // publish/query deadlines, so freezing timers would deadlock it. Tests whose
  // subject is the scheduling itself call `clock.install({ timers: true })`.
  clock.install({ timers: options.fakeTimers === true });

  const relay = await startRelay({
    ...options.relayOptions,
    port: options.relayPort ?? HARNESS_RELAY_DEFAULT_PORT,
    now: () => clock.nowSeconds(),
  });

  const relayUrls = [relay.url];
  pinHarnessRelay(relayUrls);

  const driver = createRoundDriver({
    relay,
    clock,
    questionnaireId,
    roundLengthSeconds: options.roundLengthSeconds,
    graceSeconds: options.graceSeconds,
    answerTypeMix: options.answerTypeMix,
    blindKeyPair: options.blindKeyPair,
  });

  return {
    relay,
    clock,
    driver,
    relayUrls,
    relayEnv: relayUrls.join(","),
    seedCoordinator: () => driver.seedCoordinator(),
    async dispose() {
      resetHarnessPool();
      await relay.stop();
      clock.restore();
      restoreDeterministicCrypto();
    },
  };
}

/**
 * `VITE_AV_HARNESS_RELAYS` value for a given relay URL, for shelling out to the
 * dev server or a build. Kept as a helper so the env-var name lives in one place.
 */
export function harnessRelayEnvValue(relayUrl: string): string {
  return `VITE_AV_HARNESS_RELAYS=${relayUrl}`;
}

/**
 * Command line for a harness-pinned dev server.
 *
 * ```bash
 * eval "$(node -e '...')"   # or just copy the printed command
 * ```
 */
export function harnessDevServerCommand(relayUrl: string, port = 5173): string {
  return `VITE_AV_HARNESS_RELAYS=${relayUrl} npx vite --host 127.0.0.1 --port ${port}`;
}

/** Extra npm script-friendly args for `vite`, harness-pinned. */
export function viteConfigForHarness(relayUrl: string): { env: Record<string, string> } {
  return { env: { VITE_AV_HARNESS_RELAYS: relayUrl } };
}

/**
 * Init script(s) for `page.addInitScript()`. Installs the injected clock in the
 * page and exposes the relay URL for the app / spec to read.
 */
export function harnessPageInitScript(relayUrl: string): string {
  return `${PAGE_CLOCK_INIT_SCRIPT}\nwindow.__AV_HARNESS_RELAY__ = ${JSON.stringify(relayUrl)};`;
}

export { RelayServer, startRelay };
export { createFakeClock, PAGE_CLOCK_INIT_SCRIPT };
export { createRoundDriver };
export type { RelayServerOptions, FakeClock, RoundDriver, RoundDriverConfig };
export * from "./fixtures";
export { HARNESS_BLIND_KEY_ID, HARNESS_BLIND_KEY_PAIR, HARNESS_BLIND_KEY_SCHEME } from "./blindKeyPair";
export { installDeterministicCrypto, restoreDeterministicCrypto, deterministicCryptoInstalled } from "./cryptoControl";
export type { CryptoMode } from "./cryptoControl";
export type { HarnessFailure, RoundResult, VoterFixture, VoterSession, TallyRow } from "./roundDriver";
