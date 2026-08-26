import { AttachmentBuilder } from "discord.js";
import * as Sentry from "@sentry/bun";
import { client } from "#src/discord/client.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";
import {
  send as sendChannelMessage,
  ChannelSendError,
} from "#src/league/discord/channel.ts";
import { runDueReports } from "#src/reports/scheduler.ts";
import { syncSystemReports } from "#src/reports/system-reports.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import {
  DiscordGuildIdSchema,
  ReportIdSchema,
  ReportRunIdSchema,
} from "@scout-for-lol/data";
import { recordCoreOutputDelivered } from "#src/analytics/guild-lifecycle.ts";
import type { ScheduledReportDispatch } from "#src/reports/scheduler.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { loadReportRunImage } from "#src/storage/s3-report-run.ts";

const logger = createLogger("report-discord-dispatcher");

const POST_DELAY_MS = 1000;

export async function runScheduledReportDispatch(): Promise<void> {
  await syncSystemReports({ prisma });
  const dispatches = await runDueReports({ prisma });

  await deliverScheduledReportDispatches(dispatches);
}

export async function deliverScheduledReportDispatches(
  dispatches: Awaited<ReturnType<typeof runDueReports>>,
): Promise<void> {
  if (dispatches.length === 0) {
    return;
  }

  logger.info(
    `[ReportDispatch] Posting ${dispatches.length.toString()} scheduled report(s)`,
  );

  for (const dispatch of dispatches) {
    const delivered = await deliverReportDispatch(dispatch, "report_scheduled");
    if (delivered) {
      await prisma.reportRun.updateMany({
        where: {
          id: ReportRunIdSchema.parse(dispatch.result.runId),
          deliveryState: "PENDING",
        },
        data: {
          deliveryState: "DELIVERED",
          deliveryError: null,
          deliveredAt: new Date(),
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POST_DELAY_MS));
  }
}

/**
 * Resume a scheduled delivery after report execution completed but Discord
 * delivery was interrupted. The ReportRun archive is the durable dispatch
 * record; effect claims make replaying a completed chunk a no-op.
 */
export async function deliverStoredScheduledReport(
  reportId: number,
  runId?: number,
): Promise<boolean> {
  const parsedReportId = ReportIdSchema.parse(reportId);
  const parsedRunId =
    runId === undefined ? undefined : ReportRunIdSchema.parse(runId);
  const report = await prisma.report.findUnique({
    where: { id: parsedReportId },
  });
  if (report === null) return false;
  const run = await prisma.reportRun.findFirst({
    where: {
      ...(parsedRunId === undefined ? {} : { id: parsedRunId }),
      reportId: parsedReportId,
      trigger: "SCHEDULED",
      status: "SUCCESS",
      renderedContent: { not: null },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  if (run?.renderedContent === undefined || run.renderedContent === null) {
    return false;
  }
  const imageBytes =
    run.imageS3Key === null
      ? null
      : await loadReportRunImage(report.id, run.id);
  await deliverReportDispatch(
    {
      report,
      result: {
        runId: run.id,
        rowsReturned: run.rowsReturned,
        rowsScanned: run.rowsScanned,
        output: {
          content: run.renderedContent,
          image:
            imageBytes === null
              ? null
              : { filename: "report.png", data: imageBytes },
        },
      },
    },
    "report_scheduled",
    "propagate",
  );
  return true;
}

export async function deliverReportDispatch(
  dispatch: ScheduledReportDispatch,
  outputKind: "report_manual" | "report_scheduled",
  failureMode: "isolate" | "propagate" = "isolate",
): Promise<boolean> {
  const { id: reportId, channelId, serverId } = dispatch.report;

  // Skip guilds the bot is no longer a member of: delivery is impossible and
  // would error every cycle. Orphaned reports are removed by the guildDelete
  // handler / abandoned-guild sweep, but this guards the window before that.
  if (!client.guilds.cache.has(serverId)) {
    const error = new Error(
      `Cannot deliver report ${reportId.toString()} because the bot is not a member of guild ${serverId}`,
    );
    logger.warn(`[ReportDispatch] ${error.message}`);
    if (failureMode === "propagate") throw error;
    return false;
  }

  const image = dispatch.result.output.image;
  const files =
    image === null
      ? []
      : [new AttachmentBuilder(image.data, { name: image.filename })];

  // Isolate each delivery: one failed report must not abort the rest of the
  // batch. Permission errors are already recorded (DB + owner notify) and other
  // errors captured to Sentry inside `send`, so a ChannelSendError just gets a
  // warning here; anything unexpected is reported and we move on.
  try {
    for (const [index, content] of splitMessageIntoChunks(
      dispatch.result.output.content,
    ).entries()) {
      const effectKey = `report-discord:${dispatch.result.runId.toString()}:${index.toString()}`;
      const claim = await claimScoutEffect({
        key: effectKey,
        kind: "report-discord",
      });
      if (claim === "completed") continue;
      try {
        await sendChannelMessage(
          {
            content,
            files: index === 0 ? files : [],
            nonce: `sr:${dispatch.result.runId.toString(36)}:${index.toString(36)}`,
            enforceNonce: true,
          },
          channelId,
          serverId,
        );
        await completeScoutEffect(effectKey);
      } catch (error) {
        await recordScoutEffectFailure(effectKey, error);
        throw error;
      }
    }
    const analyticsEffectKey = `report-analytics:${dispatch.result.runId.toString()}`;
    const analyticsClaim = await claimScoutEffect({
      key: analyticsEffectKey,
      kind: "report-analytics",
    });
    if (analyticsClaim === "execute") {
      await recordCoreOutputDelivered(
        DiscordGuildIdSchema.parse(serverId),
        outputKind,
      );
      await completeScoutEffect(analyticsEffectKey);
    }
  } catch (error) {
    if (error instanceof ChannelSendError) {
      logger.warn(
        `[ReportDispatch] Failed to deliver report ${reportId.toString()} to channel ${channelId}: ${getErrorMessage(error)}`,
      );
    } else {
      logger.error(
        `[ReportDispatch] Unexpected error delivering report ${reportId.toString()} to channel ${channelId}:`,
        getErrorMessage(error),
      );
      Sentry.captureException(error, {
        tags: {
          source: "report-dispatch",
          reportId: reportId.toString(),
          serverId,
        },
      });
    }
    if (failureMode === "propagate") throw error;
    return false;
  }
  return true;
}

export async function deliverPendingReportDispatches(
  input: {
    reportId: number;
    trigger: "MANUAL" | "SCHEDULED";
    runId?: number;
    failureMode?: "isolate" | "propagate";
  },
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const reportId = ReportIdSchema.parse(input.reportId);
  const runId =
    input.runId === undefined
      ? undefined
      : ReportRunIdSchema.parse(input.runId);
  const report = await database.report.findUniqueOrThrow({
    where: { id: reportId },
  });
  const runs = await database.reportRun.findMany({
    where: {
      reportId,
      trigger: input.trigger,
      status: "SUCCESS",
      deliveryState: "PENDING",
      ...(runId === undefined ? {} : { id: runId }),
    },
    orderBy: { id: "asc" },
  });
  for (const run of runs) {
    if (run.renderedContent === null) {
      throw new Error(
        `Successful report run ${run.id.toString()} has no persisted rendered content`,
      );
    }
    const imageBytes =
      run.imageS3Key === null
        ? null
        : await loadReportRunImage(run.reportId, run.id);
    if (imageBytes === null && run.imageS3Key !== null) {
      throw new Error(
        `Report run ${run.id.toString()} has a persisted image key but its image cannot be loaded`,
      );
    }
    try {
      await deliverReportDispatch(
        {
          report,
          result: {
            runId: run.id,
            output: {
              content: run.renderedContent,
              image:
                imageBytes === null
                  ? null
                  : {
                      filename: `report-${run.id.toString()}.png`,
                      data: imageBytes,
                    },
            },
            rowsReturned: run.rowsReturned,
            rowsScanned: run.rowsScanned,
          },
        },
        input.trigger === "SCHEDULED" ? "report_scheduled" : "report_manual",
        "propagate",
      );
      await database.reportRun.updateMany({
        where: { id: run.id, deliveryState: "PENDING" },
        data: {
          deliveryState: "DELIVERED",
          deliveryError: null,
          deliveredAt: new Date(),
        },
      });
    } catch (error) {
      await database.reportRun.updateMany({
        where: { id: run.id, deliveryState: "PENDING" },
        data: {
          deliveryError: error instanceof Error ? error.message : String(error),
        },
      });
      if (input.failureMode !== "isolate") throw error;
    }
  }
}
