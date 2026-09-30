import { beforeEach, describe, expect, test, vi } from "vitest";
import { executeDiscordAgentChatCommand } from "./discord-ingress.ts";
import { dispatchScheduledAgentChatTurn } from "./dispatch-scheduled-turn.ts";
import { executeHttpAgentChatCommand } from "./http-ingress.ts";
import { dispatchPinnedAgentChatTurn } from "./turn-receipt.ts";

const activityMocks = vi.hoisted(() => ({
  cancellation: new AbortController(),
  continueChat: vi.fn(() => Promise.withResolvers<never>().promise),
  dispatchPinned: vi.fn(() => Promise.withResolvers<never>().promise),
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
  continueAgentChat: activityMocks.continueChat,
  runAgentChatTurn: activityMocks.runTurn,
}));

vi.mock("#lib/agent-chat-receipts.ts", () => ({
  dispatchPinnedAgentChatTurn: activityMocks.dispatchPinned,
  locateAgentChatRun: vi.fn(),
}));

beforeEach(() => {
  activityMocks.cancellation = new AbortController();
  vi.clearAllMocks();
});

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

  test("stops a pinned turn dispatch when its receipt is canceled", async () => {
    const dispatch = dispatchPinnedAgentChatTurn({
      runId: "00000000-0000-4000-8000-000000000001",
      config: {
        chatId: "receipt-chat",
        title: "Receipt chat",
        provider: "claude",
        model: "claude-opus-5",
        origin: { kind: "imessage", conversationId: "chat-123" },
        createdAt: "2026-09-14T20:00:00.000Z",
        maxTurnsPerMessage: 8,
      },
      request: {
        turnId: "receipt-turn",
        prompt: "Continue the investigation.",
        submittedAt: "2026-09-14T20:01:00.000Z",
        source: { kind: "imessage", conversationId: "chat-123" },
      },
    });
    await vi.waitFor(() => {
      expect(activityMocks.dispatchPinned).toHaveBeenCalledOnce();
    });

    activityMocks.cancellation.abort(new Error("receipt canceled"));

    await expect(dispatch).rejects.toThrow("receipt canceled");
    expect(activityMocks.withAbortSignal).toHaveBeenCalledWith(
      activityMocks.cancellation.signal,
      expect.any(Function),
    );
  });
});

describe("agent chat ingress cancellation", () => {
  test.each([
    {
      name: "HTTP",
      execute: () =>
        executeHttpAgentChatCommand({
          command: {
            kind: "continue",
            chatId: "http-chat",
            request: {
              turnId: "http-turn",
              prompt: "Continue the investigation.",
              submittedAt: "2026-09-14T20:01:00.000Z",
              source: { kind: "imessage", conversationId: "chat-123" },
            },
          },
          providerStartDeadline: "2026-09-14T21:01:00.000Z",
        }),
    },
    {
      name: "Discord",
      expectedSourceSequence: "123456789012345678",
      execute: () =>
        executeDiscordAgentChatCommand({
          command: {
            kind: "continue",
            interactionId: "123456789012345678",
            channelId: "223456789012345678",
            chatId: "discord-chat",
            prompt: "Continue the investigation.",
            submittedAt: "2026-09-14T20:01:00.000Z",
          },
          providerStartDeadline: "2026-09-14T21:01:00.000Z",
        }),
    },
  ])(
    "stops the $name wait when the Activity is canceled",
    async ({ execute, expectedSourceSequence }) => {
      const execution = execute();
      await vi.waitFor(() => {
        expect(activityMocks.continueChat).toHaveBeenCalledOnce();
      });
      if (expectedSourceSequence !== undefined) {
        expect(activityMocks.continueChat).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.objectContaining({
              sourceSequence: expectedSourceSequence,
            }),
          }),
        );
      }

      activityMocks.cancellation.abort(new Error("ingress canceled"));

      await expect(execution).rejects.toThrow("ingress canceled");
      expect(activityMocks.withAbortSignal).toHaveBeenCalledWith(
        activityMocks.cancellation.signal,
        expect.any(Function),
      );
    },
  );
});
