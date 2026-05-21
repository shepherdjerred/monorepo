import { AttachmentBuilder } from "discord.js";
import { prisma } from "#src/database/index.ts";
import { send as sendChannelMessage } from "#src/league/discord/channel.ts";
import { runDueReports } from "#src/reports/scheduler.ts";
import { syncSystemReports } from "#src/reports/system-reports.ts";
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
    const image = dispatch.result.output.image;
    const files =
      image === null
        ? []
        : [new AttachmentBuilder(image.data, { name: image.filename })];

    await sendChannelMessage(
      {
        content: dispatch.result.output.content,
        files,
      },
      dispatch.report.channelId,
      dispatch.report.serverId,
    );

    await new Promise((resolve) => setTimeout(resolve, POST_DELAY_MS));
  }
}
