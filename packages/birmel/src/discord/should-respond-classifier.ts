import type { Span } from "@opentelemetry/api";
import { z } from "zod";
import {
  generateValidatedObject,
  type DecisionSystemBlock,
} from "@shepherdjerred/llm-runtime";
import { getLlmRuntime } from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import type { Config } from "@shepherdjerred/birmel/config/schema.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { buildConfiguredPersonaProjection } from "@shepherdjerred/birmel/persona/projection.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { admissionClassifierTotal } from "@shepherdjerred/birmel/observability/metrics.ts";

const logger = loggers.discord.child("should-respond-classifier");

const DECISIONS_CLASSIFIER_RULES =
  "Decide whether the elected persona should reply to the latest Discord message. Reply only when it is directed at the assistant or naturally continues the assistant's active conversation. Ignore unrelated side chatter.";

const STRUCTURED_CLASSIFIER_SYSTEM_PROMPT = `${DECISIONS_CLASSIFIER_RULES} Always return reason; use null when no reason is needed.`;

const SHOULD_RESPOND_QUESTION_INSTRUCTIONS =
  "Should the bot reply to the latest message right now as a natural peer participant in this Discord channel?";

export const ClassificationSchema = z.strictObject({
  shouldRespond: z.boolean(),
  reason: z.string().max(300).nullable(),
});

export type ClassifyShouldRespondInput = {
  persona: string;
  transcript: string;
  latestMessage: string;
  guildId: string;
  channelId: string;
  userId: string;
  messageId?: string;
};

function buildConversationInput(
  transcript: string,
  latestMessage: string,
): string {
  return `Recent conversation:\n${transcript.length === 0 ? "(none)" : transcript}\n\nLatest message:\n${latestMessage}`;
}

function buildDecisionsSystemBlocks(
  persona: string,
  personaEnabled: boolean,
): readonly DecisionSystemBlock[] {
  const personaProjection = buildConfiguredPersonaProjection(
    persona,
    personaEnabled,
  );
  const text =
    personaProjection.length > 0
      ? `${DECISIONS_CLASSIFIER_RULES}\n\n${personaProjection}`
      : DECISIONS_CLASSIFIER_RULES;
  return [
    {
      type: "input_text",
      text,
      prompt_cache_breakpoint: true,
    },
  ];
}

function logMetadata(
  input: ClassifyShouldRespondInput,
): Record<string, unknown> {
  return {
    guildId: input.guildId,
    channelId: input.channelId,
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
  };
}

async function classifyWithDecisions(
  input: ClassifyShouldRespondInput,
  config: Config,
  span: Span,
): Promise<boolean> {
  const result = await getLlmRuntime().decide({
    model: config.llm.decisionsModel,
    workload: "classifier",
    promptCacheKey: `birmel:should-respond:${input.guildId}`,
    system: buildDecisionsSystemBlocks(input.persona, config.persona.enabled),
    input: buildConversationInput(input.transcript, input.latestMessage),
    questions: [
      {
        type: "predicate",
        name: "should_respond",
        instructions: SHOULD_RESPOND_QUESTION_INSTRUCTIONS,
      },
    ],
    abortSignal: AbortSignal.timeout(config.agent.auxiliaryTimeoutMs),
  });

  const answer = result.answerByName("should_respond");
  if (answer?.type !== "predicate") {
    span.setAttribute("classifier.refusal", true);
    span.setAttribute("birmel.admission.should_respond", false);
    admissionClassifierTotal.inc({ outcome: "refusal" });
    logger.warn(
      "Admission classifier refused or omitted predicate answer; failing closed",
      {
        ...logMetadata(input),
        personaId: input.persona,
        answerType: answer?.type ?? "missing",
      },
    );
    return false;
  }

  const threshold = config.llm.decisionsThreshold;
  const shouldRespond = answer.probability >= threshold;
  span.setAttributes({
    "birmel.admission.should_respond": shouldRespond,
    "classifier.probability": answer.probability,
    "classifier.threshold": threshold,
    "classifier.should_respond": shouldRespond,
  });
  logger.debug("Admission classifier decision", {
    ...logMetadata(input),
    personaId: input.persona,
    probability: answer.probability,
    threshold,
    shouldRespond,
  });
  admissionClassifierTotal.inc({
    outcome: shouldRespond ? "respond" : "ignore",
  });
  return shouldRespond;
}

async function classifyWithStructuredObject(
  input: ClassifyShouldRespondInput,
  config: Config,
  span: Span,
): Promise<boolean> {
  const conversation = buildConversationInput(
    input.transcript,
    input.latestMessage,
  );
  const result = await generateValidatedObject(getLlmRuntime(), {
    model: config.llm.classifierModel,
    system: STRUCTURED_CLASSIFIER_SYSTEM_PROMPT,
    prompt: `${buildConfiguredPersonaProjection(input.persona, config.persona.enabled)}\n\n${conversation}`,
    schema: ClassificationSchema,
    schemaName: "birmel_should_respond",
    workload: "birmel.admission.classify",
    sessionId: input.channelId,
    reasoningEffort: config.llm.reasoningEffort,
    abortSignal: AbortSignal.timeout(config.agent.auxiliaryTimeoutMs),
  });
  span.setAttribute(
    "birmel.admission.should_respond",
    result.object.shouldRespond,
  );
  logger.debug("Admission classifier decision", {
    ...logMetadata(input),
    personaId: input.persona,
    shouldRespond: result.object.shouldRespond,
  });
  admissionClassifierTotal.inc({
    outcome: result.object.shouldRespond ? "respond" : "ignore",
  });
  return result.object.shouldRespond;
}

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
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    },
    async (span) => {
      try {
        return config.llm.decisionsEnabled
          ? await classifyWithDecisions(input, config, span)
          : await classifyWithStructuredObject(input, config, span);
      } catch (error) {
        admissionClassifierTotal.inc({ outcome: "error" });
        if (error instanceof Error) {
          span.recordException(error);
        }
        span.setAttribute("birmel.admission.should_respond", false);
        span.setAttribute(
          "error.type",
          error instanceof Error ? error.name : "UnknownError",
        );
        logger.warn("Admission classifier failed closed", {
          ...logMetadata(input),
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
        return false;
      }
    },
  );
}
