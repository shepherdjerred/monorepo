import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { HomeAssistantEventClient } from "#lib";
import { createFakeWebSocketFactory } from "./fake-websocket.ts";

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
    const { Impl, instances } = createFakeWebSocketFactory();
    const client = new HomeAssistantEventClient(
      { baseUrl: "http://ha.local:8123", token: "t" },
      { webSocketImpl: Impl, reconnect: false },
    );

    const connectPromise = client.connect();
    await flush();
    const socket = instances[0];
    if (socket === undefined) {
      return;
    }
    socket.pushServerMessage({ type: "auth_required" });
    await flush();
    socket.pushServerMessage({ type: "auth_ok" });
    await connectPromise;

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

  it("callService resolves with the result payload and rejects on error", async () => {
    const { Impl, instances } = createFakeWebSocketFactory();
    const client = new HomeAssistantEventClient(
      { baseUrl: "http://ha.local:8123", token: "t" },
      { webSocketImpl: Impl, reconnect: false },
    );

    const connectPromise = client.connect();
    await flush();
    const socket = instances[0];
    if (socket === undefined) {
      return;
    }
    socket.pushServerMessage({ type: "auth_required" });
    await flush();
    socket.pushServerMessage({ type: "auth_ok" });
    await connectPromise;

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
    const { Impl, instances } = createFakeWebSocketFactory();
    const client = new HomeAssistantEventClient(
      { baseUrl: "http://ha.local:8123", token: "t" },
      { webSocketImpl: Impl, reconnect: false },
    );
    const transitions: string[] = [];
    client.onConnectionChange((state) => {
      transitions.push(state);
    });

    const connectPromise = client.connect();
    await flush();
    const socket = instances[0];
    if (socket === undefined) {
      return;
    }
    socket.pushServerMessage({ type: "auth_required" });
    await flush();
    socket.pushServerMessage({ type: "auth_ok" });
    await connectPromise;

    await client.close();
    await flush();

    const closed = transitions.filter((s) => s === "closed");
    expect(closed).toHaveLength(1);
  });

  it("unsubscribe closure still works after a reconnect rebinds server ids", async () => {
    const { Impl, instances } = createFakeWebSocketFactory();
    const client = new HomeAssistantEventClient(
      { baseUrl: "http://ha.local:8123", token: "t" },
      {
        webSocketImpl: Impl,
        reconnect: true,
        initialReconnectDelayMs: 1,
        maxReconnectDelayMs: 1,
      },
    );

    // Initial connect + subscribe
    const connectPromise = client.connect();
    await flush();
    const socket = instances[0];
    if (socket === undefined) {
      return;
    }
    socket.pushServerMessage({ type: "auth_required" });
    await flush();
    socket.pushServerMessage({ type: "auth_ok" });
    await connectPromise;

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
    socket2.pushServerMessage({ type: "auth_required" });
    await flush();
    socket2.pushServerMessage({ type: "auth_ok" });
    await flush();

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
