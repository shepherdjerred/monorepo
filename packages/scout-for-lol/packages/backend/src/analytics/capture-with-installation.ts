import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import {
  getProductAnalytics,
  type ProductAnalytics,
  type ProductAnalyticsEvent,
} from "#src/analytics/product-analytics.ts";
import { findAnalyticsGuildInstallation } from "#src/analytics/guild-installation.ts";

const logger = createLogger("guild-installation-analytics");

/**
 * Capture one event against the guild's installation identity, best-effort.
 * Shared by every capture that rides beside a delivery or live interaction:
 * it validates what it is given and never throws, because an analytics
 * failure must not replace the surrounding operation's own outcome. `what`
 * names the event in the skip/failure logs.
 */
export async function captureWithGuildInstallation(
  input: { guildId: string; what: string; event: ProductAnalyticsEvent },
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
        `Cannot capture ${input.what} without a GuildInstall lifecycle row`,
      );
      return;
    }
    analytics.capture(install, input.event);
  } catch (error) {
    logger.error(
      `Failed to capture ${input.what} analytics`,
      getErrorMessage(error),
    );
  }
}
