import { describe, expect, test, vi } from "vitest";
import {
  createAgentSecretRefreshHandler,
  createTemporalAgentEventHandler,
} from "./callbacks.ts";

describe("createAgentSecretRefreshHandler", () => {
  test("reports refresh success without exposing the credential", async () => {
    const refresh = vi.fn(() => Promise.resolve());

    await expect(createAgentSecretRefreshHandler(refresh)()).resolves.toBe(
      true,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("turns refresh failures into a rejected-event signal", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("vault unavailable");
    });

    await expect(createAgentSecretRefreshHandler(refresh)()).resolves.toBe(
      false,
    );
  });
});

describe("createTemporalAgentEventHandler", () => {
  test("heartbeats progress and forwards the event", () => {
    const heartbeat = vi.fn();
    const logEvent = vi.fn();
    const handler = createTemporalAgentEventHandler({
      nextEventCount: () => 7,
      heartbeat,
      logEvent,
    });
    const event = { type: "turn.completed", elapsedMs: 120, idleMs: 45 };

    handler(event);

    expect(heartbeat).toHaveBeenCalledWith({
      phase: "codex-agent-sdk",
      elapsedMs: 120,
      idleMs: 45,
      eventCount: 7,
      eventType: "turn.completed",
    });
    expect(logEvent).toHaveBeenCalledWith(event);
  });
});
