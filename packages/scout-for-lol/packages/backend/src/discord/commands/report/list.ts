import { type ChatInputCommandInteraction } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";

export async function executeReportList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const serverId =
    interaction.guildId === null
      ? null
      : DiscordGuildIdSchema.parse(interaction.guildId);
  if (serverId === null) {
    await interaction.reply({
      content: "Reports can only be listed in a server.",
      ephemeral: true,
    });
    return;
  }

  const reports = await prisma.report.findMany({
    where: { serverId },
    orderBy: { id: "asc" },
    take: 25,
  });

  if (reports.length === 0) {
    await interaction.reply({
      content: "No reports are configured for this server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: reports
      .map(
        (report) =>
          `#${report.id.toString()} **${report.title}** — ${report.outputFormat}, ${report.isEnabled ? "enabled" : "disabled"}, next: ${report.nextScheduledRunAt?.toISOString() ?? "not scheduled"}, last: ${report.lastRunStatus ?? "never run"}`,
      )
      .join("\n"),
    ephemeral: true,
  });
}
