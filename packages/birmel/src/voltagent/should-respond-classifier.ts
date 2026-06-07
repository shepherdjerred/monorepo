import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { getOpenAIResponsesProviderOptions } from "@shepherdjerred/birmel/voltagent/openai-provider-options.ts";
import { buildPersonaPrompt } from "@shepherdjerred/birmel/persona/style-transform.ts";

const logger = loggers.discord.child("should-respond-classifier");

const ClassificationSchema = z.object({
  shouldRespond: z
    .boolean()
    .describe("Whether the bot should respond to the latest message"),
  reason: z
    .string()
    .optional()
    .describe("A brief justification for the decision"),
});

export type ClassifyShouldRespondInput = {
  /** Active persona name (e.g. "virmel"). */
  persona: string;
  /** Recent channel transcript, oldest-first, already formatted as text. */
  transcript: string;
  /** The new message to classify, as "Username: content". */
  latestMessage: string;
  guildId: string;
  channelId: string;
  userId: string;
};

/**
 * Decide whether the bot should respond to a message that did NOT directly
 * mention it, given the bot was recently engaged in the channel. Uses the cheap
 * classifier model and the active persona so the decision reflects what *that*
 * persona would jump into.
 *
 * Fails closed: any error (API failure, malformed output) returns `false` so a
 * classifier outage degrades to "only respond to direct triggers" rather than
 * spamming or crashing the message pipeline.
 */
export async function classifyShouldRespond(
  input: ClassifyShouldRespondInput,
): Promise<boolean> {
  const { persona, transcript, latestMessage, guildId, channelId, userId } =
    input;
  const config = getConfig();

  return withSpan(
    "responder.classifyShouldRespond",
    { guildId, channelId, userId, operation: "classifyShouldRespond" },
    async (span) => {
      try {
        const personaPrompt = await buildPersonaPrompt(persona);
        const personaBlock =
          personaPrompt == null
            ? `You are "${persona}".`
            : `You are "${personaPrompt.name}". Your voice:\n${personaPrompt.voice}`;

        const { output: object } = await generateText({
          model: openai(config.openai.classifierModel),
          providerOptions: getOpenAIResponsesProviderOptions(),
          output: Output.object({ schema: ClassificationSchema }),
          prompt: `${personaBlock}

You were recently chatting in this Discord channel. Decide whether you should
reply to the LATEST message below. Reply only when the latest message is
plausibly directed at you or continues the conversation you were part of (a
follow-up question, a reaction to what you said, or something you'd naturally
jump into as ${persona}). Do NOT reply to side chatter between other people that
has nothing to do with you.

Recent conversation (oldest first):
${transcript.length > 0 ? transcript : "(no recent messages)"}

Latest message:
${latestMessage}`,
        });

        span.setAttribute("should_respond", object.shouldRespond);
        logger.debug("classifier decision", {
          channelId,
          persona,
          shouldRespond: object.shouldRespond,
          reason: object.reason,
        });
        return object.shouldRespond;
      } catch (error) {
        // Fail closed — do not respond if we cannot classify.
        span.setAttribute("should_respond", false);
        span.setAttribute("classifier_error", true);
        logger.warn("classifier failed, defaulting to no-response", {
          channelId,
          persona,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
  );
}
