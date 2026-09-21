/**
 * Deterministic, in-process Nostr relay for Playwright E2E.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app is Nostr-first (browser-local, no server): a coordinator publishes a
 * questionnaire to relays, voters read it back, and blind-credential / ballot
 * traffic flows as NIP-59 gift-wrapped DMs over the same relay connections.
 * Against the default public relays that makes an E2E run non-deterministic:
 * round-trips race, relays rate-limit or go offline, and assertions flake.
 *
 * This module serves a REAL NIP-01 relay (store + live subscription fan-out)
 * inside the Playwright worker and wires it to every WebSocket the page opens,
 * using `context.routeWebSocket()`. That is deliberate:
 *
 *   - The app's actual Nostr stack runs unmodified. `SafeWebSocket` still
 *     extends the (Playwright-patched) `WebSocket`, `sharedNostrPool` still uses
 *     `nostr-tools` SimplePool, and every REQ / EVENT / EOSE / OK / COUNT frame
 *     is parsed and produced by the real code paths. Nothing is stubbed in the
 *     page, so the harness cannot drift from production behaviour.
 *   - ZERO network egress. Because the handler never calls `connectToServer()`,
 *     the socket is fully mocked and no packet leaves the box. Tests assert
 *     this (see `EgressGuard`).
 *   - Determinism. The store is seeded empty and mutated only by what the test's
 *     own pages publish, EOSE is emitted immediately, and the store is shared
 *     across every context of the test, so two browser contexts (coordinator +
 *     voter) exchange events through it like clients of one relay.
 *
 * The relay is intentionally a pure store-and-forward: it never fabricates or
 * rewrites events. nostr-tools re-verifies every event signature client-side
 * (`verifyEvent`) before delivering it to a subscription, so synthetic events
 * would be silently dropped — only genuinely signed events published by the app
 * under test ever flow through here.
 */
import type { Browser, BrowserContext, WebSocketRoute } from "@playwright/test";

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

/** A NIP-01 filter. `#<tag>` keys carry tag values; the rest are plain fields. */
export type NostrFilter = {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: unknown;
};

/** Hosts that are allowed to keep talking to the real network (the dev server). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"]);

export function isLocalUrl(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname);
}

function tagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags.filter((tag) => tag[0] === tagName).map((tag) => tag[1] ?? "");
}

/** NIP-01 filter match. Mirrors (and never exceeds) nostr-tools matchFilters. */
export function matchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (typeof filter.since === "number" && event.created_at < filter.since) return false;
  if (typeof filter.until === "number" && event.created_at > filter.until) return false;
  for (const [key, raw] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const wanted = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    const present = tagValues(event, key.slice(1));
    if (!present.some((value) => wanted.includes(value))) return false;
  }
  return true;
}

class RelaySubscription {
  constructor(
    readonly id: string,
    readonly filters: NostrFilter[],
  ) {}

  matches(event: NostrEvent): boolean {
    return this.filters.some((filter) => matchesFilter(event, filter));
  }
}

type SocketState = {
  route: WebSocketRoute;
  subs: Map<string, RelaySubscription>;
};

/**
 * An in-memory NIP-01 relay.
 *
 * The same instance is wired to every WebSocket in the test (across contexts),
 * which is what lets a coordinator page and a voter page exchange events.
 */
export class MockNostrRelay {
  private readonly events = new Map<string, NostrEvent>();
  private readonly sockets = new Set<SocketState>();
  /** Every WebSocket URL that was intercepted (i.e. never dialled for real). */
  readonly interceptedUrls: string[] = [];
  /** Every event a client published, in arrival order. */
  readonly received: NostrEvent[] = [];
  /** Inbound client frames, for debugging failing runs. */
  readonly inboundFrames: string[] = [];

  /** Attach a routed WebSocket to this relay (mocking it fully). */
  attach(route: WebSocketRoute): void {
    const state: SocketState = { route, subs: new Map() };
    this.sockets.add(state);
    this.interceptedUrls.push(route.url());

    route.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString("utf8");
      this.inboundFrames.push(raw);
      this.handleMessage(state, raw);
    });
    route.onClose(() => {
      this.sockets.delete(state);
    });
  }

  private handleMessage(state: SocketState, raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return; // Nostr is JSON-only; ignore anything else.
    }
    if (!Array.isArray(message) || message.length === 0) return;

    switch (message[0]) {
      case "EVENT":
        this.handlePublish(state, message[1] as NostrEvent);
        return;
      case "REQ":
        this.handleReq(state, String(message[1]), message.slice(2) as NostrFilter[]);
        return;
      case "CLOSE":
        state.subs.delete(String(message[1]));
        return;
      case "COUNT": {
        const count = this.query(message.slice(2) as NostrFilter[]).length;
        this.send(state, ["COUNT", String(message[1]), { count }]);
        return;
      }
      case "AUTH":
        return; // No challenge is ever issued, so no AUTH is expected.
      case "PING":
        this.send(state, ["PONG"]);
        return;
      default:
        return;
    }
  }

  private handlePublish(state: SocketState, event: NostrEvent): void {
    if (!event || typeof event.id !== "string") {
      this.send(state, ["OK", "", false, "invalid: malformed event"]);
      return;
    }
    const isNew = !this.events.has(event.id);
    if (isNew) {
      this.events.set(event.id, event);
      this.received.push(event);
      this.fanout(event);
    }
    this.send(state, ["OK", event.id, true, isNew ? "" : "duplicate: already have this event"]);
  }

  private handleReq(state: SocketState, subId: string, filters: NostrFilter[]): void {
    const sub = new RelaySubscription(subId, filters);
    state.subs.set(subId, sub);
    for (const event of this.query(filters)) {
      this.send(state, ["EVENT", subId, event]);
    }
    this.send(state, ["EOSE", subId]);
  }

  /** Live push of a newly stored event to every matching subscription. */
  private fanout(event: NostrEvent): void {
    for (const state of this.sockets) {
      for (const sub of state.subs.values()) {
        if (sub.matches(event)) this.send(state, ["EVENT", sub.id, event]);
      }
    }
  }

  /** NIP-01 query: newest-first, per-filter `limit` applied before union. */
  query(filters: NostrFilter[]): NostrEvent[] {
    const all = [...this.events.values()].sort((a, b) => b.created_at - a.created_at);
    const out = new Map<string, NostrEvent>();
    for (const filter of filters) {
      let list = all.filter((event) => matchesFilter(event, filter));
      if (typeof filter.limit === "number") list = list.slice(0, filter.limit);
      for (const event of list) out.set(event.id, event);
    }
    return [...out.values()].sort((a, b) => b.created_at - a.created_at);
  }

  private send(state: SocketState, payload: unknown[]): void {
    try {
      state.route.send(JSON.stringify(payload));
    } catch {
      // Socket already closed by the page; nothing to do.
    }
  }

  // -- test-facing helpers -------------------------------------------------

  /** All stored events of a given kind. */
  eventsOfKind(kind: number): NostrEvent[] {
    return [...this.events.values()].filter((event) => event.kind === kind);
  }

  /** Kinds published by the app, with counts — handy for progress logging. */
  kindHistogram(): Record<string, number> {
    const histogram: Record<string, number> = {};
    for (const event of this.received) {
      const key = String(event.kind);
      histogram[key] = (histogram[key] ?? 0) + 1;
    }
    return histogram;
  }

  get storedCount(): number {
    return this.events.size;
  }

  reset(): void {
    this.events.clear();
    this.received.length = 0;
    this.inboundFrames.length = 0;
    for (const state of this.sockets) state.subs.clear();
  }
}

/**
 * Proof that a run stayed hermetic: any request or WebSocket that would have
 * left the box is recorded here (and HTTP is hard-blocked). A green suite
 * asserts these stay empty.
 */
export type EgressGuard = {
  /** Non-local HTTP(S) URLs that the page attempted to fetch. */
  externalRequests: string[];
  /** Non-local WebSocket URLs that were NOT served by the mock relay. */
  externalWebSockets: string[];
};

export type DeterministicContext = {
  context: BrowserContext;
  relay: MockNostrRelay;
  egress: EgressGuard;
};

/**
 * Wire an existing context to the mock relay. Use this to build a multi-actor
 * test: several contexts (separate browser profiles → separate coordinator and
 * voter identities) can share ONE relay, which is what makes a coordinator page
 * and a voter page exchange events deterministically.
 */
export async function attachRelay(
  context: BrowserContext,
  relay: MockNostrRelay,
  egress: EgressGuard,
): Promise<void> {
  // 1. Serve every external WebSocket from memory. The dev server's own HMR
  //    socket (ws://localhost:<port>) is left alone so Vite keeps working.
  await context.routeWebSocket(
    (url) => !isLocalUrl(url),
    (route) => {
      relay.attach(route);
    },
  );

  // 2. Hard-block non-local HTTP and record the attempt. Fonts/scripts are all
  //    bundled locally, so nothing legitimate needs to leave the box.
  await context.route("**/*", (route) => {
    let url: URL;
    try {
      url = new URL(route.request().url());
    } catch {
      return route.continue();
    }
    if (isLocalUrl(url) || !/^https?:$/.test(url.protocol)) {
      return route.continue();
    }
    egress.externalRequests.push(url.toString());
    return route.abort();
  });

  // 3. Defence in depth: record any real (non-mocked) external socket. With the
  //    route above in place this must always stay empty.
  context.on("websocket", (socket) => {
    let url: URL;
    try {
      url = new URL(socket.url());
    } catch {
      return;
    }
    if (!isLocalUrl(url) && !relay.interceptedUrls.includes(socket.url())) {
      egress.externalWebSockets.push(socket.url());
    }
  });
}

/**
 * Create a browser context that can only reach the in-process mock relay and
 * the local dev server. Everything else is mocked (WebSockets) or blocked and
 * recorded (HTTP), so a passing test is evidence of zero public-relay and zero
 * public-network dependence.
 */
export async function createDeterministicContext(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<DeterministicContext> {
  const relay = new MockNostrRelay();
  const egress: EgressGuard = { externalRequests: [], externalWebSockets: [] };
  const context = await createAttachedContext(browser, options, relay, egress);
  return { context, relay, egress };
}

/** Create an additional context wired to an existing relay + egress guard. */
export async function createAttachedContext(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0],
  relay: MockNostrRelay,
  egress: EgressGuard,
): Promise<BrowserContext> {
  const context = await browser.newContext({ serviceWorkers: "block", ...options });
  await attachRelay(context, relay, egress);
  return context;
}

/** Poll the relay store until `predicate` holds, or throw on timeout. */
export async function waitForRelay(
  relay: MockNostrRelay,
  predicate: (relay: MockNostrRelay) => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(relay)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `waitForRelay timed out after ${timeoutMs}ms; published kinds: ${JSON.stringify(relay.kindHistogram())}`,
  );
}
