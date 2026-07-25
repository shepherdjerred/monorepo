import {
  type ChatInputCommandInteraction,
  PermissionsBitField,
} from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  ReportCreateInputSchema,
  parseAndCompile,
} from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import { prisma } from "#src/database/index.ts";
import { canCreateReport } from "#src/database/competition/permissions.ts";
import { canCreateAnotherUserReport } from "#src/discord/commands/report/authorization.ts";

export async function executeReportCreate(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const serverId =
    interaction.guildId === null
      ? null
      : DiscordGuildIdSchema.parse(interaction.guildId);
  if (serverId === null) {
    await interaction.reply({
      content: "Reports can only be created in a server.",
      ephemeral: true,
    });
    return;
  }

  const permissions = interaction.memberPermissions;
  if (!(permissions instanceof PermissionsBitField)) {
    await interaction.reply({
      content: "Unable to verify your server permissions.",
      ephemeral: true,
    });
    return;
  }

  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  const permission = await canCreateReport(
    prisma,
    serverId,
    userId,
    permissions,
  );
  if (!permission.allowed) {
    await interaction.reply({
      content:
        permission.reason ?? "You do not have permission to create reports.",
      ephemeral: true,
    });
    return;
  }
  const limitCheck = await canCreateAnotherUserReport({
    prisma,
    serverId,
    ownerId: userId,
  });
  if (!limitCheck.allowed) {
    await interaction.reply({
      content: limitCheck.reason,
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  const input = ReportCreateInputSchema.parse({
    title: interaction.options.getString("title", true),
    description: interaction.options.getString("description"),
    channelId: channel.id,
    queryText: interaction.options.getString("query", true),
    cronExpression: interaction.options.getString("schedule-cron", true),
  });
  parseAndCompile(input.queryText);

  const now = new Date();
  const report = await prisma.report.create({
    data: {
      serverId,
      ownerId: userId,
      channelId: DiscordChannelIdSchema.parse(input.channelId),
      title: input.title,
      description: input.description,
      queryText: input.queryText,
      isEnabled: input.isEnabled,
      isSystemManaged: false,
      cronExpression: input.cronExpression,
      scheduleTimezone: input.scheduleTimezone,
      nextScheduledRunAt: computeNextScheduledUpdateAt(
        input.cronExpression,
        now,
        input.scheduleTimezone,
      ),
      createdTime: now,
      updatedTime: now,
    },
  });

  await interaction.reply({
    content: `✅ Created report **${report.title}** (#${report.id.toString()}).`,
    ephemeral: true,
  });
}
