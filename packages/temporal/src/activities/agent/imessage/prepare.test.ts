import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  resolve: vi.fn(),
  bind: vi.fn(),
  list: vi.fn(),
  config: vi.fn(),
}));
vi.mock("#client", () => ({
  createTemporalClient: () => Promise.resolve({ workflow: {} }),
}));
vi.mock("#config/imessage.ts", () => ({ imessageIngressConfig: mocks.config }));
vi.mock("#lib/agent-chat-client.ts", () => ({
  getAgentChat: mocks.get,
  resolveAgentChatBinding: mocks.resolve,
  bindAgentChat: mocks.bind,
  listAgentChats: mocks.list,
}));
import { prepareImessageCommand } from "./prepare.ts";
import type { ImessageCommand } from "#shared/agent/agent-chat-imessage.ts";
const BASE = {
  messageId: "message-guid",
  conversationId: "owner-dm",
  submittedAt: "2026-09-17T00:00:00.000Z",
  sourceSequence: 42,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockResolvedValue({
    claudeModel: "claude-fixed",
    codexModel: "codex-fixed",
  });
});
describe("iMessage chat preparation", () => {
  test.each(["claude", "codex"] as const)(
    "freezes identity, provider and model before dispatch: %s",
    async (provider) => {
      const command: ImessageCommand = {
        ...BASE,
        action: { kind: "new", provider, prompt: "investigate" },
      };
      const prepared = await prepareImessageCommand(command);
      expect(prepared).toMatchObject({
        kind: "turn",
        command: {
          kind: "new",
          config: {
            provider,
            model: `${provider}-fixed`,
            createdAt: BASE.submittedAt,
            origin: { kind: "imessage", conversationId: BASE.conversationId },
          },
          request: { prompt: "investigate", submittedAt: BASE.submittedAt },
        },
      });
      expect(await prepareImessageCommand(command)).toEqual(prepared);
    },
  );
  test("continues any explicit previous chat without resolving the current binding", async () => {
    mocks.get.mockResolvedValue({ config: { chatId: "scheduled-chat" } });
    expect(
      await prepareImessageCommand({
        ...BASE,
        action: {
          kind: "continue",
          chatId: "scheduled-chat",
          prompt: "continue",
        },
      }),
    ).toMatchObject({
      kind: "turn",
      command: { kind: "continue", chatId: "scheduled-chat" },
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  test("freezes the current chat selection into the dispatched command", async () => {
    mocks.resolve.mockResolvedValue({ config: { chatId: "discord-chat" } });
    expect(
      await prepareImessageCommand({
        ...BASE,
        action: { kind: "continue", prompt: "continue" },
      }),
    ).toMatchObject({ kind: "turn", command: { chatId: "discord-chat" } });
  });
  test("selects an existing chat using the original message timestamp", async () => {
    mocks.get.mockResolvedValue({ config: { chatId: "scheduled-chat" } });
    expect(
      await prepareImessageCommand({
        ...BASE,
        action: { kind: "use", chatId: "scheduled-chat" },
      }),
    ).toMatchObject({ kind: "message" });
    expect(mocks.bind).toHaveBeenCalledWith(
      {},
      { kind: "imessage", conversationId: "owner-dm" },
      "scheduled-chat",
      {
        updatedAt: BASE.submittedAt,
        sourceSequence: BASE.sourceSequence,
      },
    );
  });
  test("sorts recent chats by instant across timestamp offsets", async () => {
    mocks.list.mockResolvedValue([
      {
        config: { chatId: "older", provider: "claude", title: "Older" },
        updatedAt: "2026-01-01T00:00:00+05:00",
      },
      {
        config: { chatId: "newer", provider: "codex", title: "Newer" },
        updatedAt: "2025-12-31T20:00:00Z",
      },
    ]);
    const result = await prepareImessageCommand({
      ...BASE,
      action: { kind: "list" },
    });
    expect(result).toMatchObject({
      kind: "message",
      content: "newer — codex: Newer\nolder — claude: Older",
    });
  });
  test("returns useful user errors without executing or rebinding unknown chats", async () => {
    mocks.get.mockResolvedValue(undefined);
    const result = await prepareImessageCommand({
      ...BASE,
      action: { kind: "use", chatId: "missing" },
    });
    expect(result).toMatchObject({
      kind: "message",
      content: expect.stringContaining("Unknown chat"),
    });
    expect(mocks.bind).not.toHaveBeenCalled();
  });
});
