import {
  SlashCommandBuilder,
  type Client,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

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
  interaction: ChatInputCommandInteraction,
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
  interaction: ChatInputCommandInteraction,
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

function getMemberRoleIds(
  member: NonNullable<ChatInputCommandInteraction["member"]>,
): string[] {
  if ("cache" in member.roles) {
    return [...member.roles.cache.keys()];
  }
  return member.roles;
}

async function handleDecision(
  interaction: ChatInputCommandInteraction,
  config: Config,
  status: "approved" | "denied",
): Promise<void> {
  const requestId = interaction.options.getString("id", true);
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
