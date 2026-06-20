import { type ChatInputCommandInteraction } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  ReportIdSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { isReportManager } from "#src/discord/commands/report/authorization.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { parseReportQuery } from "#src/reports/query-language.ts";

export async function executeReportView(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const serverId =
    interaction.guildId === null
      ? null
      : DiscordGuildIdSchema.parse(interaction.guildId);
  if (serverId === null) {
    await interaction.reply({
      content: "Reports can only be viewed in a server.",
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

  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  if (!isReportManager(interaction, report, userId)) {
    await interaction.reply({
      content: "Only the report owner or a server admin can view it.",
      ephemeral: true,
    });
    return;
  }

  const status = report.lastRunStatus ?? "never run";
  const lastError =
    report.lastRunError === null
      ? "none"
      : truncateDiscordMessage(report.lastRunError, 400);
  const renderKind = safeRenderKind(report.queryText);
  await interaction.reply({
    content: [
      `#${report.id.toString()} **${report.title}**`,
      `Enabled: ${report.isEnabled ? "yes" : "no"}`,
      `Channel: <#${report.channelId}>`,
      `Schedule: \`${report.cronExpression}\``,
      `Next run: ${report.nextScheduledRunAt?.toISOString() ?? "not scheduled"}`,
      `Last status: ${status}`,
      `Last error: ${lastError}`,
      `Display: ${renderKind}, lookback: ${report.lookbackDays.toString()} day(s), max rows: ${report.maxRows.toString()}`,
      "Query:",
      `\`\`\`sql\n${truncateDiscordMessage(report.queryText, 1200)}\n\`\`\``,
    ].join("\n"),
    ephemeral: true,
  });
}

// The render kind lives in the query's RENDER clause. A stored query is always
// validated on save, but guard the view command so one malformed row can't
// block inspecting it (the raw query is shown below for diagnosis).
function safeRenderKind(queryText: string): string {
  try {
    return parseReportQuery(queryText).render.kind;
  } catch {
    return "unparseable";
  }
}
