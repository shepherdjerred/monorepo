import { type ChatInputCommandInteraction } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  ReportIdSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { isReportManager } from "#src/discord/commands/report/authorization.ts";

export async function executeReportDelete(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await disableReport(interaction, "deleted");
}

export async function executeReportDisable(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await disableReport(interaction, "disabled");
}

async function disableReport(
  interaction: ChatInputCommandInteraction,
  action: "deleted" | "disabled",
): Promise<void> {
  const serverId =
    interaction.guildId === null
      ? null
      : DiscordGuildIdSchema.parse(interaction.guildId);
  if (serverId === null) {
    await interaction.reply({
      content: "Reports can only be managed in a server.",
      ephemeral: true,
    });
    return;
  }

  const reportId = ReportIdSchema.parse(
    interaction.options.getInteger("report-id", true),
  );
  const report = await prisma.report.findFirst({
    where: { id: reportId, serverId },
  });
  if (report === null) {
    await interaction.reply({
      content: `Report #${reportId.toString()} was not found.`,
      ephemeral: true,
    });
    return;
  }
  if (report.isSystemManaged) {
    await interaction.reply({
      content:
        "System-managed reports are controlled by competitions and seeded schedules.",
      ephemeral: true,
    });
    return;
  }

  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  if (!isReportManager(interaction, report, userId)) {
    await interaction.reply({
      content: "Only the report owner or a server admin can delete it.",
      ephemeral: true,
    });
    return;
  }

  await prisma.report.update({
    where: { id: report.id },
    data: {
      isEnabled: false,
      nextScheduledRunAt: null,
      updatedTime: new Date(),
    },
  });

  await interaction.reply({
    content: `Report **${report.title}** (#${report.id.toString()}) was ${action}.`,
    ephemeral: true,
  });
}
