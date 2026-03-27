import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ButtonInteraction,
} from "discord.js";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import { getDiscordClient } from "./client.ts";
import { getConfig } from "@shepherdjerred/sentinel/config/index.ts";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

const approvalLogger = logger.child({ module: "discord:approvals" });

type ApprovalNotificationParams = {
  requestId: string;
  agent: string;
  toolName: string;
  toolInput: string;
  expiresAt: Date;
};

const MAX_EMBED_FIELD_LENGTH = 1024;
const CODE_BLOCK_OVERHEAD = 11; // ```json\n...\n```

function formatToolInput(toolInput: string): string {
  const maxContent = MAX_EMBED_FIELD_LENGTH - CODE_BLOCK_OVERHEAD;
  const truncated =
    toolInput.length > maxContent
      ? `${toolInput.slice(0, maxContent - 3)}...`
      : toolInput;
  return `\`\`\`json\n${truncated}\n\`\`\``;
}

export async function sendApprovalRequest(
  params: ApprovalNotificationParams,
): Promise<void> {
  const client = getDiscordClient();
  if (client == null) {
    return;
  }

  const config = getConfig();
  if (config.discord == null) {
    return;
  }

  const channel = await client.channels.fetch(config.discord.channelId);

  if (channel?.type !== ChannelType.GuildText) {
    approvalLogger.warn(
      { channelId: config.discord.channelId },
      "Approval channel not found or not a text channel",
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Approval Required")
    .setColor(0xf5_a6_23)
    .addFields(
      { name: "Request ID", value: params.requestId, inline: true },
      { name: "Agent", value: params.agent, inline: true },
      { name: "Tool", value: params.toolName, inline: true },
      { name: "Tool Input", value: formatToolInput(params.toolInput) },
      {
        name: "Expires",
        value: `<t:${String(Math.floor(params.expiresAt.getTime() / 1000))}:R>`,
        inline: true,
      },
    )
    .setFooter({
      text: `Or run /sentinel approve ${params.requestId}`,
    })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${params.requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny:${params.requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
  );

  try {
    await channel.send({ embeds: [embed], components: [row] });
    approvalLogger.info(
      { requestId: params.requestId },
      "Approval request sent to Discord",
    );
  } catch (error: unknown) {
    approvalLogger.error(error, "Failed to send approval request to Discord");
  }
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  config: Config,
): Promise<void> {
  const customId = interaction.customId;
  const [action, requestId] = customId.split(":");

  if ((action !== "approve" && action !== "deny") || requestId == null) {
    return;
  }

  // Check authorization
  if (!isAuthorized(interaction, config)) {
    await interaction.reply({
      content: "You do not have permission to approve or deny requests.",
      ephemeral: true,
    });
    return;
  }

  const prisma = getPrisma();
  const status = action === "approve" ? "approved" : "denied";

  // Atomic update: only update if still pending (first decision wins)
  try {
    const result = await prisma.approvalRequest.updateMany({
      where: { id: requestId, status: "pending" },
      data: {
        status,
        decidedBy: interaction.user.id,
        decidedAt: new Date(),
        reason: `${status} via Discord button by ${interaction.user.tag}`,
      },
    });

    if (result.count === 0) {
      await interaction.reply({
        content: "This request has already been decided.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Request \`${requestId}\` has been **${status}** by ${interaction.user.tag}.`,
    });

    approvalLogger.info(
      {
        requestId,
        status,
        decidedBy: interaction.user.id,
      },
      `Approval request ${status} via Discord button`,
    );
  } catch (error: unknown) {
    approvalLogger.error(error, "Failed to process approval button");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "An error occurred processing the approval.",
        ephemeral: true,
      });
    }
  }
}

function isAuthorized(interaction: ButtonInteraction, config: Config): boolean {
  // If no discord config or no approver roles configured, allow anyone
  if (config.discord == null || config.discord.approverRoleIds.length === 0) {
    return true;
  }

  const member = interaction.member;
  if (member == null) {
    return false;
  }

  // member.roles can be a GuildMemberRoleManager or an array of string IDs
  const roles =
    "cache" in member.roles ? [...member.roles.cache.keys()] : member.roles;

  return config.discord.approverRoleIds.some((roleId) =>
    roles.includes(roleId),
  );
}
