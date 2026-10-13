/**
 * Bridge between the harness (Node) and the client's Nostr transport layer.
 *
 * The harness must not re-implement transport logic, so this module is the ONLY
 * place that reaches into the client's pool internals to:
 *
 * 1. give `nostr-tools` a WebSocket implementation in Node (browsers have a
 *    global `WebSocket`; Node 20 does not);
 * 2. force the client's shared pool to drop public relays and use ONLY the
 *    harness relay — defence in depth against any call path that appends the
 *    default relay list, which would otherwise leak to a public relay;
 * 3. re-export a couple of client functions whose behaviour belongs to the app
 *    (blind-proof verification, result-summary parsing) so specs import one
 *    module instead of several `src/` modules.
 *
 * Everything else the harness needs is a first-class `src/` export.
 */
import { useWebSocketImplementation } from "nostr-tools/pool";
import { WebSocket as NodeWebSocket } from "ws";
import { getSharedNostrPool, resetSharedNostrPoolForTests } from "../src/sharedNostrPool";
import {
  getQuestionnaireReadRelays,
  queryQuestionnaireEvents,
} from "../src/questionnaireNostr";
import {
  verifyQuestionnaireBlindResponseProofVerdicts,
  type QuestionnaireBlindProofVerdict,
} from "../src/questionnaireTransport";
import { parseQuestionnaireResultSummaryEvent } from "../src/questionnaireRuntime";
import { clearRuntimeHarnessRelays, isHarnessRelayUrl, setRuntimeHarnessRelays } from "../src/nostrRelayConfig";
import type { Filter, NostrEvent } from "nostr-tools";
import type { QuestionnaireResultSummary } from "../src/questionnaireProtocol";

let socketConfigured = false;
const pinnedRelays = new Set<string>();

/**
 * Install the Node WebSocket implementation and pin the client pool to the
 * harness relay(s). Idempotent; safe to call before every scenario.
 */
export function pinHarnessRelay(relayUrls: string[]): void {
  if (!socketConfigured) {
    useWebSocketImplementation(NodeWebSocket as unknown as typeof WebSocket);
    socketConfigured = true;
  }
  pinnedRelays.clear();
  for (const url of relayUrls) {
    pinnedRelays.add(url);
  }
  // Register at runtime too: the relay port is only known after it has bound.
  setRuntimeHarnessRelays(relayUrls);
  const pool = getSharedNostrPool();
  // Any relay that is not the harness relay is refused outright, so a public
  // relay can never be contacted on the harness path even if a call site
  // merges the default list.
  pool.allowConnectingToRelay = (relay: string) => isHarnessRelayUrl(relay, [...pinnedRelays]);
}

/** Tear the pool down between scenarios so no sockets or backoff state persist. */
export function resetHarnessPool(): void {
  resetSharedNostrPoolForTests();
  clearRuntimeHarnessRelays();
  socketConfigured = false;
  pinnedRelays.clear();
}

/**
 * Direct relay query through the client's own query helper (uses the shared
 * pool, the public-query limiter and the questionnaire read-relay selector).
 */
export function queryHarnessRelay(filters: Filter[], relays: string[] = [...pinnedRelays]): Promise<NostrEvent[]> {
  const readRelays = getQuestionnaireReadRelays(relays);
  return queryQuestionnaireEvents(readRelays, filters[0] ?? {}, { timeoutMs: 2_000 });
}

export type SharedNostrPoolHelpers = {
  /** Verify the blind-token proofs on a set of ballot events. */
  verifyProofVerdicts: (
    entries: Array<{ event: NostrEvent; response: Parameters<typeof verifyQuestionnaireBlindResponseProofVerdicts>[0]["entries"][number]["response"] }>,
    publicKey: Parameters<typeof verifyQuestionnaireBlindResponseProofVerdicts>[0]["publicKey"],
  ) => Promise<Map<string, QuestionnaireBlindProofVerdict>>;
  /** Parse a published result summary event. */
  parseResultSummary: (event: NostrEvent) => QuestionnaireResultSummary | null;
};

/** Client functions the harness re-uses rather than re-implements. */
export function fetchSharedNostrPoolHelpers(): SharedNostrPoolHelpers {
  return {
    verifyProofVerdicts: (entries, publicKey) =>
      verifyQuestionnaireBlindResponseProofVerdicts({ entries, publicKey }),
    parseResultSummary: (event) => parseQuestionnaireResultSummaryEvent(event),
  };
}
