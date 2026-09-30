import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type {
  ProductAnalytics,
  VoiceQuestionOutcome,
} from "#src/analytics/product-analytics.ts";
import { captureWithGuildInstallation } from "#src/analytics/capture-with-installation.ts";

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
  await captureWithGuildInstallation(
    {
      guildId: input.guildId,
      what: "voice question",
      event: {
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
      },
    },
    options,
  );
}
