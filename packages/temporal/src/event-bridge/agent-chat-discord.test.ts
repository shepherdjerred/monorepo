import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  type Client as TemporalClient,
} from "@temporalio/client";
import { getEventListeners } from "node:events";
import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { AgentChatCatalogEntry } from "#shared/agent/agent-chat.ts";
import type { DiscordAgentChatCommand } from "#shared/agent/agent-chat-discord.ts";
import {
  AgentChatDiscordCommandConflictError,
  agentChatDiscordCommand,
  discordAgentChatCommandFingerprint,
  formatDiscordChatList,
  handleAgentChatDiscordCommand,
  registerAgentChatDiscordCommand,
  startDiscordAgentChatCommand,
  type AgentChatDiscordOperations,
} from "./agent-chat-discord.ts";
import { startAgentChatDiscordSupervisor } from "./agent-chat-discord-supervisor.ts";

const NOW = "2026-09-14T22:00:00.000Z";
const INTERACTION_ID = "123456789012345678";
const INTERACTION_TIMESTAMP = "2015-12-07T16:13:12.216Z";
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
const ACCEPTED_COMMAND: DiscordAgentChatCommand = {
  kind: "new",
  interactionId: INTERACTION_ID,
  channelId: CHANNEL_ID,
  provider: "codex",
  prompt: "Inspect the current branch.",
  title: "Inspect the current branch.",
  model: "gpt-5.6-luna",
  submittedAt: INTERACTION_TIMESTAMP,
};

function fakeTemporalClient(
  workflowStart?: unknown,
  workflowGetHandle?: unknown,
): TemporalClient {
  const client = Object.create(null);
  client.workflow = Object.create(null);
  if (workflowStart !== undefined) {
    client.workflow.start = workflowStart;
  }
  if (workflowGetHandle !== undefined) {
    client.workflow.getHandle = workflowGetHandle;
  }
  return client;
}

function operations(): AgentChatDiscordOperations {
  return {
    start: vi.fn(() => Promise.resolve()),
    list: vi.fn(async () => [ENTRY]),
    get: vi.fn(async () => ENTRY),
    register: vi.fn(async () => ENTRY),
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

it("rejects a redelivery whose resolved command changed", async () => {
  const temporal = fakeTemporalClient(
    vi.fn(() =>
      Promise.reject(
        new WorkflowExecutionAlreadyStartedError(
          "already accepted",
          `discord-agent-chat/${INTERACTION_ID}`,
          "discordAgentChatWorkflow",
        ),
      ),
    ),
    vi.fn(() => ({
      describe: vi.fn(async () => ({
        memo: {
          agentChatCommandFingerprint:
            discordAgentChatCommandFingerprint(ACCEPTED_COMMAND),
        },
      })),
    })),
  );
  const changed = { ...ACCEPTED_COMMAND, model: "gpt-5.6-terra" };

  await expect(
    startDiscordAgentChatCommand(temporal, changed),
  ).rejects.toBeInstanceOf(AgentChatDiscordCommandConflictError);
});

it("accepts a fresh Discord workflow without another Temporal lookup", async () => {
  const describeWorkflow = vi.fn(() =>
    Promise.reject(new Error("lookup outage")),
  );
  const start = vi.fn(async () => ({ describe: describeWorkflow }));
  const temporal = fakeTemporalClient(start);

  await expect(
    startDiscordAgentChatCommand(temporal, ACCEPTED_COMMAND),
  ).resolves.toBeUndefined();
  expect(describeWorkflow).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledWith(
    "discordAgentChatWorkflow",
    expect.objectContaining({
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
    }),
  );
});

describe("agent chat Discord ingress", () => {
  it("retries Discord startup without blocking gateway readiness", async () => {
    const connected = { close: vi.fn(() => Promise.resolve()) };
    let supervisorSignal: AbortSignal | undefined;
    let startAttempts = 0;
    const start = vi.fn((_temporal: TemporalClient, signal: AbortSignal) => {
      supervisorSignal = signal;
      startAttempts += 1;
      return startAttempts === 1
        ? Promise.reject(new Error("Discord unavailable"))
        : Promise.resolve(connected);
    });

    const supervisor = startAgentChatDiscordSupervisor(fakeTemporalClient(), {
      start,
      initialRetryDelayMs: 1,
      maximumRetryDelayMs: 1,
    });

    expect(start).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
    });
    expect(supervisorSignal).toBeDefined();
    if (supervisorSignal === undefined) {
      throw new Error("Discord supervisor did not provide an abort signal");
    }
    expect(getEventListeners(supervisorSignal, "abort")).toHaveLength(0);
    await supervisor.close();
    expect(connected.close).toHaveBeenCalledOnce();
  });

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

  it("contains a second Discord failure while reporting a command error", async () => {
    const deps = operations();
    const fake = fakeInteraction({ subcommand: "list" });
    fake.deferReply.mockRejectedValueOnce(new Error("Discord unavailable"));
    fake.editReply.mockRejectedValueOnce(new Error("No acknowledgement"));

    await expect(
      handleAgentChatDiscordCommand(
        fakeTemporalClient(),
        fake.interaction,
        deps,
      ),
    ).resolves.toBeUndefined();

    expect(fake.editReply).toHaveBeenCalledOnce();
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
    expect(deps.register).toHaveBeenCalledOnce();
    expect(deps.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "discord", channelId: CHANNEL_ID },
      `chat-discord-${INTERACTION_ID}`,
      {
        updatedAt: INTERACTION_TIMESTAMP,
        sourceSequence: INTERACTION_ID,
      },
    );
    expect(vi.mocked(deps.start).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.register).mock.invocationCallOrder[0] ?? 0,
    );
    expect(vi.mocked(deps.register).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.bind).mock.invocationCallOrder[0] ?? 0,
    );
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
        submittedAt: INTERACTION_TIMESTAMP,
      }),
    );
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.get).toHaveBeenCalledWith(expect.anything(), "scheduled-chat");
    expect(deps.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "discord", channelId: CHANNEL_ID },
      "scheduled-chat",
      {
        updatedAt: INTERACTION_TIMESTAMP,
        sourceSequence: INTERACTION_ID,
      },
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

describe("accepted Discord command recovery", () => {
  it("acknowledges a new chat when its catalog checkpoint fails", async () => {
    const deps = operations();
    deps.register = vi
      .fn<AgentChatDiscordOperations["register"]>()
      .mockRejectedValue(new Error("catalog unavailable"));
    const fake = fakeInteraction({
      subcommand: "new",
      strings: { provider: "codex", prompt: "Inspect the branch." },
    });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(deps.start).toHaveBeenCalledOnce();
    expect(deps.bind).not.toHaveBeenCalled();
    expect(fake.editReply).toHaveBeenCalledWith({
      content: "Queued. I’ll post the durable agent response in this channel.",
      allowedMentions: { parse: [] },
    });
  });

  it("acknowledges an explicit continuation when rebinding fails", async () => {
    const deps = operations();
    deps.bind = vi
      .fn<AgentChatDiscordOperations["bind"]>()
      .mockRejectedValue(new Error("catalog unavailable"));
    const fake = fakeInteraction({
      subcommand: "continue",
      strings: { chat: "scheduled-chat", prompt: "Continue the work." },
    });

    await handleAgentChatDiscordCommand(
      fakeTemporalClient(),
      fake.interaction,
      deps,
    );

    expect(deps.start).toHaveBeenCalledOnce();
    expect(fake.editReply).toHaveBeenCalledWith({
      content: "Queued. I’ll post the durable agent response in this channel.",
      allowedMentions: { parse: [] },
    });
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

  it("orders chats by timestamp instant across UTC offsets", () => {
    const content = formatDiscordChatList([
      {
        ...ENTRY,
        config: { ...ENTRY.config, chatId: "later", title: "Later chat" },
        updatedAt: "2026-09-14T23:00:00-10:00",
      },
      {
        ...ENTRY,
        config: { ...ENTRY.config, chatId: "earlier", title: "Earlier chat" },
        updatedAt: "2026-09-15T01:00:00+10:00",
      },
    ]);

    expect(content.indexOf("Later chat")).toBeLessThan(
      content.indexOf("Earlier chat"),
    );
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
