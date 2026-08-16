import { describe, expect, test } from "bun:test";
import {
  customSocketReconnectDelay,
  isTerminalCustomSocketClose,
} from "@/lib/custom-socket-reconnect";

describe("custom Activity WebSocket reconnect policy", () => {
  test("backs off and caps retry delays", () => {
    expect(customSocketReconnectDelay(0)).toBe(1000);
    expect(customSocketReconnectDelay(1)).toBe(2000);
    expect(customSocketReconnectDelay(5)).toBe(30_000);
    expect(customSocketReconnectDelay(11)).toBe(30_000);
  });

  test("stops after the bounded retry budget", () => {
    expect(customSocketReconnectDelay(12)).toBeNull();
  });

  test("rejects invalid retry counters", () => {
    expect(() => customSocketReconnectDelay(-1)).toThrow(
      "WebSocket reconnect attempt must be a non-negative integer",
    );
    expect(() => customSocketReconnectDelay(1.5)).toThrow(
      "WebSocket reconnect attempt must be a non-negative integer",
    );
  });

  test("treats policy violations as terminal auth closes", () => {
    expect(isTerminalCustomSocketClose(1008)).toBe(true);
    expect(isTerminalCustomSocketClose(1001)).toBe(false);
    expect(isTerminalCustomSocketClose(1006)).toBe(false);
  });
});
