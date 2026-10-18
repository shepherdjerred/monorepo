import { Gauge } from "prom-client";
import { createLogger } from "#src/logger.ts";
import { registry } from "#src/metrics/registry.ts";

const logger = createLogger("metrics-report-delivery");

/**
 * Report delivery chunks whose Discord send outcome is unresolved.
 *
 * A chunk reaches `UNKNOWN` when its send left and no answer came back, so
 * the message may or may not be in the channel. A worker that dies between
 * marking a chunk `SENDING` and classifying the result leaves it `SENDING`
 * with the same uncertainty, so both count; ordinary in-flight sends clear
 * well inside the alert's window. Nothing re-sends it, by
 * design: a blind retry is how a report posts twice. It waits for an operator
 * to confirm what landed and resolve it through the operations console, so a
 * non-zero value is the report path's duplicate-delivery risk standing open —
 * the counterpart of a notification intent held in `unknown-delivery`.
 *
 * `-1` means the sweep could not read the table, so zero stays a trustworthy
 * "nothing is waiting".
 */
export const scoutReportDeliveryUnknownChunks = new Gauge({
  name: "scout_report_delivery_unknown_chunks",
  help: "Report delivery chunks whose Discord send outcome is unresolved (sending or unknown); a crash can strand either",
  registers: [registry],
});

export async function updateReportDeliveryMetrics(): Promise<void> {
  try {
    const { prisma } = await import("#src/database/index.ts");
    scoutReportDeliveryUnknownChunks.set(
      await prisma.reportDeliveryChunk.count({
        where: { state: { in: ["SENDING", "UNKNOWN"] } },
      }),
    );
  } catch (error) {
    scoutReportDeliveryUnknownChunks.set(-1);
    logger.error("Failed to update Scout report delivery metrics", { error });
  }
}
