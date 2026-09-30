import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { captureWithGuildInstallation } from "#src/analytics/capture-with-installation.ts";
import type {
  FeatureTipKey,
  FeatureTipSurface,
  ProductAnalytics,
} from "#src/analytics/product-analytics.ts";

/**
 * Capture one `feature_tip_shown` event against the guild's installation
 * identity.
 *
 * Runs after the message carrying the tip has already been delivered, so it
 * inherits the shared capture guard rather than reporting failure upward.
 */
export async function captureFeatureTipShown(
  input: {
    guildId: string;
    tipKey: FeatureTipKey;
    surface: FeatureTipSurface;
  },
  options?: {
    db?: ExtendedPrismaClient;
    analytics?: ProductAnalytics;
  },
): Promise<void> {
  await captureWithGuildInstallation(
    {
      guildId: input.guildId,
      what: "feature tip",
      event: {
        event: "feature_tip_shown",
        properties: { tip_key: input.tipKey, surface: input.surface },
      },
    },
    options,
  );
}
