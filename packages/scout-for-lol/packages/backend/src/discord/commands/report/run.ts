import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  ReportIdSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { isReportManager } from "#src/discord/commands/report/authorization.ts";
import { send as sendChannelMessage } from "#src/league/discord/channel.ts";
import { runReport } from "#src/reports/runner.ts";

export async function executeReportRun(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const serverId =
    interaction.guildId === null
      ? null
      : DiscordGuildIdSchema.parse(interaction.guildId);
  if (serverId === null) {
    await interaction.reply({
      content: "Reports can only be run in a server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const reportId = ReportIdSchema.parse(
    interaction.options.getInteger("report-id", true),
  );
  const report = await prisma.report.findFirst({
    where: { id: reportId, serverId },
  });

  if (report === null) {
    await interaction.editReply(
      `Report #${reportId.toString()} was not found.`,
    );
    return;
  }

  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  if (!isReportManager(interaction, report, userId)) {
    await interaction.editReply(
      "Only the report owner or a server admin can run it.",
    );
    return;
  }

  const result = await runReport({
    prisma,
    report,
    trigger: "MANUAL",
  });
  const image = result.output.image;
  const files =
    image === null
      ? []
      : [new AttachmentBuilder(image.data, { name: image.filename })];

  await sendChannelMessage(
    {
      content: result.output.content,
      files,
    },
    report.channelId,
    report.serverId,
  );

  await interaction.editReply(
    `Posted **${report.title}** to <#${report.channelId}> (${result.rowsReturned.toString()} row(s), ${result.rowsScanned.toString()} scanned).`,
  );
}
