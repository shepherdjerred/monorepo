import { WebError } from "@shepherdjerred/streambot/web/server/errors.ts";
import type { WebSession } from "@shepherdjerred/streambot/web/server/session-store.ts";
import type {
  RoomChange,
  RoomChangeHub,
} from "@shepherdjerred/streambot/session/room-change-hub.ts";
import type { WebRoom } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  webSseClosedTotal,
  webSseConnectionSeconds,
  webSseConnections,
  webSseDroppedTotal,
  webSseEventsTotal,
  type WebSseCloseReason,
  type WebSseEvent,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { buildRoom, type RoomOwner } from "./room-snapshot.ts";

const log = logger.child("web");

/**
 * Connection keepalive, not scheduled work: Bun closes a response idle for 40 seconds
 * (`start.ts`) and the public path crosses a Cloudflare tunnel, so every open stream writes a
 * comment this often. It is created with the connection and cleared when the connection ends.
 */
export const HEARTBEAT_MS = 20_000;
/** How long an `EventSource` waits before reconnecting; the reply is a fresh full snapshot. */
const RETRY_MS = 3000;
export const MAX_STREAMS_PER_SESSION = 4;
export const MAX_STREAMS_TOTAL = 200;

type TerminalCode =
  "unauthorized" | "guild_denied" | "feature_disabled" | "unavailable";

/** The closed `error` event code and metric reason for a failed re-check or build. */
function terminalFor(error: unknown): {
  code: TerminalCode;
  reason: WebSseCloseReason;
} {
  if (error instanceof WebError) {
    if (error.status === 401)
      return { code: "unauthorized", reason: "unauthorized" };
    if (error.code === "feature_disabled")
      return { code: "feature_disabled", reason: "unauthorized" };
    if (error.status === 403)
      return { code: "guild_denied", reason: "unauthorized" };
  }
  return { code: "unavailable", reason: "error" };
}

type ConnectionContext = {
  readonly hub: Pick<RoomChangeHub, "subscribe">;
  readonly viewer: { userId: string; guildIds: ReadonlySet<string> };
  readonly build: () => Promise<WebRoom>;
  /** Throws when the web session is no longer valid. */
  readonly validate: () => void;
  readonly signal: AbortSignal;
  readonly release: (connection: RoomConnection) => void;
};

const encoder = new TextEncoder();

/**
 * One open `/api/room/events` response. State is a single "latest snapshot" slot: a change marks
 * the connection dirty, one in-flight build produces the newest room, and a frame the client has
 * not read yet is replaced rather than queued, so memory per connection is bounded by one frame.
 */
class RoomConnection {
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private closed = false;
  private building = false;
  private dirty = false;
  private pending: Uint8Array | null = null;
  private pendingEvent: WebSseEvent = "room";
  private eventId = 0;
  private sent = 0;
  private dropped = 0;
  private roomKey: string | null = null;
  private readonly startedAt = performance.now();
  private readonly unsubscribe: () => void;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly onAbort = () => {
    this.close("client_closed");
  };
  readonly body: ReadableStream<Uint8Array>;

  constructor(
    private readonly context: ConnectionContext,
    initial: WebRoom,
  ) {
    webSseConnections.inc();
    this.track(initial);
    this.unsubscribe = context.hub.subscribe((change) => {
      this.onChange(change);
    });
    this.heartbeat = setInterval(() => {
      this.beat();
    }, HEARTBEAT_MS);
    // Never keep the process alive for a keepalive.
    if (typeof this.heartbeat === "object") this.heartbeat.unref();
    context.signal.addEventListener("abort", this.onAbort, { once: true });
    this.body = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.controller = controller;
          this.write(
            encoder.encode(
              "retry: " + String(RETRY_MS) + "\n" + this.frame(initial),
            ),
            "room",
          );
        },
        pull: () => {
          this.flush();
        },
        cancel: () => {
          this.close("client_closed");
        },
      },
      new CountQueuingStrategy({ highWaterMark: 1 }),
    );
    log.info("web room stream opened");
  }

  /** Close for a reason; `terminal` is sent as the last `error` event first. */
  close(reason: WebSseCloseReason, terminal?: TerminalCode): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.unsubscribe();
    this.context.signal.removeEventListener("abort", this.onAbort);
    const seconds = (performance.now() - this.startedAt) / 1000;
    webSseConnections.dec();
    webSseConnectionSeconds.observe(seconds);
    webSseClosedTotal.inc({ reason });
    if (terminal !== undefined) {
      this.pending = null;
      this.write(
        encoder.encode(
          "event: error\ndata: " + JSON.stringify({ code: terminal }) + "\n\n",
        ),
        "error",
        true,
      );
    }
    try {
      this.controller?.close();
    } catch {
      // The reader already cancelled the stream; there is nothing left to close.
    }
    this.pending = null;
    log.info("web room stream closed", {
      reason,
      duration_seconds: Math.round(seconds),
      events_sent: this.sent,
      events_dropped: this.dropped,
    });
    this.context.release(this);
  }

  private frame(room: WebRoom): string {
    this.eventId += 1;
    return (
      "event: room\nid: " +
      String(this.eventId) +
      "\ndata: " +
      JSON.stringify(room) +
      "\n\n"
    );
  }

  /** Remember which room the viewer is in so unrelated playback changes are ignored. */
  private track(room: WebRoom): void {
    this.roomKey =
      room.location === null
        ? null
        : room.location.guild.id + ":" + room.location.channel.id;
  }

  /** Apply changes that arrived while the first snapshot was being built. */
  catchUp(changes: readonly RoomChange[]): void {
    for (const change of changes) this.onChange(change);
  }

  private onChange(change: RoomChange): void {
    if (this.closed || !this.context.viewer.guildIds.has(change.guildId))
      return;
    const relevant =
      change.userId === null
        ? this.roomKey === change.guildId + ":" + (change.channelId ?? "")
        : change.userId === this.context.viewer.userId;
    if (!relevant) return;
    this.dirty = true;
    if (this.building) return;
    this.building = true;
    // A burst of synchronous notifications collapses into one build.
    queueMicrotask(() => {
      void this.refresh();
    });
  }

  /** A method, not the field, so the check after an `await` is not narrowed away. */
  private hasClosed(): boolean {
    return this.closed;
  }

  private async refresh(): Promise<void> {
    try {
      while (this.dirty && !this.closed) {
        this.dirty = false;
        const room = await this.context.build();
        if (this.hasClosed()) return;
        this.track(room);
        this.write(encoder.encode(this.frame(room)), "room");
      }
    } catch (error) {
      const terminal = terminalFor(error);
      this.close(terminal.reason, terminal.code);
    } finally {
      this.building = false;
    }
  }

  private beat(): void {
    if (this.closed) return;
    try {
      this.context.validate();
    } catch (error) {
      const terminal = terminalFor(error);
      this.close(terminal.reason, terminal.code);
      return;
    }
    // A client that has not read its last frame gets no comments either.
    if (this.pending === null && (this.controller?.desiredSize ?? 0) > 0)
      this.write(encoder.encode(": heartbeat\n\n"), "heartbeat");
  }

  /**
   * Write now when the client has room for it, otherwise hold the newest frame for `pull`. Holding
   * a second frame replaces the first and counts it as dropped.
   */
  private write(frame: Uint8Array, event: WebSseEvent, force = false): void {
    if (!force && this.closed) return;
    if (
      force ||
      (this.pending === null && (this.controller?.desiredSize ?? 0) > 0)
    ) {
      this.enqueue(frame, event);
      return;
    }
    if (event === "heartbeat") return;
    if (this.pending !== null) {
      this.dropped += 1;
      webSseDroppedTotal.inc();
    }
    this.pending = frame;
    this.pendingEvent = event;
  }

  private flush(): void {
    if (this.pending === null || this.closed) return;
    const frame = this.pending;
    this.pending = null;
    this.enqueue(frame, this.pendingEvent);
  }

  private enqueue(frame: Uint8Array, event: WebSseEvent): void {
    try {
      this.controller?.enqueue(frame);
    } catch {
      // The response can no longer be written, so the client is gone: give its slot back now
      // rather than when the abort signal or `cancel()` catches up. A no-op while closing.
      this.close("client_closed");
      return;
    }
    this.sent += 1;
    webSseEventsTotal.inc({ event });
  }
}

/** Every open room stream of this process, with the per-session and global caps. */
export class RoomStreams {
  private readonly connections = new Map<string, Set<RoomConnection>>();
  private readonly reserved = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly deps: {
      hub: Pick<RoomChangeHub, "subscribe">;
      owner: RoomOwner;
      perSession?: number;
      global?: number;
    },
  ) {}

  /** Open streams, including ones still building their first snapshot. */
  get size(): number {
    return this.total;
  }

  private reserve(key: string): void {
    if (this.total >= (this.deps.global ?? MAX_STREAMS_TOTAL)) {
      webSseClosedTotal.inc({ reason: "limit" });
      throw new WebError(
        429,
        "room_stream_capacity",
        "The remote is busy. Try again shortly.",
      );
    }
    const count = this.reserved.get(key) ?? 0;
    if (count >= (this.deps.perSession ?? MAX_STREAMS_PER_SESSION)) {
      webSseClosedTotal.inc({ reason: "limit" });
      throw new WebError(
        429,
        "room_stream_limit",
        "Too many open Streambot tabs. Close one and try again.",
      );
    }
    this.reserved.set(key, count + 1);
    this.total += 1;
  }

  private unreserve(key: string): void {
    const count = (this.reserved.get(key) ?? 1) - 1;
    if (count <= 0) this.reserved.delete(key);
    else this.reserved.set(key, count);
    this.total -= 1;
  }

  /**
   * Authorize, build the first snapshot, then stream. Failures before the first snapshot are
   * ordinary HTTP errors (an `EventSource` cannot read them, and does not retry them); failures
   * after it end the stream with an `error` event.
   */
  async open(input: {
    request: Request;
    session: WebSession;
    reauthenticate: () => WebSession;
    guildHint: string | null;
  }): Promise<Response> {
    const { session } = input;
    const key = session.key;
    this.reserve(key);
    // Listen before sampling state: the first build awaits, and a change that lands during it
    // would otherwise be lost, leaving the stream stale until some unrelated change. The changes
    // are held until the first snapshot says which room the viewer is in, then replayed.
    const missed: RoomChange[] = [];
    const unwatch = this.deps.hub.subscribe((change) => {
      missed.push(change);
    });
    let initial: WebRoom;
    try {
      initial = await buildRoom(this.deps.owner, session, input.guildHint);
    } catch (error) {
      unwatch();
      this.unreserve(key);
      if (error instanceof WebError && error.status < 500)
        webSseClosedTotal.inc({ reason: "unauthorized" });
      throw error;
    }
    if (input.request.signal.aborted) {
      unwatch();
      this.unreserve(key);
      throw input.request.signal.reason;
    }
    const connection = new RoomConnection(
      {
        hub: this.deps.hub,
        viewer: {
          userId: session.identity.userId,
          guildIds: new Set(session.identity.guildIds),
        },
        build: async () =>
          await buildRoom(
            this.deps.owner,
            input.reauthenticate(),
            input.guildHint,
          ),
        validate: () => {
          input.reauthenticate();
        },
        signal: input.request.signal,
        release: (done) => {
          this.connections.get(key)?.delete(done);
          if (this.connections.get(key)?.size === 0)
            this.connections.delete(key);
          this.unreserve(key);
        },
      },
      initial,
    );
    // The connection's own subscription is live from here on, so the watcher is redundant.
    unwatch();
    connection.catchUp(missed);
    const set = this.connections.get(key) ?? new Set<RoomConnection>();
    set.add(connection);
    this.connections.set(key, set);
    return new Response(connection.body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        // Tell any buffering reverse proxy to pass frames through as they are written.
        "x-accel-buffering": "no",
      },
    });
  }

  /** A signed-out session ends its streams at once. */
  closeSession(key: string): void {
    for (const connection of this.connections.get(key) ?? [])
      connection.close("unauthorized", "unauthorized");
  }

  /** Server shutdown: end every stream; clients reconnect to whichever process comes next. */
  closeAll(): void {
    for (const set of this.connections.values())
      for (const connection of set) connection.close("server_shutdown");
  }
}
