import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HomeAssistantEventClient } from "../src/index.ts";
import { createFakeWebSocketFactory } from "./fake-websocket.ts";
import type { FakeWebSocket } from "./fake-websocket.ts";

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function swallow<T>(promise: Promise<T>): Promise<void> {
  try {
    await promise;
  } catch {
    // intentionally ignored
  }
}

const SubscribeMessage = z.object({
  id: z.number(),
  type: z.string(),
  event_type: z.string().optional(),
});

const GenericMessage = z.object({
  id: z.number(),
  type: z.string(),
});

const AuthFrame = z.object({
  type: z.literal("auth"),
  access_token: z.string(),
});

function parseSent<T>(raw: string | undefined, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(raw ?? "{}"));
}

function createClientFixture(reconnect = false): {
  client: HomeAssistantEventClient;
  instances: FakeWebSocket[];
  transitions: string[];
} {
  const { Impl, instances } = createFakeWebSocketFactory();
  const client = new HomeAssistantEventClient(
    { baseUrl: "http://ha.local:8123", token: "t" },
    {
      webSocketImpl: Impl,
      reconnect,
      initialReconnectDelayMs: 1,
      maxReconnectDelayMs: 1,
    },
  );
  const transitions: string[] = [];
  client.onConnectionChange((state) => transitions.push(state));
  return { client, instances, transitions };
}

async function flushFakeTimers(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function authenticate(
  socket: FakeWebSocket,
  flushMessages = flush,
): Promise<void> {
  socket.pushServerMessage({ type: "auth_required" });
  await flushMessages();
  socket.pushServerMessage({ type: "auth_ok" });
  await flushMessages();
}

async function connectClient(
  client: HomeAssistantEventClient,
  instances: FakeWebSocket[],
  flushMessages = flush,
): Promise<FakeWebSocket> {
  const connected = client.connect();
  await flushMessages();
  const socket = instances[0];
  if (socket === undefined) throw new Error("Initial socket was not created");
  await authenticate(socket, flushMessages);
  await connected;
  return socket;
}

describe("HomeAssistantEventClient", () => {
  it("completes the auth handshake", async () => {
    const { Impl, instances } = createFakeWebSocketFactory();
    const client = new HomeAssistantEventClient(
      { baseUrl: "http://ha.local:8123", token: "secret" },
      { webSocketImpl: Impl, reconnect: false },
    );

    const connectPromise = client.connect();
    await flush();
    const socket = instances[0];
    expect(socket).toBeDefined();
    if (socket === undefined) {
      return;
    }

    socket.pushServerMessage({
      type: "auth_required",
      ha_version: "2024.1.0",
    });
    await flush();
    const authSent = parseSent(socket.sent[0], AuthFrame);
    expect(authSent.access_token).toBe("secret");

    socket.pushServerMessage({ type: "auth_ok", ha_version: "2024.1.0" });
    await connectPromise;

    await client.close();
  });

  it("builds a wss:// URL when baseUrl is https://", async () => {
    const { Impl, instances } = createFakeWebSocketFactory();
    const client = new HomeAssistantEventClient(
      { baseUrl: "https://ha.example.com/", token: "t" },
      { webSocketImpl: Impl, reconnect: false },
    );
    const pending = swallow(client.connect());
    await flush();
    expect(instances[0]?.url).toBe("wss://ha.example.com/api/websocket");
    await client.close();
    await pending;
  });

  it("subscribes to events and dispatches to handler", async () => {
    const { client, instances } = createClientFixture();
    const socket = await connectClient(client, instances);

    const received: unknown[] = [];
    const subscribePromise = client.subscribeEvents("state_changed", (ev) => {
      received.push(ev);
    });
    await flush();

    const subMessage = parseSent(socket.sent[1], SubscribeMessage);
    expect(subMessage.type).toBe("subscribe_events");
    expect(subMessage.event_type).toBe("state_changed");

    socket.pushServerMessage({
      id: subMessage.id,
      type: "result",
      success: true,
      result: null,
    });
    const unsubscribe = await subscribePromise;

    socket.pushServerMessage({
      id: subMessage.id,
      type: "event",
      event: {
        event_type: "state_changed",
        data: { entity_id: "light.kitchen" },
        time_fired: "2024-01-01T00:00:00Z",
        origin: "LOCAL",
      },
    });
    await flush();

    expect(received).toHaveLength(1);

    const unsubPending = unsubscribe();
    await flush();
    const unsubMessage = parseSent(socket.sent[2], GenericMessage);
    socket.pushServerMessage({
      id: unsubMessage.id,
      type: "result",
      success: true,
      result: null,
    });
    await unsubPending;

    await client.close();
  });

  it("lists and validates entity-registry entries", async () => {
    const { client, instances } = createClientFixture();
    const socket = await connectClient(client, instances);
    expect(socket).toBeDefined();

    const registryPromise = client.getEntityRegistry();
    await flush();
    const message = parseSent(socket.sent[1], GenericMessage);
    expect(message.type).toBe("config/entity_registry/list");
    socket.pushServerMessage({
      id: message.id,
      type: "result",
      success: true,
      result: [
        {
          entity_id: "vacuum.storage_litter_box",
          unique_id: "robot-123",
          platform: "litterrobot",
          config_entry_id: "entry-123",
          device_id: "device-123",
          area_id: "storage",
          name: null,
          original_name: "Litter Box",
          disabled_by: null,
        },
      ],
    });

    await expect(registryPromise).resolves.toEqual([
      expect.objectContaining({
        entity_id: "vacuum.storage_litter_box",
        config_entry_id: "entry-123",
      }),
    ]);
    await client.close();
  });

  it("callService resolves with the result payload and rejects on error", async () => {
    const { client, instances } = createClientFixture();
    const socket = await connectClient(client, instances);

    const okPromise = client.callService("light", "turn_on", {
      entity_id: "light.kitchen",
    });
    await flush();
    const okMsg = parseSent(socket.sent[1], GenericMessage);
    socket.pushServerMessage({
      id: okMsg.id,
      type: "result",
      success: true,
      result: { context: { id: "ctx" } },
    });
    const okResult = await okPromise;
    expect(okResult).toEqual({ context: { id: "ctx" } });

    const errPromise = client.callService("light", "turn_off", {
      entity_id: "light.kitchen",
    });
    await flush();
    const errMsg = parseSent(socket.sent[2], GenericMessage);
    socket.pushServerMessage({
      id: errMsg.id,
      type: "result",
      success: false,
      error: { code: "invalid_format", message: "no dice" },
    });
    await expect(errPromise).rejects.toThrow("no dice");

    await client.close();
  });
});

describe("HomeAssistantEventClient subscription health", () => {
  it.each(["throw", "reject"])(
    "reports a handler %s without a transport error",
    async (failure) => {
      const { client, instances, transitions } = createClientFixture();
      try {
        const socket = await connectClient(client, instances);
        const subscribed = client.subscribeEvents("state_changed", () => {
          const error = new Error("consumer failed");
          if (failure === "throw") throw error;
          return Promise.reject(error);
        });
        await flush();
        const request = parseSent(socket.sent[1], SubscribeMessage);
        socket.pushServerMessage({
          id: request.id,
          type: "result",
          success: true,
          result: null,
        });
        await subscribed;
        socket.pushServerMessage({
          id: request.id,
          type: "event",
          event: {
            event_type: "state_changed",
            data: {},
            time_fired: "2024-01-01T00:00:00Z",
            origin: "LOCAL",
          },
        });
        await flush();
        expect(transitions.at(-1)).toBe("handler-error");
        expect(transitions).not.toContain("error");
      } finally {
        await client.close();
      }
    },
  );

  it("does not become ready when the server rejects a restored subscription", async () => {
    const { client, instances, transitions } = createClientFixture(true);
    try {
      const first = await connectClient(client, instances);
      const subscribed = client.subscribeEvents("state_changed", () => {
        // Only subscription acknowledgement is relevant to this probe.
      });
      await flush();
      const request = parseSent(first.sent[1], SubscribeMessage);
      first.pushServerMessage({
        id: request.id,
        type: "result",
        success: true,
        result: null,
      });
      await subscribed;
      first.forceClose();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const restored = instances[1];
      if (restored === undefined)
        throw new Error("Reconnect socket was not created");
      await authenticate(restored);
      const restoreRequest = parseSent(restored.sent[1], SubscribeMessage);
      restored.pushServerMessage({
        id: restoreRequest.id,
        type: "result",
        success: false,
        error: { code: "unauthorized", message: "subscription refused" },
      });
      await flush();
      expect(transitions).toContain("error");
      expect(transitions.filter((state) => state === "ready")).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});

describe("HomeAssistantEventClient reconnect ownership", () => {
  it("serializes retries after disconnect during restore and cancels pending retry on close", async () => {
    vi.useFakeTimers();
    const { client, instances, transitions } = createClientFixture(true);
    const received: unknown[] = [];
    try {
      const first = await connectClient(client, instances, flushFakeTimers);
      const subscribed = client.subscribeEvents("state_changed", (event) => {
        received.push(event);
      });
      const initialRequest = parseSent(first.sent[1], SubscribeMessage);
      first.pushServerMessage({
        id: initialRequest.id,
        type: "result",
        success: true,
        result: null,
      });
      await subscribed;

      first.forceClose();
      await vi.advanceTimersByTimeAsync(1);
      const restoring = instances[1];
      if (restoring === undefined)
        throw new Error("Restore socket was not created");
      await authenticate(restoring, flushFakeTimers);
      expect(parseSent(restoring.sent[1], SubscribeMessage).type).toBe(
        "subscribe_events",
      );
      // No acknowledgement: transport close and restoration failure both
      // request a retry, which must have a single timer owner.
      restoring.forceClose();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      expect(transitions).toContain("error");
      expect(transitions.filter((state) => state === "ready")).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      const recovered = instances[2];
      if (recovered === undefined)
        throw new Error("Recovery socket was not created");
      // Delay authentication beyond the backoff to expose a second pending
      // retry that would replace the socket and multiply reconnect attempts.
      await vi.advanceTimersByTimeAsync(100);
      expect(instances).toHaveLength(3);
      await authenticate(recovered, flushFakeTimers);
      const restoredRequest = parseSent(recovered.sent[1], SubscribeMessage);
      recovered.pushServerMessage({
        id: restoredRequest.id,
        type: "result",
        success: true,
        result: null,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(transitions.at(-1)).toBe("ready");
      expect(transitions.filter((state) => state === "ready")).toHaveLength(2);
      expect(recovered.sent).toHaveLength(2);
      recovered.pushServerMessage({
        id: restoredRequest.id,
        type: "event",
        event: {
          event_type: "state_changed",
          data: {},
          time_fired: "2024-01-01T00:00:00Z",
          origin: "LOCAL",
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toHaveLength(1);

      recovered.forceClose();
      expect(vi.getTimerCount()).toBe(1);
      await client.close();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(instances).toHaveLength(3);
    } finally {
      await client.close();
      vi.useRealTimers();
    }
  });
});

describe("HomeAssistantEventClient lifecycle", () => {
  it("close() during CONNECTING rejects the in-flight connect() instead of hanging", async () => {
    const { Impl, instances } = createFakeWebSocketFactory();
    const client = new HomeAssistantEventClient(
      { baseUrl: "http://ha.local:8123", token: "t" },
      { webSocketImpl: Impl, reconnect: false },
    );

    // Start connect; the fake's open event is queued as a microtask,
    // so we can synchronously interrupt before it fires.
    const connectPromise = client.connect();
    const socket = instances[0];
    expect(socket).toBeDefined();
    if (socket === undefined) {
      return;
    }
    // Still CONNECTING — call close() before the microtask runs.
    socket.close();

    // connect() must reject in bounded time, not hang forever.
    await expect(connectPromise).rejects.toBeDefined();
  });

  it("emits closed exactly once per user-initiated close", async () => {
    const { client, instances, transitions } = createClientFixture();
    await connectClient(client, instances);

    await client.close();
    await flush();

    const closed = transitions.filter((s) => s === "closed");
    expect(closed).toHaveLength(1);
  });

  it("unsubscribe closure still works after a reconnect rebinds server ids", async () => {
    const { client, instances, transitions } = createClientFixture(true);

    // Initial connect + subscribe
    const socket = await connectClient(client, instances);
    expect(transitions.at(-1)).toBe("ready");

    const subscribePromise = client.subscribeEvents("state_changed", () => {
      // no-op
    });
    await flush();
    const firstSub = parseSent(socket.sent[1], SubscribeMessage);
    expect(firstSub.type).toBe("subscribe_events");
    socket.pushServerMessage({
      id: firstSub.id,
      type: "result",
      success: true,
      result: null,
    });
    const unsubscribe = await subscribePromise;

    // Drop the socket; the client schedules a reconnect
    socket.forceClose();
    await flush();
    // Wait out the 1ms backoff and the reconnect attempt
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });

    // Second socket came online
    expect(instances.length).toBeGreaterThanOrEqual(2);
    const socket2 = instances.at(-1);
    if (socket2 === undefined) {
      return;
    }
    await authenticate(socket2);
    expect(transitions.at(-1)).toBe("authenticated");

    // Resubscribe fires on socket2. Server id may numerically match the
    // first socket's (per-connection counter resets to 1) but it's now
    // bound under the same stable client key.
    const resubscribe = parseSent(socket2.sent[1], SubscribeMessage);
    expect(resubscribe.type).toBe("subscribe_events");
    socket2.pushServerMessage({
      id: resubscribe.id,
      type: "result",
      success: true,
      result: null,
    });
    await flush();

    expect(transitions.at(-1)).toBe("ready");

    // Now the unsubscribe closure (captured before reconnect) must target
    // the *new* server id, not the stale first one.
    const unsubPending = unsubscribe();
    await flush();
    const unsubFrame = parseSent(socket2.sent[2], GenericMessage);
    expect(unsubFrame.type).toBe("unsubscribe_events");
    const UnsubPayload = z.object({
      id: z.number(),
      type: z.string(),
      subscription: z.number(),
    });
    const unsubPayload = parseSent(socket2.sent[2], UnsubPayload);
    expect(unsubPayload.subscription).toBe(resubscribe.id);

    socket2.pushServerMessage({
      id: unsubFrame.id,
      type: "result",
      success: true,
      result: null,
    });
    await unsubPending;

    await client.close();
  });
});
