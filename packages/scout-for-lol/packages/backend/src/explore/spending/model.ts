import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import {
  reserveExploreCall,
  settleExploreCall,
} from "#src/explore/spending/ledger.ts";
import { exploreSpendPolicy } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { exploreProviderInputBound } from "./input-bound.ts";

/** Wrap the lowest provider boundary: every step and repair passes here. */
export function exploreSpendMiddleware(input: {
  ownerId: string;
  runId: string;
  model: string;
}): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ params, model }) => {
      const inputBound = exploreProviderInputBound(params);
      const reservation = await reserveExploreCall({
        ...input,
        inputBound,
        maxOutputTokens: params.maxOutputTokens ?? 32_768,
        policy: exploreSpendPolicy(),
      });
      const result = await model.doGenerate({
        ...params,
        maxOutputTokens: reservation.maxOutputTokens,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.["openai"],
            reasoningEffort: "high",
          },
        },
      });
      await settleExploreCall(reservation, result.usage, result.response?.id);
      return result;
    },
    wrapStream: async ({ params, model }) => {
      const inputBound = exploreProviderInputBound(params);
      const reservation = await reserveExploreCall({
        ...input,
        inputBound,
        maxOutputTokens: params.maxOutputTokens ?? 32_768,
        policy: exploreSpendPolicy(),
      });
      const result = await model.doStream({
        ...params,
        maxOutputTokens: reservation.maxOutputTokens,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.["openai"],
            reasoningEffort: "high",
          },
        },
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
  input: { ownerId: string; runId: string; model: string },
) => wrapLanguageModel({ model, middleware: exploreSpendMiddleware(input) });
