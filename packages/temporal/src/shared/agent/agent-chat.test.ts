import { describe, expect, test } from "vitest";
import {
  AgentChatConfigSchema,
  AgentChatTurnRequestSchema,
  AgentChatWorkflowStateSchema,
  MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES,
  agentChatTurnRequestsMatch,
  agentChatBindingKey,
  agentChatWorkflowId,
  boundAgentChatFailureMessage,
} from "./agent-chat.ts";

const CONFIG = {
  chatId: "chat-123",
  title: "Morning infrastructure review",
  provider: "claude",
  model: "claude-opus-4-1",
  origin: { kind: "schedule", scheduleId: "morning-review" },
  createdAt: "2026-09-14T16:00:00.000Z",
};

describe("agent chat contract", () => {
  test("defaults the bounded per-message turn budget", () => {
    expect(AgentChatConfigSchema.parse(CONFIG).maxTurnsPerMessage).toBe(24);
  });

  test("rejects a restored state whose active and queued turns are malformed", () => {
    expect(() =>
      AgentChatWorkflowStateSchema.parse({
        schemaVersion: 1,
        config: CONFIG,
        nextTurnNumber: 1,
        activeTurnId: "",
        queuedTurnIds: [],
        recentTurns: [],
      }),
    ).toThrow();
  });

  test("rejects resumable state without its durable manifest checkpoint", () => {
    expect(() =>
      AgentChatWorkflowStateSchema.parse({
        schemaVersion: 1,
        config: CONFIG,
        providerSessionId: "session-1",
        nextTurnNumber: 2,
        queuedTurnIds: [],
        recentTurns: [],
      }),
    ).toThrow("manifest key");
  });

  test("builds stable workflow and cross-ingress binding keys", () => {
    expect(agentChatWorkflowId("chat-123")).toBe("agent-chat/chat-123");
    expect(
      agentChatBindingKey({ kind: "imessage", conversationId: "chat-guid" }),
    ).toBe("imessage:chat-guid");
    expect(
      agentChatBindingKey({
        kind: "discord",
        channelId: "123",
        threadId: "456",
      }),
    ).toBe("discord:123:456");
  });

  test("rejects chat ids that could escape an object or workspace prefix", () => {
    expect(() => agentChatWorkflowId("../escape")).toThrow();
  });

  test("bounds turn text by UTF-8 bytes rather than JavaScript characters", () => {
    expect(() =>
      AgentChatTurnRequestSchema.parse({
        turnId: "multibyte",
        prompt: "🧪".repeat(60_000),
        submittedAt: "2026-09-14T16:01:00.000Z",
        source: { kind: "discord", channelId: "channel-1" },
      }),
    ).toThrow("UTF-8 bytes");
  });

  test("bounds retained failure messages without splitting UTF-8", () => {
    const bounded = boundAgentChatFailureMessage("🧪".repeat(10_000));

    expect(new TextEncoder().encode(bounded).byteLength).toBeLessThanOrEqual(
      MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES,
    );
    expect(bounded.endsWith("🧪")).toBe(true);
  });

  test("does not treat caller deadlines as stable turn identity", () => {
    const original = AgentChatTurnRequestSchema.parse({
      turnId: "stable-turn",
      prompt: "inspect",
      submittedAt: "2026-09-14T16:01:00.000Z",
      providerStartDeadline: "2026-09-14T17:01:00.000Z",
      source: { kind: "discord", channelId: "channel-1" },
    });

    expect(
      agentChatTurnRequestsMatch(original, {
        ...original,
        providerStartDeadline: "2026-09-14T18:01:00.000Z",
      }),
    ).toBe(true);
  });
});
