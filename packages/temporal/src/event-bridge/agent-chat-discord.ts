import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type Client as TemporalClient,
} from "@temporalio/client";
import * as Sentry from "@sentry/bun";
import {
  ApplicationIntegrationType,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  AgentChatBindingNotFoundError,
  AgentChatNotFoundError,
  bindAgentChat,
  getAgentChat,
  listAgentChats,
  registerAgentChat,
  resolveAgentChatBinding,
} from "#lib/agent-chat-client.ts";
import { discordAgentChatDefaultModel } from "#config/agent-chat.ts";
import type {
  AgentChatCatalogEntry,
  AgentChatBinding,
  AgentChatConfig,
  AgentChatProvider,
} from "#shared/agent/agent-chat.ts";
import { AgentChatIdSchema } from "#shared/agent/agent-chat.ts";
import {
  DISCORD_MESSAGE_LIMIT,
  DiscordAgentChatCommandSchema,
  discordAgentChatConfig,
  type DiscordAgentChatCommand,
} from "#shared/agent/agent-chat-discord.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const COMPONENT = "agent-chat-discord";
type DiscordAgentChatBinding = Extract<AgentChatBinding, { kind: "discord" }>;

export const agentChatDiscordCommand = new SlashCommandBuilder()
  .setName("agent")
  .setDescription("Start or continue a durable agent chat")
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((command) =>
    command
      .setName("new")
      .setDescription("Start a new durable chat in this channel")
      .addStringOption((option) =>
        option
          .setName("provider")
          .setDescription("Agent provider")
          .setRequired(true)
          .addChoices(
            { name: "Claude Code", value: "claude" },
            { name: "Codex", value: "codex" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("prompt")
          .setDescription("The first message")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(4000),
      )
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Optional catalog title")
          .setMinLength(1)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName("model")
          .setDescription("Optional provider model override")
          .setMinLength(1)
          .setMaxLength(200),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("continue")
      .setDescription("Continue this channel's active chat or select any chat")
      .addStringOption((option) =>
        option
          .setName("prompt")
          .setDescription("The next message")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(4000),
      )
      .addStringOption((option) =>
        option
          .setName("chat")
          .setDescription(
            "Catalog chat ID; omitted means this channel's active chat",
          )
          .setMinLength(1)
          .setMaxLength(128),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("list")
      .setDescription("List recent durable chats that can be continued"),
  );

export type AgentChatDiscordHandle = {
  close: () => Promise<void>;
};

export type AgentChatDiscordOperations = {
  start: (
    temporal: TemporalClient,
    command: DiscordAgentChatCommand,
  ) => Promise<void>;
  list: (
    client: TemporalClient["workflow"],
  ) => Promise<AgentChatCatalogEntry[]>;
  get: (
    client: TemporalClient["workflow"],
    chatId: string,
  ) => Promise<AgentChatCatalogEntry | undefined>;
  register: (
    client: TemporalClient["workflow"],
    config: AgentChatConfig,
  ) => Promise<AgentChatCatalogEntry>;
  bind: (
    client: TemporalClient["workflow"],
    binding: DiscordAgentChatBinding,
    chatId: string,
    updatedAt: string,
  ) => Promise<AgentChatCatalogEntry>;
  resolve: (
    client: TemporalClient["workflow"],
    binding: DiscordAgentChatBinding,
  ) => Promise<AgentChatCatalogEntry | undefined>;
  defaultModel: (provider: AgentChatProvider) => Promise<string>;
};

const defaultOperations: AgentChatDiscordOperations = {
  start: async (temporal, command) => {
    await temporal.workflow.start("discordAgentChatWorkflow", {
      workflowId: `discord-agent-chat/${command.interactionId}`,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [command],
    });
  },
  list: listAgentChats,
  get: getAgentChat,
  register: registerAgentChat,
  bind: bindAgentChat,
  resolve: resolveAgentChatBinding,
  defaultModel: discordAgentChatDefaultModel,
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

export function discordBinding(
  interaction: ChatInputCommandInteraction,
): DiscordAgentChatBinding {
  const channel = interaction.channel;
  if (channel?.isThread() === true) {
    return {
      kind: "discord",
      channelId: channel.parentId ?? channel.id,
      threadId: channel.id,
    };
  }
  return { kind: "discord", channelId: interaction.channelId };
}

function generatedTitle(prompt: string): string {
  const singleLine = prompt.replaceAll(/\s+/g, " ").trim();
  if (singleLine.length <= 80) return singleLine;
  let title = "";
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segments.segment(singleLine)) {
    if (title.length + segment.length > 77) break;
    title += segment;
  }
  return `${title}...`;
}

function discordInteractionTimestamp(interactionId: string): string {
  const discordEpoch = 1_420_070_400_000n;
  return new Date(
    Number((BigInt(interactionId) >> 22n) + discordEpoch),
  ).toISOString();
}

async function handleNew(
  temporal: TemporalClient,
  interaction: ChatInputCommandInteraction,
  operations: AgentChatDiscordOperations,
): Promise<void> {
  const rawProvider = interaction.options.getString("provider", true);
  if (rawProvider !== "claude" && rawProvider !== "codex") {
    throw new Error(`Unsupported agent provider: ${rawProvider}`);
  }
  const provider: AgentChatProvider = rawProvider;
  const prompt = interaction.options.getString("prompt", true);
  const model =
    interaction.options.getString("model") ??
    (await operations.defaultModel(provider));
  const timestamp = discordInteractionTimestamp(interaction.id);
  const source = discordBinding(interaction);
  const command = DiscordAgentChatCommandSchema.parse({
    kind: "new",
    interactionId: interaction.id,
    channelId: source.channelId,
    ...(source.threadId === undefined ? {} : { threadId: source.threadId }),
    provider,
    prompt,
    title: interaction.options.getString("title") ?? generatedTitle(prompt),
    model,
    submittedAt: timestamp,
  });
  if (command.kind !== "new") throw new Error("Expected a new chat command");
  await operations.start(temporal, command);
  const config = discordAgentChatConfig(command);
  await operations.register(temporal.workflow, config);
  await operations.bind(
    temporal.workflow,
    source,
    config.chatId,
    command.submittedAt,
  );
  await interaction.editReply({
    content: "Queued. I’ll post the durable agent response in this channel.",
    allowedMentions: { parse: [] },
  });
}

async function handleContinue(
  temporal: TemporalClient,
  interaction: ChatInputCommandInteraction,
  operations: AgentChatDiscordOperations,
): Promise<void> {
  const source = discordBinding(interaction);
  const rawChatId = interaction.options.getString("chat");
  const explicitChatId =
    rawChatId === null ? undefined : AgentChatIdSchema.parse(rawChatId);
  const resolved =
    explicitChatId === undefined
      ? await operations.resolve(temporal.workflow, source)
      : await operations.get(temporal.workflow, explicitChatId);
  if (explicitChatId !== undefined && resolved === undefined) {
    throw new AgentChatNotFoundError(explicitChatId);
  }
  const chatId = explicitChatId ?? resolved?.config.chatId;
  if (chatId === undefined) {
    throw new AgentChatBindingNotFoundError();
  }
  const timestamp = new Date().toISOString();
  await operations.start(
    temporal,
    DiscordAgentChatCommandSchema.parse({
      kind: "continue",
      interactionId: interaction.id,
      channelId: source.channelId,
      ...(source.threadId === undefined ? {} : { threadId: source.threadId }),
      chatId,
      prompt: interaction.options.getString("prompt", true),
      submittedAt: timestamp,
    }),
  );
  if (explicitChatId !== undefined) {
    await operations.bind(temporal.workflow, source, chatId, timestamp);
  }
  await interaction.editReply({
    content: "Queued. I’ll post the durable agent response in this channel.",
    allowedMentions: { parse: [] },
  });
}

export function formatDiscordChatList(
  entries: readonly AgentChatCatalogEntry[],
): string {
  const selected = entries
    .toSorted((left, right) => {
      const chronological =
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return chronological === 0
        ? left.config.chatId.localeCompare(right.config.chatId)
        : chronological;
    })
    .slice(0, 20);
  if (selected.length === 0) return "No durable agent chats exist yet.";

  const lines: string[] = [];
  for (const entry of selected) {
    const title = entry.config.title.replaceAll(/\s+/g, " ").trim();
    const line = `\`${entry.config.chatId}\` — ${title} (${entry.config.provider}, ${String(entry.turnCount)} turns)`;
    if ([...lines, line].join("\n").length > DISCORD_MESSAGE_LIMIT) break;
    lines.push(line);
  }

  let omitted = entries.length - lines.length;
  while (omitted > 0) {
    const suffix = `… and ${String(omitted)} more.`;
    if ([...lines, suffix].join("\n").length <= DISCORD_MESSAGE_LIMIT) {
      lines.push(suffix);
      break;
    }
    if (lines.pop() === undefined) return suffix;
    omitted += 1;
  }
  return lines.join("\n");
}

async function handleList(
  temporal: TemporalClient,
  interaction: ChatInputCommandInteraction,
  operations: AgentChatDiscordOperations,
): Promise<void> {
  const entries = await operations.list(temporal.workflow);
  await interaction.editReply({
    content: formatDiscordChatList(entries),
    allowedMentions: { parse: [] },
  });
}

export async function handleAgentChatDiscordCommand(
  temporal: TemporalClient,
  interaction: ChatInputCommandInteraction,
  operations: AgentChatDiscordOperations = defaultOperations,
): Promise<void> {
  if (interaction.commandName !== "agent") return;
  let subcommand: string | undefined;
  try {
    subcommand = interaction.options.getSubcommand();
    if (interaction.guild?.ownerId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the server owner can use durable agent chats.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (subcommand === "new") {
      await handleNew(temporal, interaction, operations);
      return;
    }
    if (subcommand === "continue") {
      await handleContinue(temporal, interaction, operations);
      return;
    }
    if (subcommand === "list") {
      await handleList(temporal, interaction, operations);
      return;
    }
    throw new Error(`Unsupported /agent subcommand: ${subcommand}`);
  } catch (error: unknown) {
    Sentry.withScope((scope) => {
      scope.setTag("component", COMPONENT);
      scope.setContext("discordInteraction", {
        interactionId: interaction.id,
        channelId: interaction.channelId,
        subcommand,
      });
      Sentry.captureException(error);
    });
    const message =
      error instanceof Error ? error.message : "The agent chat request failed.";
    try {
      await interaction.editReply({
        content: message,
        allowedMentions: { parse: [] },
      });
    } catch (responseError: unknown) {
      Sentry.withScope((scope) => {
        scope.setTag("component", COMPONENT);
        scope.setTag("operation", "report-command-failure");
        scope.setContext("discordInteraction", {
          interactionId: interaction.id,
          channelId: interaction.channelId,
          subcommand,
        });
        Sentry.captureException(responseError);
      });
      jsonLog("error", "Failed to report Discord agent chat error", {
        interactionId: interaction.id,
        error:
          responseError instanceof Error
            ? responseError.message
            : String(responseError),
      });
    }
  }
}

type DiscordCommandApplication = {
  id: string;
  commands: {
    set: (
      commands: readonly (typeof agentChatDiscordCommand)[],
    ) => Promise<unknown>;
  };
};

export async function registerAgentChatDiscordCommand(
  application: DiscordCommandApplication,
): Promise<void> {
  try {
    await application.commands.set([agentChatDiscordCommand]);
    jsonLog("info", "Registered global /agent command", {
      applicationId: application.id,
    });
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog("error", "Failed to register global /agent command", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function handleDiscordInteractionSafely(
  temporal: TemporalClient,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await handleAgentChatDiscordCommand(temporal, interaction);
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog("error", "Unhandled Discord agent chat command failure", {
      interactionId: interaction.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startAgentChatDiscordBot(
  temporal: TemporalClient,
): Promise<AgentChatDiscordHandle | undefined> {
  const token = Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
  if (token === undefined || token === "") {
    jsonLog(
      "warning",
      "AGENT_CHAT_DISCORD_TOKEN not set; skipping Discord ingress",
    );
    return undefined;
  }
  const discord = new Client({ intents: [GatewayIntentBits.Guilds] });
  discord.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) {
      void handleDiscordInteractionSafely(temporal, interaction);
    }
  });
  const ready = new Promise<Client<true>>((resolve) => {
    discord.once(Events.ClientReady, resolve);
  });
  try {
    await discord.login(token);
    const readyClient = await ready;
    await registerAgentChatDiscordCommand(readyClient.application);
  } catch (error: unknown) {
    await discord.destroy();
    throw error;
  }
  jsonLog("info", "Dedicated durable agent Discord ingress connected");
  return {
    async close() {
      await discord.destroy();
      jsonLog("info", "Dedicated durable agent Discord ingress stopped");
    },
  };
}
