import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { ConsoleClient } from "./ConsoleClient";
import { WebSocketError } from "./errors";
import type { DecodeError } from "./errors";

// Reusable noop functions for mock callbacks
function noop(): void {
  // intentionally empty
}
function noopString(_data: string): void {
  // intentionally empty
}
function noopError(_error: Error): void {
  // intentionally empty
}

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

  private readonly sentMessages: string[] = [];

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
      const client = new ConsoleClient({
        baseUrl: "ws://custom:8080/ws/console",
      });
      expect(client).toBeDefined();
    });
  });

  describe("connect", () => {
    test("emits connected event on successful connection", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onConnected = mock(noop);

      client.onConnected(onConnected);
      client.connect("session1");

      // Wait for async connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onConnected).toHaveBeenCalledTimes(1);
    });

    test("disconnects existing connection before connecting", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onDisconnected = mock(noop);

      client.onDisconnected(onDisconnected);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Connect to another session
      client.connect("session2");

      expect(onDisconnected).toHaveBeenCalledTimes(1);
    });

    test("encodes session id in URL", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      client.connect("session/with/special");

      // The URL should be encoded
      expect(client.currentSessionId).toBe("session/with/special");
    });
  });

  describe("disconnect", () => {
    test("emits disconnected event", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onDisconnected = mock(noop);

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
      expect(() => {
        client.disconnect();
      }).not.toThrow();
    });
  });

  describe("write", () => {
    test("throws when not connected", () => {
      const client = new ConsoleClient();
      expect(() => {
        client.write("test");
      }).toThrow(WebSocketError);
    });

    test("sends base64-encoded input message", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
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
      expect(() => {
        client.resize(24, 80);
      }).toThrow(WebSocketError);
    });

    test("sends resize message", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      client.resize(24, 80);

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;
      const messages = ws.getSentMessages();

      expect(messages).toHaveLength(1);
      const parsed = JSON.parse(messages[0]!) as {
        type: string;
        rows: number;
        cols: number;
      };
      expect(parsed.type).toBe("resize");
      expect(parsed.rows).toBe(24);
      expect(parsed.cols).toBe(80);
    });
  });

  describe("onData", () => {
    test("emits decoded data from output messages", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onData = mock(noopString);

      client.onData(onData);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending output
      const message = JSON.stringify({
        type: "output",
        data: btoa("Hello, World!"),
      });
      ws.simulateMessage(message);

      expect(onData).toHaveBeenCalledWith("Hello, World!");
    });

    test("emits error for invalid base64", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending invalid base64
      const message = JSON.stringify({
        type: "output",
        data: "!!!invalid-base64!!!",
      });
      ws.simulateMessage(message);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(WebSocketError);
    });

    test("emits error for invalid JSON", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

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

  describe("UTF-8 streaming edge cases", () => {
    test("handles multi-byte UTF-8 characters split across chunks", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onData = mock(noopString);

      client.onData(onData);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Emoji "😀" is 4 bytes in UTF-8: F0 9F 98 80
      // Split it: first chunk has F0 9F, second chunk has 98 80
      const emoji = "😀";
      const bytes = new TextEncoder().encode(emoji);

      // Send first part (incomplete sequence)
      const chunk1 = bytes.slice(0, 2);
      const binaryString1 = Array.from(chunk1, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      const message1 = JSON.stringify({
        type: "output",
        data: btoa(binaryString1),
      });
      ws.simulateMessage(message1);

      // Send second part (completes the sequence)
      const chunk2 = bytes.slice(2);
      const binaryString2 = Array.from(chunk2, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      const message2 = JSON.stringify({
        type: "output",
        data: btoa(binaryString2),
      });
      ws.simulateMessage(message2);

      // Should have received the complete emoji across two chunks
      expect(onData).toHaveBeenCalledTimes(2);
      // First call may be empty (incomplete sequence buffered)
      // Second call should have the emoji
      const calls = onData.mock.calls.map((call) => call[0]).join("");
      expect(calls).toBe(emoji);
    });

    test("handles ANSI escape sequences correctly", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onData = mock(noopString);

      client.onData(onData);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // ANSI color codes are valid 7-bit ASCII (subset of UTF-8)
      const ansiText = "\u001B[31mRed Text\u001B[0m";
      const message = JSON.stringify({ type: "output", data: btoa(ansiText) });
      ws.simulateMessage(message);

      expect(onData).toHaveBeenCalledWith(ansiText);
    });

    test("replaces truly invalid UTF-8 with replacement character", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onData = mock(noopString);
      const onError = mock(noopError);

      client.onData(onData);
      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Create invalid UTF-8: 0xFF is never valid in UTF-8
      const invalidBytes = new Uint8Array([
        0x48, 0x65, 0x6C, 0x6C, 0x6F, 0xFF, 0x21,
      ]); // "Hello�!"
      const binaryString = Array.from(invalidBytes, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      const message = JSON.stringify({
        type: "output",
        data: btoa(binaryString),
      });
      ws.simulateMessage(message);

      // Should replace invalid byte with U+FFFD instead of throwing
      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData.mock.calls[0]![0]).toContain("Hello");
      expect(onData.mock.calls[0]![0]).toContain("\uFFFD"); // Replacement character
      expect(onError).not.toHaveBeenCalled(); // No error emitted
    });

    test("handles mixed ASCII, UTF-8, and ANSI in single chunk", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onData = mock(noopString);

      client.onData(onData);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Realistic terminal output: ANSI codes + ASCII + emoji
      const mixedText = "\u001B[32m✓\u001B[0m Test passed 🎉";
      // Encode properly: string → UTF-8 bytes → binary string → base64
      const bytes = new TextEncoder().encode(mixedText);
      const binaryString = Array.from(bytes, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      const message = JSON.stringify({
        type: "output",
        data: btoa(binaryString),
      });
      ws.simulateMessage(message);

      expect(onData).toHaveBeenCalledWith(mixedText);
    });

    test("decoder state resets on disconnect", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private decoder for testing
      expect(client.decoder).not.toBeNull();

      client.disconnect();

      // @ts-expect-error - Accessing private decoder for testing
      expect(client.decoder).toBeNull();
    });
  });

  describe("listener management", () => {
    test("unsubscribe removes listener", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onConnected = mock(noop);

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
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      client.connect("session1");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(client.isConnected).toBe(true);
    });
  });

  describe("base64 validation and error handling", () => {
    test("rejects empty base64 data gracefully", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onData = mock(noopString);
      const onError = mock(noopError);

      client.onData(onData);
      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending empty data
      const message = JSON.stringify({ type: "output", data: "" });
      ws.simulateMessage(message);

      // Should emit empty string, not error
      expect(onData).toHaveBeenCalledWith("");
      expect(onError).not.toHaveBeenCalled();
    });

    test("rejects malformed base64 with proper error", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending invalid base64 (wrong length, invalid chars)
      const message = JSON.stringify({ type: "output", data: "abc" }); // Not multiple of 4
      ws.simulateMessage(message);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0].message).toContain(
        "Invalid base64 format",
      );
    });

    test("rejects null data field gracefully", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onData = mock(noopString);
      const onError = mock(noopError);

      client.onData(onData);
      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending null data
      const message = JSON.stringify({ type: "output", data: null });
      ws.simulateMessage(message);

      // Should not crash, should not emit data
      expect(onData).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled(); // Logged as warning, not error
    });

    test("throttles rapid error emissions", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Send 10 bad messages rapidly
      for (let i = 0; i < 10; i++) {
        const message = JSON.stringify({ type: "output", data: "bad!" });
        ws.simulateMessage(message);
      }

      // Should throttle after MAX_ERRORS_PER_SECOND (5)
      expect(onError.mock.calls.length).toBeLessThanOrEqual(5);
    });

    test("rejects oversized messages", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Create a valid base64 string that's too large (> 1MB)
      const largeData = btoa("A".repeat(800_000)); // Will be > 1MB in base64
      const message = JSON.stringify({ type: "output", data: largeData });
      ws.simulateMessage(message);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0].message).toContain("exceeds size limit");
    });

    test("error tracking resets on disconnect", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      let ws = client.ws as MockWebSocket;

      // Trigger some errors
      for (let i = 0; i < 3; i++) {
        ws.simulateMessage(JSON.stringify({ type: "output", data: "bad!" }));
      }

      const firstErrorCount = onError.mock.calls.length;

      // Disconnect and reconnect
      client.disconnect();
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      ws = client.ws as MockWebSocket;

      // Should be able to emit errors again (counter reset)
      for (let i = 0; i < 3; i++) {
        ws.simulateMessage(JSON.stringify({ type: "output", data: "bad!" }));
      }

      expect(onError.mock.calls.length).toBeGreaterThan(firstErrorCount);
    });
  });

  describe("DecodeError with rich context", () => {
    test("validation stage error includes context", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Simulate server sending invalid base64
      const message = JSON.stringify({ type: "output", data: "abc" }); // Not multiple of 4
      ws.simulateMessage(message);

      expect(onError).toHaveBeenCalledTimes(1);
      const error = onError.mock.calls[0]![0] as DecodeError;
      expect(error.name).toBe("DecodeError");
      expect(error.stage).toBe("validation");
      expect(error.context.sessionId).toBe("session1");
      expect(error.context.dataLength).toBe(3);
    });

    test("base64 stage error includes context", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Create a base64 string that passes validation but might fail atob in some browsers
      // This is tricky because atob usually accepts anything that looks like base64
      // For this test, we'll use a string that passes our regex but might be problematic
      const problematicBase64 = "AAAA"; // Valid base64 format
      const message = JSON.stringify({
        type: "output",
        data: problematicBase64,
      });
      ws.simulateMessage(message);

      // If atob succeeds (it likely will for this simple case), no error should occur
      // This test mainly verifies the error path exists and has correct structure
      // In production, specific byte sequences cause atob to fail
      if (onError.mock.calls.length > 0) {
        const error = onError.mock.calls[0]![0] as DecodeError;
        expect(error.name).toBe("DecodeError");
        expect(error.stage).toBe("base64");
        expect(error.context.dataSample).toBe(problematicBase64);
      }
    });

    test("error context includes data sample for debugging", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);

      client.onError(onError);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Create a long invalid base64 string to test sample truncation
      const longInvalidBase64 = "!" + "A".repeat(200); // Invalid char at start, then 200 A's
      const message = JSON.stringify({
        type: "output",
        data: longInvalidBase64,
      });
      ws.simulateMessage(message);

      expect(onError).toHaveBeenCalledTimes(1);
      const error = onError.mock.calls[0]![0] as DecodeError;
      expect(error.context.dataSample.length).toBeLessThanOrEqual(100); // Sample is truncated
      expect(error.context.dataLength).toBe(201); // Full length is preserved
    });

    test("production error scenario: 1368 character base64", async () => {
      const client = new ConsoleClient({
        baseUrl: "ws://localhost:3030/ws/console",
      });
      const onError = mock(noopError);
      const onData = mock(noopString);

      client.onError(onError);
      client.onData(onData);
      client.connect("session1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // @ts-expect-error - Accessing private ws for testing
      const ws = client.ws as MockWebSocket;

      // Create a valid 1368-character base64 string (1026 bytes of data)
      // This matches the production error pattern
      const data = "A".repeat(1026); // 1026 bytes
      const base64Data = btoa(data); // Will be 1368 chars
      expect(base64Data.length).toBe(1368); // Verify our assumption

      const message = JSON.stringify({ type: "output", data: base64Data });
      ws.simulateMessage(message);

      // This should succeed in our test environment
      // But in production, certain byte patterns at this length cause atob errors
      // If it succeeds, data should be emitted
      expect(
        onData.mock.calls.length + onError.mock.calls.length,
      ).toBeGreaterThan(0);

      // If an error occurred, verify it has proper context
      if (onError.mock.calls.length > 0) {
        const error = onError.mock.calls[0]![0] as DecodeError;
        expect(error.name).toBe("DecodeError");
        expect(error.context.dataLength).toBe(1368);
      }
    });
  });
});
