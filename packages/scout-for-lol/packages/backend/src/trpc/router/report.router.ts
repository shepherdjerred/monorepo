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
  ReportCreateInputSchema,
  ReportIdSchema,
  ReportLookbackDaysSchema,
  ReportMaxRowsSchema,
  ReportOutputFormatSchema,
  ReportQueryTextSchema,
  reportColumnLabel,
  type DiscordGuildId,
  type ReportId,
} from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import { CompetitionCronSchema } from "@scout-for-lol/data/model/competition-cron.ts";
import type { Report } from "#generated/prisma/client/index.js";
import { router, webProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";
import {
  assertChannelInGuild,
  assertGuildAdmin,
} from "#src/trpc/guild-guard.ts";
import { prisma } from "#src/database/index.ts";
import { canCreateAnotherUserReport } from "#src/discord/commands/report/authorization.ts";
import { parseReportQuery } from "#src/reports/query-language.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import { renderReportPreview } from "#src/reports/output.ts";
import { runReport } from "#src/reports/runner.ts";
import { send as sendChannelMessage } from "#src/league/discord/channel.ts";

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
          outputFormat: run.outputFormat,
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
        parseReportQuery(input.queryText);
      } catch (error) {
        asBadRequest(error);
      }
      const now = new Date();
      return prisma.report.create({
        data: {
          serverId: input.guildId,
          ownerId,
          channelId: DiscordChannelIdSchema.parse(input.channelId),
          title: input.title,
          description: input.description,
          queryText: input.queryText,
          lookbackDays: input.lookbackDays,
          maxRows: input.maxRows,
          outputFormat: input.outputFormat,
          isEnabled: input.isEnabled,
          isSystemManaged: false,
          cronExpression: input.cronExpression,
          nextScheduledRunAt: computeNextScheduledUpdateAt(
            input.cronExpression,
            now,
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
        lookbackDays: ReportLookbackDaysSchema.optional(),
        maxRows: ReportMaxRowsSchema.optional(),
        outputFormat: ReportOutputFormatSchema.optional(),
        cronExpression: CompetitionCronSchema.optional(),
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
          parseReportQuery(input.queryText);
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
          ...(input.lookbackDays === undefined
            ? {}
            : { lookbackDays: input.lookbackDays }),
          ...(input.maxRows === undefined ? {} : { maxRows: input.maxRows }),
          ...(input.outputFormat === undefined
            ? {}
            : { outputFormat: input.outputFormat }),
          ...(input.cronExpression === undefined
            ? {}
            : {
                cronExpression: input.cronExpression,
                nextScheduledRunAt: computeNextScheduledUpdateAt(
                  input.cronExpression,
                  now,
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
        lookbackDays: ReportLookbackDaysSchema,
        maxRows: ReportMaxRowsSchema,
        outputFormat: ReportOutputFormatSchema.default("TABLE"),
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
          lookbackDays: input.lookbackDays,
          maxRows: input.maxRows,
          sourceCompetitionId: input.sourceCompetitionId,
        });
        const output = renderReportPreview({
          title: "Preview",
          outputFormat: input.outputFormat,
          result,
          startedAt: new Date(),
        });
        return {
          columns: result.columns,
          columnLabels: result.columns.map((column) =>
            reportColumnLabel(column, result.plan.groupBy),
          ),
          rows: result.rows,
          rowsScanned: result.rowsScanned,
          output,
        };
      } catch (error) {
        asBadRequest(error);
      }
    }),
});
