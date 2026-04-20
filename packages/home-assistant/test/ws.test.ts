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
