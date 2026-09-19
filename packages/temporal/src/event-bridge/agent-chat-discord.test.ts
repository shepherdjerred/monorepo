import type { Client as TemporalClient } from "@temporalio/client";
import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { AgentChatCatalogEntry } from "#shared/agent/agent-chat.ts";
import {
  agentChatDiscordCommand,
  formatDiscordChatList,
  handleAgentChatDiscordCommand,
  registerAgentChatDiscordCommand,
  type AgentChatDiscordOperations,
} from "./agent-chat-discord.ts";

const NOW = "2026-09-14T22:00:00.000Z";
const INTERACTION_ID = "123456789012345678";
const CHANNEL_ID = "223456789012345678";
const OWNER_ID = "323456789012345678";
const ENTRY: AgentChatCatalogEntry = {
  schemaVersion: 1,
  config: {
    chatId: "scheduled-chat",
    title: "Scheduled review",
    provider: "claude",
    model: "claude-opus-5",
    origin: { kind: "schedule", scheduleId: "daily-review" },
    createdAt: NOW,
    maxTurnsPerMessage: 24,
  },
  updatedAt: NOW,
  turnCount: 4,
};

function fakeTemporalClient(): TemporalClient {
  const client = Object.create(null);
  client.workflow = Object.create(null);
  return client;
}

function operations(): AgentChatDiscordOperations {
  return {
    start: vi.fn(() => Promise.resolve()),
    list: vi.fn(async () => [ENTRY]),
    get: vi.fn(async () => ENTRY),
    bind: vi.fn(async () => ENTRY),
    resolve: vi.fn(async () => ENTRY),
    defaultModel: vi.fn(async (provider) =>
      provider === "claude" ? "claude-opus-5" : "gpt-5.6-luna",
    ),
  };
}

function fakeInteraction(input: {
  subcommand: "new" | "continue" | "list";
  strings?: Record<string, string>;
  userId?: string;
}): {
  interaction: ChatInputCommandInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
} {
  const interaction = Object.create(null);
  const deferReply = vi.fn(() => Promise.resolve(null));
  const editReply = vi.fn(() => Promise.resolve(null));
  const reply = vi.fn(() => Promise.resolve(null));
  interaction.id = INTERACTION_ID;
  interaction.commandName = "agent";
  interaction.channelId = CHANNEL_ID;
  interaction.channel = null;
  interaction.guild = { ownerId: OWNER_ID };
  interaction.user = { id: input.userId ?? OWNER_ID };
  interaction.options = {
    getSubcommand: () => input.subcommand,
    getString: (name: string, required?: boolean) => {
      const value = input.strings?.[name] ?? null;
      if (required === true && value === null) {
        throw new Error(`Missing required option ${name}`);
      }
      return value;
    },
  };
  interaction.deferReply = deferReply;
  interaction.editReply = editReply;
  interaction.reply = reply;
  return { interaction, deferReply, editReply, reply };
}

describe("agent chat Discord ingress", () => {
  it("fails startup when slash-command registration fails", async () => {
    const failure = new Error("Discord unavailable");
    const set = vi.fn(() => Promise.reject(failure));

    await expect(
      registerAgentChatDiscordCommand({
        id: "application-1",
        commands: { set },
      }),
    ).rejects.toBe(failure);
    expect(set).toHaveBeenCalledWith([agentChatDiscordCommand]);
  });

  it("preserves emoji at generated title truncation boundaries", async () => {
    const deps = operations();
    const prefix = "a".repeat(76);
    const fake = fakeInteraction({
      subcommand: "new",
      strings: { provider: "codex", prompt: `${prefix}😀tail` },
    });
    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );
    expect(deps.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: `${prefix}...` }),
    );
  });
  it("registers an administrator-only slash command", () => {
    const command = agentChatDiscordCommand.toJSON();

    expect(command.name).toBe("agent");
    expect(command.default_member_permissions).toBe(
      PermissionFlagsBits.Administrator.toString(),
    );
    expect(command.options?.map((option) => option.name)).toEqual([
      "new",
      "continue",
      "list",
    ]);
  });

  it("starts a durable workflow for a new Codex chat", async () => {
    const deps = operations();
    const fake = fakeInteraction({
      subcommand: "new",
      strings: {
        provider: "codex",
        prompt: "Inspect the current branch.",
      },
    });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(deps.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "new",
        interactionId: INTERACTION_ID,
        channelId: CHANNEL_ID,
        provider: "codex",
        model: "gpt-5.6-luna",
        prompt: "Inspect the current branch.",
      }),
    );
    expect(fake.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(fake.editReply).toHaveBeenCalledWith({
      content: "Queued. I’ll post the durable agent response in this channel.",
      allowedMentions: { parse: [] },
    });
    expect(deps.defaultModel).toHaveBeenCalledWith("codex");
  });

  it("keeps an explicit model override", async () => {
    const deps = operations();
    const fake = fakeInteraction({
      subcommand: "new",
      strings: {
        provider: "claude",
        prompt: "Inspect the current branch.",
        model: "claude-sonnet-5",
      },
    });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(deps.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "claude-sonnet-5" }),
    );
    expect(deps.defaultModel).not.toHaveBeenCalled();
  });

  it("starts a durable workflow to continue any catalog chat", async () => {
    const deps = operations();
    const fake = fakeInteraction({
      subcommand: "continue",
      strings: {
        chat: "scheduled-chat",
        prompt: "Follow that thread.",
      },
    });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(deps.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "continue",
        chatId: "scheduled-chat",
        channelId: CHANNEL_ID,
        prompt: "Follow that thread.",
      }),
    );
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.get).toHaveBeenCalledWith(expect.anything(), "scheduled-chat");
    expect(deps.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "discord", channelId: CHANNEL_ID },
      "scheduled-chat",
      expect.any(String),
    );
    expect(vi.mocked(deps.start).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.bind).mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe("explicit Discord chat selection", () => {
  it("rejects an unknown explicit chat before durable submission", async () => {
    const deps = operations();
    deps.get = vi
      .fn<AgentChatDiscordOperations["get"]>()
      .mockResolvedValue(undefined);
    const fake = fakeInteraction({
      subcommand: "continue",
      strings: { chat: "missing-chat", prompt: "Continue" },
    });
    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );
    expect(deps.start).not.toHaveBeenCalled();
    expect(fake.editReply).toHaveBeenCalledWith({
      content: "Unknown durable agent chat: missing-chat",
      allowedMentions: { parse: [] },
    });
  });

  it("rejects an invalid explicit chat before lookup or submission", async () => {
    const deps = operations();
    const fake = fakeInteraction({
      subcommand: "continue",
      strings: { chat: " bad chat", prompt: "Continue" },
    });
    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );
    expect(deps.get).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
    expect(fake.editReply).toHaveBeenCalledOnce();
  });
});

describe("Discord channel conversations", () => {
  it("resolves this channel's active chat before durable submission", async () => {
    const deps = operations();
    const fake = fakeInteraction({
      subcommand: "continue",
      strings: { prompt: "Follow the active thread." },
    });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(deps.resolve).toHaveBeenCalledWith(expect.anything(), {
      kind: "discord",
      channelId: CHANNEL_ID,
    });
    expect(deps.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "continue",
        chatId: ENTRY.config.chatId,
        channelId: CHANNEL_ID,
        prompt: "Follow the active thread.",
      }),
    );
    expect(deps.bind).not.toHaveBeenCalled();
  });

  it("lists scheduled and ingress-origin chats ephemerally", async () => {
    const deps = operations();
    const fake = fakeInteraction({ subcommand: "list" });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(fake.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(fake.editReply).toHaveBeenCalledWith({
      content: "`scheduled-chat` — Scheduled review (claude, 4 turns)",
      allowedMentions: { parse: [] },
    });
  });

  it("keeps a long catalog listing within Discord's message limit", () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      ...ENTRY,
      config: {
        ...ENTRY.config,
        chatId: `chat-${String(index)}`,
        title: `Chat ${String(index)} ${"x".repeat(180)}`,
      },
      updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    }));

    const content = formatDiscordChatList(entries);

    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain("more.");
  });

  it("denies non-owners even when Discord exposes the command", async () => {
    const deps = operations();
    const fake = fakeInteraction({
      subcommand: "list",
      userId: "423456789012345678",
    });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(fake.reply).toHaveBeenCalledWith({
      content: "Only the server owner can use durable agent chats.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    expect(deps.list).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
  });
});
