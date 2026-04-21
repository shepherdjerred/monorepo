import { z } from "zod";
import type { EntityState } from "#rest/schemas.ts";
import { EntityState as EntityStateSchema } from "#rest/schemas.ts";
import type { HomeAssistantConfig } from "#shared/config.ts";
import { normalizeBaseUrl } from "#shared/config.ts";
import {
  HaWebSocketAuthError,
  HaWebSocketClosedError,
  HaWebSocketError,
  HaWebSocketResultError,
} from "./errors.ts";
import type { EventMessage, ResultMessage } from "./messages.ts";
import { AuthMessage, ServerMessage } from "./messages.ts";
import type { EventHandler, Subscription } from "./subscriptions.ts";
import { SubscriptionRegistry } from "./subscriptions.ts";

/**
 * Minimal structural shape of the WebSocket API the client consumes. Narrow
 * enough that test doubles (see test/fake-websocket.ts) can satisfy it
 * without type assertions, but wide enough that the DOM `WebSocket` global
 * is structurally assignable.
 */
export type WebSocketLike = {
  readonly readyState: number;
  readonly OPEN: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (
    type: string,
    listener: (event: unknown) => void,
  ) => void;
};

export type WebSocketLikeCtor = new (url: string) => WebSocketLike;

export type HomeAssistantEventClientOptions = {
  reconnect?: boolean;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  pingIntervalMs?: number;
  webSocketImpl?: WebSocketLikeCtor;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type ConnectionState =
  | "idle"
  | "connecting"
  | "authenticated"
  | "closed"
  | "error";

export type ConnectionStateListener = (
  state: ConnectionState,
  detail?: unknown,
) => void;

const DEFAULTS = {
  initialReconnectDelayMs: 1000,
  maxReconnectDelayMs: 30_000,
  pingIntervalMs: 30_000,
} as const;

export class HomeAssistantEventClient {
  private readonly wsUrl: string;
  private readonly token: string;
  private readonly opts: Required<
    Omit<HomeAssistantEventClientOptions, "webSocketImpl">
  >;
  private readonly webSocketImpl: WebSocketLikeCtor;
  private readonly subscriptions = new SubscriptionRegistry();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stateListeners = new Set<ConnectionStateListener>();
  private socket: WebSocketLike | undefined;
  private nextId = 1;
  private closedByUser = false;
  private reconnectAttempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    config: HomeAssistantConfig,
    options: HomeAssistantEventClientOptions = {},
  ) {
    this.wsUrl = buildWsUrl(config.baseUrl);
    this.token = config.token;
    this.opts = {
      reconnect: options.reconnect ?? true,
      initialReconnectDelayMs:
        options.initialReconnectDelayMs ?? DEFAULTS.initialReconnectDelayMs,
      maxReconnectDelayMs:
        options.maxReconnectDelayMs ?? DEFAULTS.maxReconnectDelayMs,
      pingIntervalMs: options.pingIntervalMs ?? DEFAULTS.pingIntervalMs,
    };
    this.webSocketImpl = options.webSocketImpl ?? WebSocket;
  }

  public onConnectionChange(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public async connect(): Promise<void> {
    this.closedByUser = false;
    await this.openAndAuth();
    await this.resubscribeAll();
  }

  public async close(): Promise<void> {
    this.closedByUser = true;
    this.stopPingTimer();
    this.failAllPending(new HaWebSocketClosedError());
    const socket = this.socket;
    if (socket !== undefined) {
      this.socket = undefined;
      socket.close();
    }
    this.setState("closed");
    await Promise.resolve();
  }

  public async subscribeEvents(
    eventType: string,
    handler: EventHandler,
  ): Promise<() => Promise<void>> {
    const subscription: Subscription = { kind: "event", eventType, handler };
    const clientKey = this.subscriptions.register(subscription);
    try {
      await this.subscribeOnServer(clientKey, subscription);
    } catch (error: unknown) {
      this.subscriptions.unregister(clientKey);
      throw error;
    }
    return async () => {
      await this.unsubscribe(clientKey);
    };
  }

  public async subscribeTrigger(
    trigger: Record<string, unknown>,
    handler: EventHandler,
  ): Promise<() => Promise<void>> {
    const subscription: Subscription = { kind: "trigger", trigger, handler };
    const clientKey = this.subscriptions.register(subscription);
    try {
      await this.subscribeOnServer(clientKey, subscription);
    } catch (error: unknown) {
      this.subscriptions.unregister(clientKey);
      throw error;
    }
    return async () => {
      await this.unsubscribe(clientKey);
    };
  }

  public async callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown> {
    const payload: Record<string, unknown> = {
      type: "call_service",
      domain,
      service,
    };
    if (data !== undefined) {
      payload["service_data"] = data;
    }
    if (target !== undefined) {
      payload["target"] = target;
    }
    const { result } = this.sendRequest(payload);
    return result;
  }

  public async getStates(): Promise<EntityState[]> {
    const { result } = this.sendRequest({ type: "get_states" });
    return z.array(EntityStateSchema).parse(await result);
  }

  private async openAndAuth(): Promise<void> {
    this.setState("connecting");
    // Close any prior socket before replacing it, so its handlers can't
    // trigger a second concurrent reconnect loop once it eventually closes.
    const previous = this.socket;
    if (previous !== undefined) {
      this.socket = undefined;
      previous.close();
    }
    const socket = new this.webSocketImpl(this.wsUrl);
    this.socket = socket;
    this.nextId = 1;
    this.pending.clear();
    this.subscriptions.clearServerIds();

    await waitForOpen(socket);
    await this.performAuth(socket);
    this.attachMessageHandler(socket);
    this.attachCloseHandler(socket);
    this.setState("authenticated");
    this.reconnectAttempt = 0;
    this.startPingTimer();
  }

  private attachMessageHandler(socket: WebSocketLike): void {
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) {
        // Orphaned socket — ignore any late messages.
        return;
      }
      const parsed = MessageDataString.safeParse(extractEventData(event));
      if (!parsed.success || parsed.data === "") {
        return;
      }
      this.handleRawMessage(parsed.data);
    });
  }

  private attachCloseHandler(socket: WebSocketLike): void {
    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        // Orphaned socket closing (superseded by a reconnect or by close());
        // the current socket — if any — has its own handler.
        return;
      }
      this.socket = undefined;
      this.stopPingTimer();
      this.failAllPending(new HaWebSocketClosedError());
      if (this.closedByUser) {
        // close() already ran setState("closed"); don't double-emit.
        return;
      }
      this.setState("closed");
      if (this.opts.reconnect) {
        void this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.setState("error", event);
    });
  }

  private handleRawMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = ServerMessage.safeParse(parsed);
    if (!result.success) {
      return;
    }
    const message = result.data;
    if (message.type === "event") {
      this.dispatchEvent(message);
      return;
    }
    if (message.type === "result") {
      this.dispatchResult(message);
    }
  }

  private dispatchEvent(message: EventMessage): void {
    const subscription = this.subscriptions.getByServerId(message.id);
    if (subscription === undefined) {
      return;
    }
    void Promise.resolve(subscription.handler(message.event)).catch(
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        this.emitError(`Subscription handler threw: ${detail}`);
      },
    );
  }

  private dispatchResult(message: z.infer<typeof ResultMessage>): void {
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(message.id);
    if (message.success) {
      pending.resolve(message.result);
      return;
    }
    const error = new HaWebSocketResultError(
      message.error?.message ?? "Home Assistant returned an error result",
      message.error?.code,
    );
    pending.reject(error);
  }

  private async performAuth(socket: WebSocketLike): Promise<void> {
    const raw = await waitForFirstMessage(socket);
    const first = AuthMessage.parse(JSON.parse(raw));
    if (first.type !== "auth_required") {
      throw new HaWebSocketAuthError(
        `Unexpected first message type: ${first.type}`,
      );
    }
    socket.send(JSON.stringify({ type: "auth", access_token: this.token }));
    const nextRaw = await waitForFirstMessage(socket);
    const next = AuthMessage.parse(JSON.parse(nextRaw));
    if (next.type === "auth_invalid") {
      throw new HaWebSocketAuthError(next.message);
    }
    if (next.type !== "auth_ok") {
      throw new HaWebSocketAuthError(`Unexpected auth response: ${next.type}`);
    }
  }

  private async resubscribeAll(): Promise<void> {
    // clearServerIds already ran in openAndAuth, so server-id bindings are
    // empty here; the clientKey → subscription map still holds every caller-
    // registered subscription. Rebind each to a fresh server id and keep
    // going on individual failures so one bad resubscribe doesn't drop the
    // rest. Subscriptions that fail stay in the registry and get retried on
    // the next reconnect.
    for (const [clientKey, subscription] of this.subscriptions.snapshot()) {
      try {
        await this.subscribeOnServer(clientKey, subscription);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        this.emitError(`Resubscribe failed: ${detail}`);
      }
    }
  }

  private async subscribeOnServer(
    clientKey: number,
    subscription: Subscription,
  ): Promise<void> {
    const payload =
      subscription.kind === "event"
        ? { type: "subscribe_events", event_type: subscription.eventType }
        : { type: "subscribe_trigger", trigger: subscription.trigger };
    const { id, result } = this.sendRequest(payload);
    this.subscriptions.bindServerId(clientKey, id);
    await result;
  }

  private async unsubscribe(clientKey: number): Promise<void> {
    const removed = this.subscriptions.unregister(clientKey);
    if (removed?.serverId === undefined) {
      // No active server binding (e.g. disconnected before resubscribe
      // completed); caller-side registry entry is gone, nothing more to do.
      return;
    }
    const { result } = this.sendRequest({
      type: "unsubscribe_events",
      subscription: removed.serverId,
    });
    await result;
  }

  private sendRequest(payload: Record<string, unknown>): {
    id: number;
    result: Promise<unknown>;
  } {
    const socket = this.requireOpenSocket();
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    socket.send(JSON.stringify({ id, ...payload }));
    return { id, result };
  }

  private requireOpenSocket(): WebSocketLike {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== socket.OPEN) {
      throw new HaWebSocketClosedError();
    }
    return socket;
  }

  private async scheduleReconnect(): Promise<void> {
    const delay = Math.min(
      this.opts.initialReconnectDelayMs * 2 ** this.reconnectAttempt,
      this.opts.maxReconnectDelayMs,
    );
    this.reconnectAttempt += 1;
    await wait(delay);
    if (this.closedByUser) {
      return;
    }
    try {
      await this.openAndAuth();
      await this.resubscribeAll();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.emitError(`Reconnect failed: ${detail}`);
      void this.scheduleReconnect();
    }
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      const socket = this.socket;
      if (socket === undefined || socket.readyState !== socket.OPEN) {
        return;
      }
      const id = this.nextId;
      this.nextId += 1;
      socket.send(JSON.stringify({ id, type: "ping" }));
    }, this.opts.pingIntervalMs);
  }

  private stopPingTimer(): void {
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private failAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setState(state: ConnectionState, detail?: unknown): void {
    for (const listener of this.stateListeners) {
      try {
        listener(state, detail);
      } catch {
        // ignore listener errors
      }
    }
  }

  private emitError(message: string): void {
    this.setState("error", new HaWebSocketError(message));
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForOpen(socket: WebSocketLike): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === socket.OPEN) {
      resolve();
      return;
    }
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new HaWebSocketError("WebSocket failed to open"));
    };
    const cleanup = (): void => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

const MessageDataString = z.string();

const WebSocketEventShape = z.looseObject({ data: z.unknown() });

function extractEventData(event: unknown): unknown {
  const parsed = WebSocketEventShape.safeParse(event);
  return parsed.success ? parsed.data.data : undefined;
}

function waitForFirstMessage(socket: WebSocketLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: unknown): void => {
      cleanup();
      const parsed = MessageDataString.safeParse(extractEventData(event));
      resolve(parsed.success ? parsed.data : "");
    };
    const onClose = (): void => {
      cleanup();
      reject(new HaWebSocketClosedError());
    };
    const cleanup = (): void => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

function buildWsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.startsWith("https://")) {
    return `${normalized.replace(/^https:\/\//u, "wss://")}/api/websocket`;
  }
  if (normalized.startsWith("http://")) {
    return `${normalized.replace(/^http:\/\//u, "ws://")}/api/websocket`;
  }
  return `${normalized}/api/websocket`;
}
