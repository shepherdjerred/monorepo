import { AttachmentBuilder } from "discord.js";
import * as Sentry from "@sentry/bun";
import { prisma } from "#src/database/index.ts";
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
import { DiscordGuildIdSchema, ReportIdSchema } from "@scout-for-lol/data";
import { deliverTrackedCoreOutput } from "#src/analytics/guild-lifecycle.ts";
import { loadReportRunImage } from "#src/storage/s3-report-run.ts";
import type { ScheduledReportDispatch } from "#src/reports/scheduler.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";

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
    await deliverReportDispatch(dispatch, "report_scheduled");
    await new Promise((resolve) => setTimeout(resolve, POST_DELAY_MS));
  }
}

/**
 * Resume a scheduled delivery after the execution activity returned from
 * `runDueReports` but crashed before Discord delivery. The ReportRun archive
 * is the durable dispatch record; effect claims make replaying a completed
 * chunk a no-op while allowing an interrupted chunk to finish.
 */
export async function deliverStoredScheduledReport(
  reportId: number,
): Promise<boolean> {
  const parsedReportId = ReportIdSchema.parse(reportId);
  const report = await prisma.report.findUnique({
    where: { id: parsedReportId },
  });
  if (report === null) return false;
  const run = await prisma.reportRun.findFirst({
    where: {
      reportId: parsedReportId,
      trigger: "SCHEDULED",
      status: "SUCCESS",
      renderedContent: { not: null },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  if (run === null || run.renderedContent === null) return false;
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
  );
  return true;
}

export async function deliverReportDispatch(
  dispatch: ScheduledReportDispatch,
  outputKind: "report_manual" | "report_scheduled",
): Promise<void> {
  const { id: reportId, channelId, serverId } = dispatch.report;

  // Skip guilds the bot is no longer a member of: delivery is impossible and
  // would error every cycle. Orphaned reports are removed by the guildDelete
  // handler / abandoned-guild sweep, but this guards the window before that.
  if (!client.guilds.cache.has(serverId)) {
    logger.warn(
      `[ReportDispatch] Skipping report ${reportId.toString()} - bot is not a member of guild ${serverId}`,
    );
    return;
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
    await deliverTrackedCoreOutput({
      serverId: DiscordGuildIdSchema.parse(serverId),
      outputKind,
      async deliver() {
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
      },
    });
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
  }
}
