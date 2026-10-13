/**
 * Default public relay lists for the client.
 *
 * ## Harness override (deterministic E2E)
 *
 * When `VITE_AV_HARNESS_RELAYS` is set at build/dev-server start, it REPLACES
 * the default public relay list for every consumer of this module. Vite inlines
 * `import.meta.env` at transform time, so no runtime configuration, storage or
 * URL parameter is needed and no call site has to change.
 *
 * ```bash
 * VITE_AV_HARNESS_RELAYS=ws://127.0.0.1:7799 npx vite --port 5173
 * ```
 *
 * This is what keeps public relays off the deterministic harness path: with the
 * override set, `DEFAULT_NOSTR_PUBLIC_RELAYS` / `DEFAULT_NOSTR_DM_RELAYS` are the
 * local harness relay(s) and nothing else. When the variable is unset the lists
 * below are returned unchanged, so production behaviour is untouched.
 *
 * The override is deliberately additive: it can only ever *replace* the defaults,
 * never append public relays to them.
 */

const PUBLIC_RELAY_DEFAULTS = [
  "wss://vm-1734.lnvps.cloud/",
  "wss://relay.nostr.net",
  "wss://nos.lol",
  "wss://relay.nostr.info",
  "wss://relay.nos.social",
  "wss://nostr.mom",
  "wss://nostr.bitcoiner.social",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
];

const DM_RELAY_DEFAULTS = [
  "wss://vm-1734.lnvps.cloud/",
  "wss://relay.nostr.net",
  "wss://nos.lol",
];

const HARNESS_RELAY_ENV_KEY = "VITE_AV_HARNESS_RELAYS";

/**
 * Split a comma/whitespace/newline separated relay list, keeping only ws:/wss:
 * URLs with a hostname. Returns `[]` when nothing usable is configured.
 */
export function parseHarnessRelayOverride(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[\n,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) {
        return false;
      }
      try {
        const url = new URL(entry);
        return (url.protocol === "wss:" || url.protocol === "ws:") && Boolean(url.hostname);
      } catch {
        return false;
      }
    });
}

/**
 * Read the harness relay override from the Vite environment. Exported so tests
 * can assert the parsing rules without re-loading the module.
 */
export function harnessRelayOverride(env: Record<string, unknown> | undefined = readViteEnv()): string[] {
  return parseHarnessRelayOverride(env?.[HARNESS_RELAY_ENV_KEY]);
}

function readViteEnv(): Record<string, unknown> | undefined {
  try {
    return (import.meta as { env?: Record<string, unknown> }).env;
  } catch {
    return undefined;
  }
}

/** True when a deterministic harness relay is in force (env or runtime). */
export function harnessRelayOverrideActive(): boolean {
  return effectiveHarnessRelays().length > 0;
}

/**
 * True when `candidate` is one of the allowed harness relays.
 *
 * Compares normalised origins so `ws://127.0.0.1:7799`, `ws://127.0.0.1:7799/`
 * and `ws://127.0.0.1:7799/?x=1` all match. Used by the harness to refuse every
 * connection except to the local relay.
 */
export function isHarnessRelayUrl(candidate: unknown, allowed: string[]): boolean {
  const normalise = (value: unknown) => {
    try {
      const url = new URL(String(value));
      return `${url.protocol}//${url.host}`;
    } catch {
      return String(value ?? "").trim().replace(/\/+$/, "");
    }
  };
  const target = normalise(candidate);
  return allowed.some((entry) => normalise(entry) === target);
}

/**
 * Runtime harness-relay registry.
 *
 * `VITE_AV_HARNESS_RELAYS` covers the browser/dev-server case, where the relay
 * URL is known before the bundle is built. A Node-side harness (vitest, a
 * Playwright `globalSetup`) cannot use it: the relay binds an OS-assigned port
 * after the modules are already loaded. `setRuntimeHarnessRelays` covers that
 * case, and takes precedence over the env override when both are set.
 */
let runtimeHarnessRelays: string[] = [];

/** Register the harness relay(s) for the rest of this process. */
export function setRuntimeHarnessRelays(relays: string[]): void {
  runtimeHarnessRelays = relays.map((relay) => relay.trim()).filter(Boolean);
}

/** Forget any runtime-registered harness relay. */
export function clearRuntimeHarnessRelays(): void {
  runtimeHarnessRelays = [];
}

/** The harness relay(s) in force: runtime registration wins over the env var. */
export function effectiveHarnessRelays(): string[] {
  return runtimeHarnessRelays.length > 0 ? [...runtimeHarnessRelays] : harnessRelayOverride();
}

/**
 * Build the relay-selection function used by the client's publish/read paths.
 *
 * The application's normal behaviour is "merge any caller-supplied relays with
 * the configured defaults". The harness changes that to "use ONLY the harness
 * relay(s)": while a harness relay is registered, the local relay must be the
 * entire relay set, so no public relay is ever *targeted* (not merely refused)
 * and the relay list the app reports is honest about what it actually contacted.
 *
 * `normalise`/`wrap` are supplied by each call site so the merged list keeps that
 * module's own ranking/selection behaviour. Production semantics are unchanged
 * whenever no harness relay is registered.
 *
 * The registry is read at call time (not closure-creation time) so a harness can
 * register its relay after this module has been imported.
 */
export function makePublicRelayBuilder<T>(
  normalise: (...relaySets: Array<string[] | null | undefined>) => string[],
  wrap: (relays: string[]) => T,
): (relays?: string[]) => T {
  return (relays?: string[]) => {
    const harness = effectiveHarnessRelays();
    if (harness.length > 0) {
      return wrap(normalise(harness, relays));
    }
    return wrap(normalise(relays, PUBLIC_RELAY_DEFAULTS));
  };
}

const override = harnessRelayOverride();

export const DEFAULT_NOSTR_PUBLIC_RELAYS = override.length > 0 ? [...override] : [...PUBLIC_RELAY_DEFAULTS];

export const DEFAULT_NOSTR_DM_RELAYS = override.length > 0 ? [...override] : [...DM_RELAY_DEFAULTS];

export const NOSTR_PUBLIC_PUBLISH_MAX_WAIT_MS = 1500;
export const NOSTR_PUBLIC_SUBSCRIPTION_MAX_WAIT_MS = 1500;
export const NOSTR_PUBLIC_PUBLISH_STAGGER_MS = 300;
export const NOSTR_PUBLIC_MIN_PUBLISH_INTERVAL_MS = 500;
