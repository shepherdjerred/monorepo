import {
  SlashCommandBuilder,
  type Client,
} from "discord.js";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import { enqueueJob } from "@shepherdjerred/sentinel/queue/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

export type CommandInteraction = {
  commandName: string;
  user: { id: string; tag: string };
  member: {
    roles: { cache: Map<string, { id: string }> } | string[];
  } | null;
  guildId: string | null;
  channelId: string;
  options: {
    getSubcommand: () => string;
    getString: (name: string, required?: boolean) => string | null;
  };
  deferReply: () => Promise<unknown>;
  editReply: (content: string) => Promise<unknown>;
  reply: (content: string | { content: string; ephemeral?: boolean }) => Promise<unknown>;
}

const commandLogger = logger.child({ module: "discord:commands" });

const sentinelCommand = new SlashCommandBuilder()
  .setName("sentinel")
  .setDescription("Sentinel agent management")
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("List running, pending, and recent jobs"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("approve")
      .setDescription("Approve a pending approval request")
      .addStringOption((opt) =>
        opt
          .setName("id")
          .setDescription("The approval request ID")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("deny")
      .setDescription("Deny a pending approval request")
      .addStringOption((opt) =>
        opt
          .setName("id")
          .setDescription("The approval request ID")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason for denial")
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ask")
      .setDescription("Ask the personal assistant a question")
      .addStringOption((opt) =>
        opt
          .setName("prompt")
          .setDescription("Your question")
          .setRequired(true),
      ),
  );

export async function registerCommands(
  client: Client,
  guildId: string,
): Promise<void> {
  if (client.application == null) {
    commandLogger.warn("Client application is null, cannot register commands");
    return;
  }

  try {
    await client.application.commands.set([sentinelCommand.toJSON()], guildId);
    commandLogger.info({ guildId }, "Slash commands registered");
  } catch (error: unknown) {
    commandLogger.error(error, "Failed to register slash commands");
  }
}

export async function handleInteraction(
  interaction: CommandInteraction,
  config: Config,
): Promise<void> {
  if (interaction.commandName !== "sentinel") {
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "status": {
      await handleStatus(interaction);
      break;
    }
    case "approve": {
      await handleDecision(interaction, config, "approved");
      break;
    }
    case "deny": {
      await handleDecision(interaction, config, "denied");
      break;
    }
    case "ask": {
      await handleAsk(interaction);
      break;
    }
    default: {
      await interaction.reply({
        content: `Unknown subcommand: ${subcommand}`,
        ephemeral: true,
      });
    }
  }
}

function formatJob(job: { id: string; agent: string; status: string }): string {
  return `\`${job.id.slice(0, 8)}\` **${job.agent}** (${job.status})`;
}

async function handleStatus(
  interaction: CommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const prisma = getPrisma();

  const [running, pending, recent] = await Promise.all([
    prisma.job.findMany({
      where: { status: "running" },
      orderBy: { claimedAt: "desc" },
      take: 5,
    }),
    prisma.job.findMany({
      where: { status: "pending" },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: 5,
    }),
    prisma.job.findMany({
      where: { status: { in: ["completed", "failed"] } },
      orderBy: { completedAt: "desc" },
      take: 5,
    }),
  ]);

  const sections: string[] = [];

  if (running.length > 0) {
    sections.push(`**Running (${String(running.length)})**\n${running.map((job) => formatJob(job)).join("\n")}`);
  }
  if (pending.length > 0) {
    sections.push(`**Pending (${String(pending.length)})**\n${pending.map((job) => formatJob(job)).join("\n")}`);
  }
  if (recent.length > 0) {
    sections.push(`**Recent (${String(recent.length)})**\n${recent.map((job) => formatJob(job)).join("\n")}`);
  }

  const content =
    sections.length > 0
      ? sections.join("\n\n")
      : "No jobs found.";

  await interaction.editReply(content);
}

async function handleAsk(
  interaction: CommandInteraction,
): Promise<void> {
  const prompt = interaction.options.getString("prompt");
  if (prompt == null) {
    await interaction.reply({ content: "Prompt is required.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const job = await enqueueJob({
      agent: "personal-assistant",
      prompt,
      triggerType: "discord",
      triggerSource: "slash_command",
      triggerMetadata: {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
    });

    await interaction.editReply(
      `Job enqueued (\`${job.id.slice(0, 8)}\`). I'll post the result when done.`,
    );
  } catch (error: unknown) {
    commandLogger.error(error, "Failed to enqueue ask job");
    await interaction.editReply("Failed to enqueue job. Please try again.");
  }
}

function getMemberRoleIds(
  member: NonNullable<CommandInteraction["member"]>,
): string[] {
  if ("cache" in member.roles) {
    return [...member.roles.cache.keys()];
  }
  return member.roles;
}

async function handleDecision(
  interaction: CommandInteraction,
  config: Config,
  status: "approved" | "denied",
): Promise<void> {
  const requestId = interaction.options.getString("id");
  if (requestId == null) {
    await interaction.reply({ content: "ID is required.", ephemeral: true });
    return;
  }
  const reason = interaction.options.getString("reason");

  // Check authorization — require guild context (reject DMs to prevent auth bypass)
  if (interaction.member == null) {
    await interaction.reply({
      content: "Approval decisions must be done from a server, not via DMs.",
      ephemeral: true,
    });
    return;
  }

  const approverRoleIds = config.discord?.approverRoleIds ?? [];
  if (approverRoleIds.length > 0) {
    const roles = getMemberRoleIds(interaction.member);

    const hasRole = approverRoleIds.some((roleId) =>
      roles.includes(roleId),
    );

    if (!hasRole) {
      await interaction.reply({
        content: "You do not have permission to approve or deny requests.",
        ephemeral: true,
      });
      return;
    }
  }

  const prisma = getPrisma();
  const action = status === "approved" ? "approve" : "deny";

  try {
    const result = await prisma.approvalRequest.updateMany({
      where: { id: requestId, status: "pending" },
      data: {
        status,
        decidedBy: interaction.user.id,
        decidedAt: new Date(),
        reason: reason ?? `${status} via /sentinel ${action} by ${interaction.user.tag}`,
      },
    });

    if (result.count === 0) {
      await interaction.reply({
        content: `Request \`${requestId}\` was not found or has already been decided.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply(
      `Request \`${requestId}\` has been **${status}** by ${interaction.user.tag}.`,
    );

    commandLogger.info(
      { requestId, status, decidedBy: interaction.user.id },
      `Approval request ${status} via slash command`,
    );
  } catch (error: unknown) {
    commandLogger.error(error, "Failed to process approval command");
    await interaction.reply({
      content: "An error occurred processing the decision.",
      ephemeral: true,
    });
  }
}
