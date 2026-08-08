import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getOpenAIProviderOptions } from "@shepherdjerred/birmel/agent-runtime/provider-options.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { buildConfiguredPersonaProjection } from "@shepherdjerred/birmel/persona/projection.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const logger = loggers.discord.child("should-respond-classifier");

const ClassificationSchema = z.object({
  shouldRespond: z.boolean(),
  reason: z.string().max(300).optional(),
});

export type ClassifyShouldRespondInput = {
  persona: string;
  transcript: string;
  latestMessage: string;
  guildId: string;
  channelId: string;
  userId: string;
};

export async function classifyShouldRespond(
  input: ClassifyShouldRespondInput,
): Promise<boolean> {
  const config = getConfig();
  return await withSpan(
    "birmel.admission.classify",
    {
      guildId: input.guildId,
      channelId: input.channelId,
      userId: input.userId,
    },
    async (span) => {
      try {
        const result = await generateText({
          model: openai(config.openai.classifierModel),
          system:
            "Decide whether the elected persona should reply to the latest Discord message. Reply only when it is directed at the assistant or naturally continues the assistant's active conversation. Ignore unrelated side chatter.",
          prompt: `${buildConfiguredPersonaProjection(input.persona, config.persona.enabled)}\n\nRecent conversation:\n${input.transcript.length === 0 ? "(none)" : input.transcript}\n\nLatest message:\n${input.latestMessage}`,
          output: Output.object({ schema: ClassificationSchema }),
          timeout: config.agent.routerTimeoutMs,
          providerOptions: getOpenAIProviderOptions(),
        });
        span.setAttribute(
          "birmel.admission.should_respond",
          result.output.shouldRespond,
        );
        logger.debug("Admission classifier decision", {
          channelId: input.channelId,
          personaId: input.persona,
          shouldRespond: result.output.shouldRespond,
        });
        return result.output.shouldRespond;
      } catch (error) {
        span.setAttribute("birmel.admission.should_respond", false);
        span.setAttribute(
          "error.type",
          error instanceof Error ? error.name : "UnknownError",
        );
        logger.warn("Admission classifier failed closed", {
          channelId: input.channelId,
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
        return false;
      }
    },
  );
}
