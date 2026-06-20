import { AttachmentBuilder } from "discord.js";
import * as Sentry from "@sentry/bun";
import { prisma } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import {
  send as sendChannelMessage,
  ChannelSendError,
} from "#src/league/discord/channel.ts";
import { runDueReports } from "#src/reports/scheduler.ts";
import { syncSystemReports } from "#src/reports/system-reports.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-discord-dispatcher");

const POST_DELAY_MS = 1000;

export async function runScheduledReportDispatch(): Promise<void> {
  await syncSystemReports({ prisma });
  const dispatches = await runDueReports({ prisma });

  if (dispatches.length === 0) {
    return;
  }

  logger.info(
    `[ReportDispatch] Posting ${dispatches.length.toString()} scheduled report(s)`,
  );

  for (const dispatch of dispatches) {
    const { id: reportId, channelId, serverId } = dispatch.report;

    // Skip guilds the bot is no longer a member of: delivery is impossible and
    // would error every cycle. Orphaned reports are removed by the guildDelete
    // handler / abandoned-guild sweep, but this guards the window before that.
    if (!client.guilds.cache.has(serverId)) {
      logger.warn(
        `[ReportDispatch] Skipping report ${reportId.toString()} - bot is not a member of guild ${serverId}`,
      );
      continue;
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
      await sendChannelMessage(
        {
          content: dispatch.result.output.content,
          files,
        },
        channelId,
        serverId,
      );
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

    await new Promise((resolve) => setTimeout(resolve, POST_DELAY_MS));
  }
}
