import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import {
  getProductAnalytics,
  type ProductAnalytics,
} from "#src/analytics/product-analytics.ts";
import { findAnalyticsGuildInstallation } from "#src/analytics/guild-installation.ts";

const logger = createLogger("hall-analytics");

/**
 * Capture one `hall_record_broken` event against the guild's installation
 * identity — one per delivered record-break announcement, carrying only the
 * bounded count of broken record cells. Best-effort like every delivery-side
 * capture: it never throws, because it runs beside an outbox delivery whose
 * own outcome must not be replaced by an analytics failure.
 */
export async function captureHallRecordBroken(
  input: { guildId: string; records: number },
  options?: {
    db?: ExtendedPrismaClient;
    analytics?: ProductAnalytics;
  },
): Promise<void> {
  try {
    const db = options?.db ?? prisma;
    const analytics = options?.analytics ?? getProductAnalytics();
    const install = await findAnalyticsGuildInstallation(db, input.guildId);
    if (install === null) {
      logger.warn(
        "Cannot capture hall record break without a GuildInstall lifecycle row",
      );
      return;
    }
    analytics.capture(install, {
      event: "hall_record_broken",
      properties: { records: input.records },
    });
  } catch (error) {
    logger.error(
      "Failed to capture hall record-break analytics",
      getErrorMessage(error),
    );
  }
}
