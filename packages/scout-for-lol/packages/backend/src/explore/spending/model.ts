import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import {
  reserveExploreCall,
  settleExploreCall,
} from "#src/explore/spending/ledger.ts";
import { exploreSpendPolicy } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { supportsOpenAiUltrafast } from "#src/lib/openai-service-tier.ts";
import { exploreProviderInputBound } from "./input-bound.ts";

type ExploreProviderOptions = NonNullable<
  Parameters<
    NonNullable<LanguageModelMiddleware["wrapGenerate"]>
  >[0]["params"]["providerOptions"]
>;

/**
 * Options every Explore provider call sends. Sol uses Ultrafast; Luna stays
 * on Fast, the fastest tier it offers. High reasoning stays the quality
 * setting the conversation already records; an in-game coach turn lowers it.
 */
export function exploreOpenAiProviderOptions(
  model: string,
  providerOptions: ExploreProviderOptions | undefined,
  reasoningEffort: "low" | "medium" | "high" = "high",
): ExploreProviderOptions {
  return {
    ...providerOptions,
    openai: {
      ...providerOptions?.["openai"],
      reasoningEffort,
      serviceTier: supportsOpenAiUltrafast(model) ? "ultrafast" : "fast",
    },
  };
}

/** Wrap the lowest provider boundary: every step and repair passes here. */
export function exploreSpendMiddleware(input: {
  ownerId: string;
  runId: string;
  model: string;
  /** Provider reasoning effort; every Explore turn but an in-game one runs high. */
  reasoningEffort?: "low" | "medium" | "high";
}): LanguageModelMiddleware {
  const { reasoningEffort = "high", ...reservationInput } = input;
  return {
    wrapGenerate: async ({ params, model }) => {
      const inputBound = exploreProviderInputBound(params);
      const reservation = await reserveExploreCall({
        ...reservationInput,
        inputBound,
        maxOutputTokens: params.maxOutputTokens ?? 32_768,
        policy: exploreSpendPolicy(),
      });
      const result = await model.doGenerate({
        ...params,
        maxOutputTokens: reservation.maxOutputTokens,
        providerOptions: exploreOpenAiProviderOptions(
          input.model,
          params.providerOptions,
          reasoningEffort,
        ),
      });
      await settleExploreCall(reservation, result.usage, result.response?.id);
      return result;
    },
    wrapStream: async ({ params, model }) => {
      const inputBound = exploreProviderInputBound(params);
      const reservation = await reserveExploreCall({
        ...reservationInput,
        inputBound,
        maxOutputTokens: params.maxOutputTokens ?? 32_768,
        policy: exploreSpendPolicy(),
      });
      const result = await model.doStream({
        ...params,
        maxOutputTokens: reservation.maxOutputTokens,
        providerOptions: exploreOpenAiProviderOptions(
          input.model,
          params.providerOptions,
          reasoningEffort,
        ),
      });
      let responseId: string | undefined;
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            async transform(chunk, controller) {
              if (chunk.type === "response-metadata") {
                responseId = chunk.id;
                if (responseId !== undefined)
                  await prisma.exploreSpend.updateMany({
                    where: { id: reservation.id, state: "held" },
                    data: { responseId },
                  });
              }
              if (chunk.type === "finish")
                await settleExploreCall(reservation, chunk.usage, responseId);
              controller.enqueue(chunk);
            },
          }),
        ),
      };
    },
  };
}

export const withExploreSpend = (
  model: Parameters<typeof wrapLanguageModel>[0]["model"],
  input: Parameters<typeof exploreSpendMiddleware>[0],
) => wrapLanguageModel({ model, middleware: exploreSpendMiddleware(input) });
