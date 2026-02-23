import { EmbedBuilder, ChannelType } from "discord.js";
import type { Job } from "@prisma/client";
import { getDiscordClient } from "./client.ts";
import { getConfig } from "@shepherdjerred/sentinel/config/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

const notifyLogger = logger.child({ module: "discord:notifications" });

const STATUS_COLORS: Record<string, number> = {
  completed: 0x22_c5_5e, // green
  failed: 0xed_42_45, // red
  running: 0xf5_a6_23, // yellow
  pending: 0x58_65_f2, // blurple
  cancelled: 0x99_aa_b5, // gray
  awaiting_approval: 0xf5_a6_23, // yellow
};

export async function sendJobNotification(
  job: Job,
  result: string | null,
): Promise<void> {
  const client = getDiscordClient();
  if (client == null) {
    return;
  }

  const discordConfig = getConfig().discord;
  if (discordConfig == null) {
    return;
  }

  const channel = await client.channels.fetch(discordConfig.channelId);

  if (channel?.type !== ChannelType.GuildText) {
    notifyLogger.warn(
      { channelId: discordConfig.channelId },
      "Notification channel not found or not a text channel",
    );
    return;
  }

  const color = STATUS_COLORS[job.status] ?? 0x58_65_f2;
  const truncatedResult =
    result != null && result.length > 1024
      ? `${result.slice(0, 1021)}...`
      : result;

  const embed = new EmbedBuilder()
    .setTitle(`Job ${job.status}: ${job.agent}`)
    .setColor(color)
    .addFields(
      { name: "Job ID", value: job.id, inline: true },
      { name: "Agent", value: job.agent, inline: true },
      { name: "Status", value: job.status, inline: true },
      { name: "Trigger", value: `${job.triggerType} / ${job.triggerSource}`, inline: true },
    )
    .setTimestamp();

  if (truncatedResult != null) {
    embed.addFields({ name: "Result", value: truncatedResult });
  }

  try {
    await channel.send({ embeds: [embed] });
  } catch (error: unknown) {
    notifyLogger.error(error, "Failed to send job notification to Discord");
  }
}
