import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { ConsoleClient } from "./ConsoleClient";
import { WebSocketError } from "./errors";

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

  private sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  getSentMessages(): string[] {
    return this.sentMessages;
  }

  // Test helpers to simulate server messages
  simulateMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  simulateError(event: unknown): void {
    this.onerror?.(event);
  }
}

describe("ConsoleClient", () => {
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
    test("uses default baseUrl when not provided", () => {
      const client = new ConsoleClient();
      expect(client).toBeDefined();
    });

    test("uses provided baseUrl", () => {
      const client = new ConsoleClient({ baseUrl: "ws://custom:8080/ws/console" });
      expect(client).toBeDefined();
    });
  });

  describe("connect", () => {
    test("emits connected event on successful connection", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      const onConnected = mock(() => {});

      client.onConnected(onConnected);
      client.connect("session1");

      // Wait for async connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onConnected).toHaveBeenCalledTimes(1);
    });

    test("disconnects existing connection before connecting", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      const onDisconnected = mock(() => {});

      client.onDisconnected(onDisconnected);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Connect to another session
      client.connect("session2");

      expect(onDisconnected).toHaveBeenCalledTimes(1);
    });

    test("encodes session id in URL", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      client.connect("session/with/special");

      // The URL should be encoded
      expect(client.currentSessionId).toBe("session/with/special");
    });
  });

  describe("disconnect", () => {
    test("emits disconnected event", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      const onDisconnected = mock(() => {});

      client.onDisconnected(onDisconnected);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      client.disconnect();

      expect(onDisconnected).toHaveBeenCalledTimes(1);
      expect(client.currentSessionId).toBeNull();
    });

    test("handles disconnect when not connected", () => {
      const client = new ConsoleClient();
      expect(() => { client.disconnect(); }).not.toThrow();
    });
  });

  describe("write", () => {
    test("throws when not connected", () => {
      const client = new ConsoleClient();
      expect(() => { client.write("test"); }).toThrow(WebSocketError);
    });

    test("sends base64-encoded input message", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      client.write("hello");

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;
      const messages = ws.getSentMessages();

      expect(messages).toHaveLength(1);
      const parsed = JSON.parse(messages[0]!) as { type: string; data: string };
      expect(parsed.type).toBe("input");
      expect(atob(parsed.data)).toBe("hello");
    });
  });

  describe("resize", () => {
    test("throws when not connected", () => {
      const client = new ConsoleClient();
      expect(() => { client.resize(24, 80); }).toThrow(WebSocketError);
    });

    test("sends resize message", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      client.resize(24, 80);

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;
      const messages = ws.getSentMessages();

      expect(messages).toHaveLength(1);
      const parsed = JSON.parse(messages[0]!) as { type: string; rows: number; cols: number };
      expect(parsed.type).toBe("resize");
      expect(parsed.rows).toBe(24);
      expect(parsed.cols).toBe(80);
    });
  });

  describe("onData", () => {
    test("emits decoded data from output messages", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      const onData = mock((_data: string) => {});

      client.onData(onData);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending output
      const message = JSON.stringify({ type: "output", data: btoa("Hello, World!") });
      ws.simulateMessage(message);

      expect(onData).toHaveBeenCalledWith("Hello, World!");
    });

    test("emits error for invalid base64", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      const onError = mock((_error: Error) => {});

      client.onError(onError);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending invalid base64
      const message = JSON.stringify({ type: "output", data: "!!!invalid-base64!!!" });
      ws.simulateMessage(message);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(WebSocketError);
    });

    test("emits error for invalid JSON", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      const onError = mock((_error: Error) => {});

      client.onError(onError);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending invalid JSON
      ws.simulateMessage("not valid json");

      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("listener management", () => {
    test("unsubscribe removes listener", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      const onConnected = mock(() => {});

      const unsubscribe = client.onConnected(onConnected);
      unsubscribe();

      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onConnected).not.toHaveBeenCalled();
    });
  });

  describe("isConnected", () => {
    test("returns false when not connected", () => {
      const client = new ConsoleClient();
      expect(client.isConnected).toBe(false);
    });

    test("returns true when connected", async () => {
      const client = new ConsoleClient({ baseUrl: "ws://localhost:3030/ws/console" });
      client.connect("session1");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(client.isConnected).toBe(true);
    });
  });
});
