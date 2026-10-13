/**
 * Deterministic local Nostr relay for the E2E harness.
 *
 * A minimal, single-process, NIP-01-shaped relay used *instead of* public
 * relays. It is deliberately boring:
 *
 * - no authentication, no rate limiting, no backoff, no reconnection;
 * - in-memory storage only, so every run starts from a known empty state;
 * - deterministic replay order (created_at, then event id);
 * - exact-once semantics: an event id is stored once, duplicate publishes are
 *   acknowledged but not duplicated (mirrors relay de-duplication);
 * - no wall-clock dependency of its own — it never rewrites `created_at`.
 *   The harness injects time on the *client* side (see `timeControl.ts`); the
 *   relay records a monotonic receipt sequence for ordering assertions.
 *
 * Speaks enough NIP-01 for this client:
 *
 *   -> ["EVENT", <signed event>]        <- ["OK", <id>, true|false, <message>]
 *   -> ["REQ", <subId>, <filter>...]    <- ["EVENT", <subId>, <event>]... ["EOSE", <subId>]
 *   -> ["CLOSE", <subId>]               (no reply, per NIP-01)
 *
 * The same HTTP server exposes read-only debug endpoints so fixture helpers and
 * Playwright specs can inspect relay state without a websocket client:
 *
 *   GET /healthz   -> {"ok":true,"events":<n>,"url":"ws://..."}
 *   GET /events    -> [{seq,receivedAt,event}, ...]
 *   GET /receipts  -> [{seq,id,kind,created_at,pubkey,tags,receivedAt}, ...]
 */
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { matchFilters, verifyEvent, type Filter, type NostrEvent } from "nostr-tools";

export type RelayStoredEvent = {
  /** Monotonic receipt index assigned by this relay, starting at 1. */
  seq: number;
  /** Relay-local receipt time in unix seconds, from the relay's clock. */
  receivedAt: number;
  event: NostrEvent;
};

export type RelayReceipt = {
  seq: number;
  id: string;
  kind: number;
  created_at: number;
  pubkey: string;
  tags: string[][];
  receivedAt: number;
};

export type RelayEventInput = NostrEvent;

export type RelayServerOptions = {
  /** Fixed host. Defaults to 127.0.0.1 — never binds a public interface. */
  host?: string;
  /**
   * TCP port. Defaults to 7799 (the default used by the harness entry point).
   * Pass 0 to let the OS pick a free port; the resolved URL is still reported.
   */
  port?: number;
  /**
   * Wall-clock provider used ONLY for the `receivedAt` receipt stamp. Event
   * `created_at` is always whatever the publishing client signed. Inject the
   * harness clock here to make receipts deterministic too.
   */
  now?: () => number;
  /**
   * When true (default), reject events whose signature does not verify and
   * whose id does not match the canonical event id. The harness publishes
   * genuinely signed events, so this stays on and keeps the fixture honest.
   */
  verifySignatures?: boolean;
};

type Subscription = {
  id: string;
  filters: Filter[];
};

const DEFAULT_PORT = 7799;
const DEFAULT_HOST = "127.0.0.1";

function normaliseEvent(raw: unknown): NostrEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<NostrEvent>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.pubkey !== "string"
    || typeof candidate.kind !== "number"
    || typeof candidate.created_at !== "number"
    || typeof candidate.content !== "string"
    || typeof candidate.sig !== "string"
    || !Array.isArray(candidate.tags)
  ) {
    return null;
  }
  return candidate as NostrEvent;
}

export class RelayServer {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly now: () => number;
  private readonly verifySignatures: boolean;

  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number | null = null;

  private readonly stored: RelayStoredEvent[] = [];
  private readonly byId = new Map<string, RelayStoredEvent>();
  private readonly sockets = new Set<WebSocket>();
  private readonly subscriptions = new Map<WebSocket, Map<string, Subscription>>();
  private nextSeq = 1;

  constructor(options: RelayServerOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.requestedPort = options.port ?? DEFAULT_PORT;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.verifySignatures = options.verifySignatures ?? true;
  }

  /** Resolved websocket URL. Only valid after `start()`. */
  get url(): string {
    if (this.port === null) {
      throw new Error("Relay has not been started yet.");
    }
    return `ws://${this.host}:${this.port}`;
  }

  /** Resolved port. Only valid after `start()`. */
  get boundPort(): number {
    if (this.port === null) {
      throw new Error("Relay has not been started yet.");
    }
    return this.port;
  }

  get running(): boolean {
    return this.httpServer !== null;
  }

  async start(): Promise<RelayServer> {
    if (this.httpServer) {
      return this;
    }
    const httpServer = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0];
      const send = (status: number, body: unknown) => {
        const payload = JSON.stringify(body);
        response.writeHead(status, {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "cache-control": "no-store",
        });
        response.end(payload);
      };
      if (path === "/healthz") {
        send(200, { ok: true, events: this.stored.length, url: this.port === null ? null : this.url });
        return;
      }
      if (path === "/events") {
        send(200, this.stored);
        return;
      }
      if (path === "/receipts") {
        send(200, this.receipts());
        return;
      }
      send(404, { ok: false, error: "not_found" });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      httpServer.once("error", onError);
      httpServer.listen(this.requestedPort, this.host, () => {
        httpServer.removeListener("error", onError);
        resolve();
      });
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      throw new Error("Relay failed to bind a TCP port.");
    }
    this.port = address.port;
    this.httpServer = httpServer;

    const wss = new WebSocketServer({ server: httpServer, path: undefined });
    this.wss = wss;
    wss.on("connection", (socket) => this.handleConnection(socket));
    return this;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
    this.sockets.clear();
    this.subscriptions.clear();

    const wss = this.wss;
    this.wss = null;
    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }

    const httpServer = this.httpServer;
    this.httpServer = null;
    this.port = null;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  /** Number of stored events. */
  size(): number {
    return this.stored.length;
  }

  /** All stored events, in deterministic replay order (created_at, then id). */
  events(): NostrEvent[] {
    return this.sortedStored().map((entry) => entry.event);
  }

  /** Events of one or more kinds, in deterministic replay order. */
  eventsOfKind(...kinds: number[]): NostrEvent[] {
    const wanted = new Set(kinds);
    return this.events().filter((event) => wanted.has(event.kind));
  }

  /** Receipt log — monotonic witness of arrival order. */
  receipts(): RelayReceipt[] {
    return [...this.stored]
      .sort((left, right) => left.seq - right.seq)
      .map((entry) => ({
        seq: entry.seq,
        id: entry.event.id,
        kind: entry.event.kind,
        created_at: entry.event.created_at,
        pubkey: entry.event.pubkey,
        tags: entry.event.tags,
        receivedAt: entry.receivedAt,
      }));
  }

  /** Full snapshot, for assertion dumps and evidence artefacts. */
  snapshot() {
    return {
      url: this.url,
      count: this.stored.length,
      events: this.events(),
      receipts: this.receipts(),
    };
  }

  /**
   * Store an event as if it arrived over the socket. Used by fixture seeding and
   * by tests that assert relay semantics without a websocket. Returns the same
   * `[stored, message]` shape the socket handler reports in an OK frame.
   */
  publish(event: RelayEventInput): { stored: boolean; message: string } {
    const result = this.store(event);
    if (result.stored) {
      this.broadcast(event);
    }
    return result;
  }

  private sortedStored(): RelayStoredEvent[] {
    return [...this.stored].sort((left, right) => {
      const byTime = left.event.created_at - right.event.created_at;
      if (byTime !== 0) {
        return byTime;
      }
      return left.event.id.localeCompare(right.event.id);
    });
  }

  private store(event: RelayEventInput): { stored: boolean; message: string } {
    if (this.verifySignatures && !verifyEvent(event)) {
      return { stored: false, message: "invalid: signature or event id verification failed" };
    }
    if (this.byId.has(event.id)) {
      return { stored: false, message: "duplicate: already have this event" };
    }
    const entry: RelayStoredEvent = { seq: this.nextSeq, receivedAt: this.now(), event };
    this.nextSeq += 1;
    this.stored.push(entry);
    this.byId.set(event.id, entry);
    return { stored: true, message: "" };
  }

  private broadcast(event: NostrEvent) {
    for (const socket of this.sockets) {
      const subs = this.subscriptions.get(socket);
      if (!subs) {
        continue;
      }
      for (const subscription of subs.values()) {
        if (matchFilters(subscription.filters, event)) {
          this.send(socket, ["EVENT", subscription.id, event]);
        }
      }
    }
  }

  private send(socket: WebSocket, frame: unknown) {
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // Socket died mid-send; the close handler cleans up.
    }
  }

  private handleConnection(socket: WebSocket) {
    this.sockets.add(socket);
    this.subscriptions.set(socket, new Map());

    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        this.send(socket, ["NOTICE", "invalid: could not parse message as JSON"]);
        return;
      }
      if (!Array.isArray(parsed) || typeof parsed[0] !== "string") {
        this.send(socket, ["NOTICE", "invalid: expected a NIP-01 message array"]);
        return;
      }
      const [verb, ...rest] = parsed as [string, ...unknown[]];
      if (verb === "EVENT") {
        const event = normaliseEvent(rest[0]);
        if (!event) {
          this.send(socket, ["NOTICE", "invalid: malformed event"]);
          return;
        }
        const { stored, message } = this.store(event);
        this.send(socket, ["OK", event.id, stored || this.byId.has(event.id), message]);
        if (stored) {
          this.broadcast(event);
        }
        return;
      }

      if (verb === "REQ") {
        const subId = typeof rest[0] === "string" ? rest[0] : null;
        if (!subId) {
          this.send(socket, ["NOTICE", "invalid: REQ requires a subscription id"]);
          return;
        }
        const filters = rest.slice(1).filter((entry): entry is Filter => Boolean(entry) && typeof entry === "object");
        const subs = this.subscriptions.get(socket);
        subs?.set(subId, { id: subId, filters });
        for (const entry of this.sortedStored()) {
          if (matchFilters(filters, entry.event)) {
            this.send(socket, ["EVENT", subId, entry.event]);
          }
        }
        this.send(socket, ["EOSE", subId]);
        return;
      }

      if (verb === "CLOSE") {
        const subId = typeof rest[0] === "string" ? rest[0] : null;
        if (subId) {
          this.subscriptions.get(socket)?.delete(subId);
        }
      }
    });

    socket.on("close", () => {
      this.sockets.delete(socket);
      this.subscriptions.delete(socket);
    });
    socket.on("error", () => {
      this.sockets.delete(socket);
      this.subscriptions.delete(socket);
    });
  }
}

/** Convenience factory: create, start and return a running relay. */
export async function startRelay(options: RelayServerOptions = {}): Promise<RelayServer> {
  const relay = new RelayServer(options);
  await relay.start();
  return relay;
}
