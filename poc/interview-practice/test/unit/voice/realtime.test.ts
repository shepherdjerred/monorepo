import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createRealtimeClient } from "#lib/voice/realtime.ts";
import type { Logger } from "#logger";

// eslint-disable-next-line @typescript-eslint/no-empty-function -- mock stub
const noop = (): void => {};

function createMockLogger(): Logger {
  const logger: Logger = {
    info: mock(noop),
    warn: mock(noop),
    error: mock(noop),
    debug: mock(noop),
    child: () => createMockLogger(),
  };
  return logger;
}

describe("realtime client", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  test("creates a client with expected interface", () => {
    const client = createRealtimeClient(logger);
    expect(client.connect).toBeFunction();
    expect(client.disconnect).toBeFunction();
    expect(client.sendSessionUpdate).toBeFunction();
    expect(client.sendAudio).toBeFunction();
    expect(client.commitAudio).toBeFunction();
    expect(client.sendFunctionResult).toBeFunction();
    expect(client.isConnected).toBeFunction();
    expect(client.on).toBeFunction();
  });

  test("reports not connected before connect", () => {
    const client = createRealtimeClient(logger);
    expect(client.isConnected()).toBe(false);
  });

  test("disconnect on non-connected client is safe", () => {
    const client = createRealtimeClient(logger);
    expect(() => client.disconnect()).not.toThrow();
  });

  test("sendAudio when not connected logs warning", () => {
    const client = createRealtimeClient(logger);
    client.sendAudio("dGVzdA==");
    expect(logger.warn).toHaveBeenCalled();
  });

  test("sendSessionUpdate when not connected logs warning", () => {
    const client = createRealtimeClient(logger);
    client.sendSessionUpdate({ model: "gpt-4o-realtime-preview" });
    expect(logger.warn).toHaveBeenCalled();
  });

  test("on registers callbacks without throwing", () => {
    const client = createRealtimeClient(logger);
    expect(() => {
      client.on({
        onTranscript: noop,
        onAudioDelta: noop,
        onError: noop,
      });
    }).not.toThrow();
  });

  test("sendFunctionResult when not connected logs warning", () => {
    const client = createRealtimeClient(logger);
    client.sendFunctionResult("call-1", "test result");
    expect(logger.warn).toHaveBeenCalled();
  });
});
