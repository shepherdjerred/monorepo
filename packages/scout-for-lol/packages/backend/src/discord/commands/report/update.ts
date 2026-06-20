import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client/index.js";
import {
  DiscordAccountIdSchema,
  type DiscordChannelId,
  DiscordChannelIdSchema,
  type DiscordGuildId,
  DiscordGuildIdSchema,
  ReportIdSchema,
  ReportLookbackDaysSchema,
  ReportMaxRowsSchema,
  type ReportOutputFormat,
  ReportOutputFormatSchema,
  ReportQueryTextSchema,
  parseAndCompile,
} from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import { CompetitionCronSchema } from "@scout-for-lol/data/model/competition-cron.ts";
import { prisma } from "#src/database/index.ts";
import {
  canCreateAnotherUserReport,
  isReportManager,
} from "#src/discord/commands/report/authorization.ts";

const ReportTitleSchema = z.string().trim().min(1).max(100);
const ReportDescriptionSchema = z.string().trim().max(500);

type ReportUpdateOptions = {
  title?: string;
  description?: string;
  queryText?: string;
  cronExpression?: string;
  lookbackDays?: number;
  maxRows?: number;
  outputFormat?: ReportOutputFormat;
  channelId?: DiscordChannelId;
  enabled?: boolean;
};

export async function executeReportUpdate(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const serverId =
    interaction.guildId === null
      ? null
      : DiscordGuildIdSchema.parse(interaction.guildId);
  if (serverId === null) {
    await interaction.reply({
      content: "Reports can only be updated in a server.",
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
      content: "Only the report owner or a server admin can update it.",
      ephemeral: true,
    });
    return;
  }

  const options = readReportUpdateOptions(interaction);
  if (!hasReportUpdates(options)) {
    await interaction.reply({
      content: "No report fields were provided to update.",
      ephemeral: true,
    });
    return;
  }

  if (
    !(await validateReportReenable({
      interaction,
      serverId,
      reportIsEnabled: report.isEnabled,
      reportOwnerId: report.ownerId,
      enabled: options.enabled,
    }))
  ) {
    return;
  }

  const now = new Date();

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: buildReportUpdateData(options, now),
  });

  await interaction.reply({
    content: `Updated report **${updated.title}** (#${updated.id.toString()}).`,
    ephemeral: true,
  });
}

function readReportUpdateOptions(
  interaction: ChatInputCommandInteraction,
): ReportUpdateOptions {
  const channel = interaction.options.getChannel("channel");
  const options: ReportUpdateOptions = {};
  Object.assign(
    options,
    readTitleOption(interaction),
    readDescriptionOption(interaction),
    readQueryOption(interaction),
    readCronOption(interaction),
    readLookbackDaysOption(interaction),
    readMaxRowsOption(interaction),
    readOutputFormatOption(interaction),
  );
  if (channel !== null) {
    options.channelId = DiscordChannelIdSchema.parse(channel.id);
  }
  const enabled = interaction.options.getBoolean("enabled");
  if (enabled !== null) {
    options.enabled = enabled;
  }
  return options;
}

function readTitleOption(
  interaction: ChatInputCommandInteraction,
): Pick<ReportUpdateOptions, "title"> | undefined {
  const value = interaction.options.getString("title");
  if (value === null) {
    return undefined;
  }
  return { title: ReportTitleSchema.parse(value) };
}

function readDescriptionOption(
  interaction: ChatInputCommandInteraction,
): Pick<ReportUpdateOptions, "description"> | undefined {
  const value = interaction.options.getString("description");
  if (value === null) {
    return undefined;
  }
  return { description: ReportDescriptionSchema.parse(value) };
}

function readCronOption(
  interaction: ChatInputCommandInteraction,
): Pick<ReportUpdateOptions, "cronExpression"> | undefined {
  const value = interaction.options.getString("schedule-cron");
  if (value === null) {
    return undefined;
  }
  return { cronExpression: CompetitionCronSchema.parse(value) };
}

function readLookbackDaysOption(
  interaction: ChatInputCommandInteraction,
): Pick<ReportUpdateOptions, "lookbackDays"> | undefined {
  const value = interaction.options.getInteger("lookback-days");
  if (value === null) {
    return undefined;
  }
  return { lookbackDays: ReportLookbackDaysSchema.parse(value) };
}

function readMaxRowsOption(
  interaction: ChatInputCommandInteraction,
): Pick<ReportUpdateOptions, "maxRows"> | undefined {
  const value = interaction.options.getInteger("max-rows");
  if (value === null) {
    return undefined;
  }
  return { maxRows: ReportMaxRowsSchema.parse(value) };
}

function readOutputFormatOption(
  interaction: ChatInputCommandInteraction,
): Pick<ReportUpdateOptions, "outputFormat"> | undefined {
  const value = interaction.options.getString("output-format");
  if (value === null) {
    return undefined;
  }
  return { outputFormat: ReportOutputFormatSchema.parse(value) };
}

function readQueryOption(
  interaction: ChatInputCommandInteraction,
): Pick<ReportUpdateOptions, "queryText"> | undefined {
  const query = interaction.options.getString("query");
  if (query === null) {
    return undefined;
  }
  const queryText = ReportQueryTextSchema.parse(query);
  parseAndCompile(queryText);
  return { queryText };
}

function hasReportUpdates(options: ReportUpdateOptions): boolean {
  return Object.keys(options).length > 0;
}

async function validateReportReenable(params: {
  interaction: ChatInputCommandInteraction;
  serverId: DiscordGuildId;
  reportOwnerId: string;
  reportIsEnabled: boolean;
  enabled: boolean | undefined;
}): Promise<boolean> {
  if (params.enabled !== true || params.reportIsEnabled) {
    return true;
  }

  const limitCheck = await canCreateAnotherUserReport({
    prisma,
    serverId: params.serverId,
    ownerId: DiscordAccountIdSchema.parse(params.reportOwnerId),
  });
  if (limitCheck.allowed) {
    return true;
  }

  await params.interaction.reply({
    content: limitCheck.reason,
    ephemeral: true,
  });
  return false;
}

function buildReportUpdateData(
  options: ReportUpdateOptions,
  now: Date,
): Prisma.ReportUpdateInput {
  return {
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    ...(options.channelId === undefined
      ? {}
      : { channelId: options.channelId }),
    ...(options.queryText === undefined
      ? {}
      : { queryText: options.queryText }),
    ...(options.lookbackDays === undefined
      ? {}
      : { lookbackDays: options.lookbackDays }),
    ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
    ...(options.outputFormat === undefined
      ? {}
      : { outputFormat: options.outputFormat }),
    ...(options.enabled === undefined ? {} : { isEnabled: options.enabled }),
    ...(options.cronExpression === undefined
      ? {}
      : {
          cronExpression: options.cronExpression,
          nextScheduledRunAt: computeNextScheduledUpdateAt(
            options.cronExpression,
            now,
          ),
        }),
    updatedTime: now,
  };
}
