import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { EventsClient } from "./EventsClient.ts";
import type { SessionEvent } from "./EventsClient.ts";

// Reusable noop functions for mock callbacks
function noop(): void {
  // intentionally empty
}
function noopEvent(_event: SessionEvent): void {
  // intentionally empty
}
function noopError(_error: Error): void {
  // intentionally empty
}
import {
  SessionStatus,
  AccessMode,
  BackendType,
  AgentType,
  ClaudeWorkingStatus,
} from "@clauderon/shared";
import type { Session } from "@clauderon/shared";

// Mock WebSocket implementation
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers to simulate server messages
  simulateMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  simulateError(event: unknown): void {
    this.onerror?.(event);
  }
}

// Helper to create a valid mock session
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session1",
    name: "Test Session",
    status: SessionStatus.Running,
    backend: BackendType.Zellij,
    agent: AgentType.ClaudeCode,
    repo_path: "/tmp/repo",
    worktree_path: "/tmp/worktree",
    branch_name: "main",
    initial_prompt: "test prompt",
    dangerous_skip_checks: false,
    dangerous_copy_creds: false,
    claude_status: ClaudeWorkingStatus.Unknown,
    access_mode: AccessMode.ReadWrite,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventsClient", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error - Mocking WebSocket
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  describe("constructor", () => {
    test("uses default url when not provided", () => {
      const client = new EventsClient();
      expect(client).toBeDefined();
    });

    test("uses provided url", () => {
      const client = new EventsClient({ url: "ws://custom:8080/ws/events" });
      expect(client).toBeDefined();
    });

    test("auto-reconnect defaults to true", () => {
      const client = new EventsClient();
      expect(client).toBeDefined();
    });
  });

  describe("connect", () => {
    test("emits connected event on successful connection", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onConnected = mock(noop);

      client.onConnected(onConnected);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onConnected).toHaveBeenCalledTimes(1);
    });

    test("does nothing if already connected", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onConnected = mock(noop);

      client.onConnected(onConnected);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try connecting again
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should only be called once
      expect(onConnected).toHaveBeenCalledTimes(1);
    });
  });

  describe("disconnect", () => {
    test("emits disconnected event", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onDisconnected = mock(noop);

      client.onDisconnected(onDisconnected);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      client.disconnect();

      expect(onDisconnected).toHaveBeenCalledTimes(1);
    });

    test("handles disconnect when not connected", () => {
      const client = new EventsClient();
      expect(() => {
        client.disconnect();
      }).not.toThrow();
    });

    test("prevents auto-reconnect after intentional disconnect", async () => {
      const client = new EventsClient({
        url: "ws://localhost:3030/ws/events",
        autoReconnect: true,
        reconnectDelay: 10,
      });
      const onConnected = mock(noop);

      client.onConnected(onConnected);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      client.disconnect();

      // Wait for potential reconnect
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should only be called once (initial connect)
      expect(onConnected).toHaveBeenCalledTimes(1);
    });
  });

  describe("onEvent", () => {
    test("emits session_created event", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onEvent = mock(noopEvent);

      client.onEvent(onEvent);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      const event: SessionEvent = {
        type: "session_created",
        session: createMockSession(),
      };

      ws.simulateMessage(JSON.stringify({ type: "event", event }));

      expect(onEvent).toHaveBeenCalledWith(event);
    });

    test("emits session_updated event", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onEvent = mock(noopEvent);

      client.onEvent(onEvent);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      const event: SessionEvent = {
        type: "session_updated",
        session: createMockSession({
          status: SessionStatus.Archived,
          access_mode: AccessMode.ReadOnly,
        }),
      };

      ws.simulateMessage(JSON.stringify({ type: "event", event }));

      expect(onEvent).toHaveBeenCalledWith(event);
    });

    test("emits session_deleted event", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onEvent = mock(noopEvent);

      client.onEvent(onEvent);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      const event: SessionEvent = {
        type: "session_deleted",
        sessionId: "session1",
      };

      ws.simulateMessage(JSON.stringify({ type: "event", event }));

      expect(onEvent).toHaveBeenCalledWith(event);
    });

    test("ignores connected acknowledgment message", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onEvent = mock(noopEvent);

      client.onEvent(onEvent);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      ws.simulateMessage(
        JSON.stringify({ type: "connected", message: "Connected" }),
      );

      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("onError", () => {
    test("emits error for invalid JSON", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      ws.simulateMessage("not valid json");

      expect(onError).toHaveBeenCalledTimes(1);
    });

    test("emits error on WebSocket error", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      ws.simulateError(new Error("Connection failed"));

      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("auto-reconnect", () => {
    test("reconnects after unexpected disconnect", async () => {
      const client = new EventsClient({
        url: "ws://localhost:3030/ws/events",
        autoReconnect: true,
        reconnectDelay: 10,
      });
      const onConnected = mock(noop);

      client.onConnected(onConnected);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate unexpected close
      ws.close();

      // Wait for reconnect
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should be called twice (initial + reconnect)
      expect(onConnected).toHaveBeenCalledTimes(2);
    });

    test("does not reconnect when autoReconnect is false", async () => {
      const client = new EventsClient({
        url: "ws://localhost:3030/ws/events",
        autoReconnect: false,
        reconnectDelay: 10,
      });
      const onConnected = mock(noop);

      client.onConnected(onConnected);
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate unexpected close
      ws.close();

      // Wait for potential reconnect
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should only be called once
      expect(onConnected).toHaveBeenCalledTimes(1);
    });
  });

  describe("listener management", () => {
    test("unsubscribe removes listener", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      const onConnected = mock(noop);

      const unsubscribe = client.onConnected(onConnected);
      unsubscribe();

      client.connect();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onConnected).not.toHaveBeenCalled();
    });
  });

  describe("isConnected", () => {
    test("returns false when not connected", () => {
      const client = new EventsClient();
      expect(client.isConnected).toBe(false);
    });

    test("returns true when connected", async () => {
      const client = new EventsClient({ url: "ws://localhost:3030/ws/events" });
      client.connect();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(client.isConnected).toBe(true);
    });
  });
});
