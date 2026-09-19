import { describe, expect, test, vi } from "vitest";
import { dispatchScheduledAgentChatTurn } from "./dispatch-scheduled-turn.ts";

const activityMocks = vi.hoisted(() => ({
  cancellation: new AbortController(),
  heartbeat: vi.fn(),
  runTurn: vi.fn(() => Promise.withResolvers<never>().promise),
  withAbortSignal: vi.fn(
    async <Result>(signal: AbortSignal, operation: () => Promise<Result>) => {
      const result = operation();
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      signal.throwIfAborted();
      return await result;
    },
  ),
}));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      cancellationSignal: activityMocks.cancellation.signal,
      heartbeat: activityMocks.heartbeat,
    }),
  },
}));

vi.mock("#client", () => ({
  createTemporalClient: vi.fn(() =>
    Promise.resolve({
      workflow: Object.create(null),
      withAbortSignal: activityMocks.withAbortSignal,
    }),
  ),
}));

vi.mock("#lib/agent-chat-client.ts", () => ({
  runAgentChatTurn: activityMocks.runTurn,
}));

describe("scheduled agent chat dispatch", () => {
  test("stops waiting for the receipt when the Activity is canceled", async () => {
    const dispatch = dispatchScheduledAgentChatTurn({
      config: {
        chatId: "scheduled-chat",
        title: "Scheduled chat",
        provider: "codex",
        model: "gpt-5.4",
        origin: { kind: "schedule", scheduleId: "daily-chat" },
        createdAt: "2026-09-14T20:00:00.000Z",
        maxTurnsPerMessage: 8,
      },
      request: {
        turnId: "scheduled-turn",
        prompt: "Inspect the homelab.",
        submittedAt: "2026-09-14T20:01:00.000Z",
        providerStartDeadline: "2026-09-14T21:01:00.000Z",
        source: { kind: "schedule", scheduleId: "daily-chat" },
      },
    });
    await vi.waitFor(() => {
      expect(activityMocks.runTurn).toHaveBeenCalledOnce();
    });

    activityMocks.cancellation.abort(new Error("activity canceled"));

    await expect(dispatch).rejects.toThrow("activity canceled");
    expect(activityMocks.withAbortSignal).toHaveBeenCalledWith(
      activityMocks.cancellation.signal,
      expect.any(Function),
    );
  });
});
