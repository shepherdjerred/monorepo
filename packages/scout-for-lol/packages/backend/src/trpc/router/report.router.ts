/**
 * Web-UI report management. Exposes the report surface previously available
 * only via Discord commands (create/update/enable/delete/run) plus a live
 * query preview and run history with archived output.
 *
 * Gated on per-guild Administrator (`assertGuildAdmin`) — admins satisfy the
 * owner-or-admin model the Discord side enforces, so `isReportManager` is not
 * needed. System-managed reports are read-only (`assertReportMutable`).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AttachmentBuilder } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  parseAndCompile,
  reportResultColumns,
  ReportCreateInputSchema,
  ReportIdSchema,
  ReportAiEditStatusSchema,
  ReportQueryTextSchema,
  type DiscordGuildId,
  type ReportId,
} from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import {
  CompetitionCronSchema,
  ReportScheduleTimezoneSchema,
} from "@scout-for-lol/data/model/competition-cron.ts";
import type { Report } from "#generated/prisma/client/index.js";
import { router, webProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";
import {
  assertChannelInGuild,
  assertGuildAdmin,
} from "#src/trpc/guild-guard.ts";
import { prisma } from "#src/database/index.ts";
import { canCreateAnotherUserReport } from "#src/discord/commands/report/authorization.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import { renderReportOutput } from "#src/reports/output.ts";
import { runReport } from "#src/reports/runner.ts";
import { send as sendChannelMessage } from "#src/league/discord/channel.ts";
import { getReportAiEditStatus } from "#src/reports/ai/status.ts";
import {
  browseReportData,
  reportDataExplorerSchema,
  ReportDataBrowseInputSchema,
} from "#src/reports/data-explorer.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const ReportIdInput = GuildInput.extend({ reportId: ReportIdSchema });

function asBadRequest(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function assertReportMutable(report: { isSystemManaged: boolean }): void {
  if (report.isSystemManaged) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "System-managed reports cannot be modified.",
    });
  }
}

async function loadReportOr404(
  reportId: ReportId,
  guildId: DiscordGuildId,
): Promise<Report> {
  const report = await prisma.report.findFirst({
    where: { id: reportId, serverId: guildId },
  });
  if (report === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
  }
  return report;
}

export const reportRouter = router({
  list: webProcedure.input(GuildInput).query(async ({ ctx, input }) => {
    await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
    return prisma.report.findMany({
      where: { serverId: input.guildId },
      orderBy: { createdTime: "desc" },
    });
  }),

  aiEditStatus: webProcedure.input(GuildInput).query(async ({ ctx, input }) => {
    await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
    return ReportAiEditStatusSchema.parse(
      getReportAiEditStatus({
        guildId: input.guildId,
        userId: DiscordAccountIdSchema.parse(ctx.user.discordId),
      }),
    );
  }),

  dataExplorerSchema: webProcedure
    .input(GuildInput)
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      return reportDataExplorerSchema();
    }),

  browseData: webProcedure
    .input(GuildInput.extend(ReportDataBrowseInputSchema.shape))
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      try {
        return await browseReportData({
          serverId: input.guildId,
          input: ReportDataBrowseInputSchema.parse({
            table: input.table,
            columns: input.columns,
            filters: input.filters,
            sort: input.sort,
            cursor: input.cursor,
            pageSize: input.pageSize,
          }),
        });
      } catch (error) {
        asBadRequest(error);
      }
    }),

  get: webProcedure
    .input(
      ReportIdInput.extend({
        runLimit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const report = await loadReportOr404(input.reportId, input.guildId);
      const runs = await prisma.reportRun.findMany({
        where: { reportId: input.reportId },
        orderBy: { startedAt: "desc" },
        take: input.runLimit,
      });
      return {
        report,
        runs: runs.map((run) => ({
          id: run.id,
          trigger: run.trigger,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationMs: run.durationMs,
          rowsReturned: run.rowsReturned,
          rowsScanned: run.rowsScanned,
          errorMessage: run.errorMessage,
          renderedContent: run.renderedContent,
          hasImage: run.imageS3Key !== null,
        })),
      };
    }),

  create: webMutationProcedure
    .input(GuildInput.extend(ReportCreateInputSchema.shape))
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.channelId,
      });
      const ownerId = DiscordAccountIdSchema.parse(ctx.user.discordId);
      const limitCheck = await canCreateAnotherUserReport({
        prisma,
        serverId: input.guildId,
        ownerId,
      });
      if (!limitCheck.allowed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: limitCheck.reason,
        });
      }
      try {
        parseAndCompile(input.queryText);
      } catch (error) {
        asBadRequest(error);
      }
      const now = new Date();
      return prisma.report.create({
        data: {
          serverId: input.guildId,
          ownerId,
          // Already validated by ReportCreateInputSchema's DiscordChannelIdSchema.
          channelId: input.channelId,
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
    }),

  update: webMutationProcedure
    .input(
      ReportIdInput.extend({
        title: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        channelId: DiscordChannelIdSchema.optional(),
        queryText: ReportQueryTextSchema.optional(),
        cronExpression: CompetitionCronSchema.optional(),
        scheduleTimezone: ReportScheduleTimezoneSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const report = await loadReportOr404(input.reportId, input.guildId);
      assertReportMutable(report);

      if (input.channelId !== undefined) {
        assertChannelInGuild({
          guildId: input.guildId,
          channelId: input.channelId,
        });
      }
      if (input.queryText !== undefined) {
        try {
          parseAndCompile(input.queryText);
        } catch (error) {
          asBadRequest(error);
        }
      }

      const now = new Date();
      return prisma.report.update({
        where: { id: input.reportId },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.channelId === undefined
            ? {}
            : { channelId: input.channelId }),
          ...(input.queryText === undefined
            ? {}
            : { queryText: input.queryText }),
          ...(input.cronExpression === undefined &&
          input.scheduleTimezone === undefined
            ? {}
            : {
                cronExpression: input.cronExpression ?? report.cronExpression,
                scheduleTimezone:
                  input.scheduleTimezone ?? report.scheduleTimezone,
                nextScheduledRunAt: computeNextScheduledUpdateAt(
                  input.cronExpression ?? report.cronExpression,
                  now,
                  input.scheduleTimezone ?? report.scheduleTimezone,
                ),
              }),
          updatedTime: now,
        },
      });
    }),

  setEnabled: webMutationProcedure
    .input(ReportIdInput.extend({ isEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const report = await loadReportOr404(input.reportId, input.guildId);
      assertReportMutable(report);
      const now = new Date();
      return prisma.report.update({
        where: { id: input.reportId },
        data: input.isEnabled
          ? {
              isEnabled: true,
              nextScheduledRunAt: computeNextScheduledUpdateAt(
                report.cronExpression,
                now,
                report.scheduleTimezone,
              ),
              updatedTime: now,
            }
          : { isEnabled: false, nextScheduledRunAt: null, updatedTime: now },
      });
    }),

  delete: webMutationProcedure
    .input(ReportIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const report = await loadReportOr404(input.reportId, input.guildId);
      assertReportMutable(report);
      await prisma.report.delete({ where: { id: input.reportId } });
      return { deleted: true };
    }),

  run: webMutationProcedure
    .input(ReportIdInput.extend({ post: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const report = await loadReportOr404(input.reportId, input.guildId);
      let result;
      try {
        result = await runReport({ prisma, report, trigger: "MANUAL" });
      } catch (error) {
        asBadRequest(error);
      }
      if (input.post) {
        const image = result.output.image;
        await sendChannelMessage(
          {
            content: result.output.content,
            files:
              image === null
                ? []
                : [new AttachmentBuilder(image.data, { name: image.filename })],
          },
          report.channelId,
          report.serverId,
        );
      }
      return {
        content: result.output.content,
        hasImage: result.output.image !== null,
        rowsReturned: result.rowsReturned,
        rowsScanned: result.rowsScanned,
        posted: input.post,
      };
    }),

  previewQuery: webMutationProcedure
    .input(
      GuildInput.extend({
        queryText: ReportQueryTextSchema,
        title: z.string().trim().min(1).max(100).default("Preview"),
        sourceCompetitionId: z
          .number()
          .int()
          .positive()
          .nullable()
          .default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      try {
        const result = await executeReportQuery({
          prisma,
          serverId: input.guildId,
          queryText: input.queryText,
          sourceCompetitionId: input.sourceCompetitionId,
        });
        // Render the actual chart PNG so the form preview is true WYSIWYG; text
        // kinds (table/list/leaderboard) preview as the data table on the client.
        const render = result.plan.render;
        const output =
          render.kind === "BAR_CHART" || render.kind === "LINE_CHART"
            ? await renderReportOutput({
                title: input.title,
                result,
                startedAt: new Date(),
              })
            : null;
        const image = output === null ? null : output.image;
        return {
          columns: reportResultColumns(result.plan, result.columns),
          rows: result.rows,
          rowsScanned: result.rowsScanned,
          renderKind: render.kind,
          imageBase64: image === null ? null : image.data.toString("base64"),
        };
      } catch (error) {
        asBadRequest(error);
      }
    }),
});
