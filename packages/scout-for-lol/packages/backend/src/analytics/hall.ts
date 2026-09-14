import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { ProductAnalytics } from "#src/analytics/product-analytics.ts";
import { captureWithGuildInstallation } from "#src/analytics/capture-with-installation.ts";

/**
 * Capture one `hall_record_broken` event against the guild's installation
 * identity — one per delivered record-break announcement, carrying only the
 * bounded count of broken record cells.
 */
export async function captureHallRecordBroken(
  input: { guildId: string; records: number },
  options?: {
    db?: ExtendedPrismaClient;
    analytics?: ProductAnalytics;
  },
): Promise<void> {
  await captureWithGuildInstallation(
    {
      guildId: input.guildId,
      what: "hall record break",
      event: {
        event: "hall_record_broken",
        properties: { records: input.records },
      },
    },
    options,
  );
}
