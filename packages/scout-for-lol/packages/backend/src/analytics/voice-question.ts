import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import {
  getProductAnalytics,
  type ProductAnalytics,
  type VoiceQuestionOutcome,
} from "#src/analytics/product-analytics.ts";
import { findAnalyticsGuildInstallation } from "#src/analytics/guild-installation.ts";

const logger = createLogger("voice-question-analytics");

export type VoiceQuestionCapture = {
  readonly guildId: string;
  readonly observation: {
    readonly outcome: VoiceQuestionOutcome;
    /** First-reply-audio latency; undefined when no reply audio existed. */
    readonly wakeToReplySeconds: number | undefined;
    readonly champion: string | undefined;
    readonly abilitySlot: string | undefined;
  };
};

/**
 * Capture one `voice_question_asked` event against the guild's installation
 * identity. Best-effort like every interaction-boundary capture: validates
 * everything and never throws, because it runs beside a live voice turn whose
 * own outcome must not be replaced by an analytics failure. The observation
 * deliberately cannot carry transcript text or audio — its type has nowhere
 * to put them.
 */
export async function captureVoiceQuestionAsked(
  input: VoiceQuestionCapture,
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
        "Cannot capture voice question without a GuildInstall lifecycle row",
      );
      return;
    }
    analytics.capture(install, {
      event: "voice_question_asked",
      properties: {
        outcome: input.observation.outcome,
        ...(input.observation.wakeToReplySeconds === undefined
          ? {}
          : { wake_to_reply_seconds: input.observation.wakeToReplySeconds }),
        ...(input.observation.champion === undefined
          ? {}
          : { champion: input.observation.champion }),
        ...(input.observation.abilitySlot === undefined
          ? {}
          : { ability_slot: input.observation.abilitySlot }),
      },
    });
  } catch (error) {
    logger.error(
      "Failed to capture voice question analytics",
      getErrorMessage(error),
    );
  }
}
