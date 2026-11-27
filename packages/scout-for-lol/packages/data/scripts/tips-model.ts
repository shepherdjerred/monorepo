// The LLM-backed TipModel for the tip generator and its eval: the repository's
// LLM runtime (`createLlmRuntime`) with the AI SDK's tool loop on top, because
// `generateValidatedObject` takes no tools. Credentials come from the
// environment (`providerCredentialsFromEnv`); prices come from the model
// catalog. Run under the 1Password-backed wrapper:
//
//   scripts/onepassword/with-service-account.sh \
//     op run --env-file=<env file of op:// references> -- \
//     env -u OP_SERVICE_ACCOUNT_TOKEN bun packages/scout-for-lol/packages/data/scripts/generate-tips.ts ...
//
// The Anthropic reference is packages/dotfiles/private_dot_config/private_fish/anthropic.env.example;
// the OpenAI reference is the OPENAI_API_KEY line of packages/scout-for-lol/dev-web.env.tpl.

import { getPricing, requireNativeRoute } from "@shepherdjerred/llm-models";
import {
  createLlmRuntime,
  mergeProviderOptions,
  parseNativeUsage,
  providerCredentialsFromEnv,
  reasoningProviderOptions,
  requireCredentialsFor,
} from "@shepherdjerred/llm-runtime";
import {
  NoObjectGeneratedError,
  Output,
  generateText,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import {
  type TipModel,
  type TipModelPricing,
  type TipUsage,
  TipOutputError,
} from "#src/tips/model.ts";
import type { WikiRevisions } from "#src/tips/schema.ts";

export const DEFAULT_TIP_MODEL = "claude-haiku-5-5";
const WORKLOAD = "scout.tips";
const CALL_TIMEOUT_MS = 300_000;
/** Steps a tool loop may take; the last one is forced to answer. */
const MAX_STEPS = 8;

const LOOKUP_DESCRIPTION =
  "Read a page of the official League of Legends Wiki by its title, for example an item, a status such as Slow, a mechanic, or a champion's ability notes. Returns the page text, or the closest titles when no page has that title.";

export function tipModelPricing(modelId: string): TipModelPricing {
  const pricing = getPricing(modelId);
  if (pricing?.modality !== "text") {
    throw new Error(`no text pricing for model ${modelId}`);
  }
  return { inputPerMTok: pricing.input, outputPerMTok: pricing.output };
}

/** A model that cannot be called (for `--plan`, which spends nothing). */
export function offlineTipModel(modelId: string): TipModel {
  return {
    name: modelId,
    pricing: tipModelPricing(modelId),
    generate: () =>
      Promise.reject(new Error("this run has no model credentials")),
  };
}

type StepUsage = Parameters<typeof parseNativeUsage>[0]["usage"];

function stepCost(
  modelId: string,
  provider: ReturnType<typeof requireNativeRoute>["provider"],
  steps: readonly {
    usage: StepUsage;
    response: { id?: string | undefined; modelId?: string | undefined };
  }[],
): TipUsage {
  let usage: TipUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
  };
  for (const step of steps) {
    const metadata = parseNativeUsage({
      requestedModel: modelId,
      provider,
      responseId: step.response.id,
      resolvedModel: step.response.modelId,
      usage: step.usage,
    });
    usage = {
      inputTokens: usage.inputTokens + metadata.tokens.input,
      outputTokens: usage.outputTokens + metadata.tokens.output,
      cachedInputTokens: usage.cachedInputTokens + metadata.tokens.cachedInput,
      costUsd: usage.costUsd + (metadata.catalogCostUsd ?? 0),
    };
  }
  return usage;
}

export function createLlmTipModel(
  modelId: string,
  options: { reasoningEffort?: "low" | "medium" | "high" } = {},
): TipModel {
  const credentials = providerCredentialsFromEnv();
  requireCredentialsFor(modelId, credentials);
  const { provider } = requireNativeRoute(modelId, "language");
  const runtime = createLlmRuntime({
    credentials,
    service: "scout-data",
    appName: "scout-tips/1.0",
  });
  const reasoning = reasoningProviderOptions(
    provider,
    modelId,
    options.reasoningEffort ?? "low",
  );
  return {
    name: modelId,
    pricing: tipModelPricing(modelId),
    generate: async (request) => {
      const lookup = request.lookup;
      let toolCalls = 0;
      const lookedUp: Record<string, number> = {};
      const tools =
        lookup === undefined
          ? undefined
          : {
              lookup: tool({
                description: LOOKUP_DESCRIPTION,
                inputSchema: z.object({ title: z.string().min(1) }),
                execute: async ({ title }) => {
                  toolCalls += 1;
                  const result = await lookup(title);
                  Object.assign(lookedUp, result.pages);
                  return result.text;
                },
              }),
            };
      const callOptions = runtime.callOptions({
        workload: WORKLOAD,
        model: modelId,
      });
      const providerOptions = mergeProviderOptions(
        callOptions.providerOptions,
        reasoning,
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error("tip generation timed out"));
      }, CALL_TIMEOUT_MS);
      try {
        const result = await generateText({
          model: runtime.languageModel(
            modelId,
            tools === undefined
              ? ["structuredOutputs"]
              : ["structuredOutputs", "tools"],
          ),
          instructions: request.system,
          prompt: request.prompt,
          output: Output.object({
            schema: request.schema,
            name: request.schemaName,
          }),
          ...(tools === undefined
            ? {}
            : {
                tools,
                stopWhen: stepCountIs(MAX_STEPS),
                // Spend the last step answering rather than looking up more.
                prepareStep: ({ stepNumber }: { stepNumber: number }) =>
                  stepNumber >= MAX_STEPS - 1
                    ? { activeTools: [], toolChoice: "none" as const }
                    : undefined,
              }),
          maxOutputTokens: request.maxOutputTokens,
          maxRetries: 2,
          abortSignal: controller.signal,
          ...callOptions,
          ...(providerOptions === undefined ? {} : { providerOptions }),
        });
        const pages: WikiRevisions = lookedUp;
        return {
          object: result.output,
          usage: stepCost(modelId, provider, result.steps),
          cached: false,
          toolCalls,
          lookedUp: pages,
        };
      } catch (error: unknown) {
        if (NoObjectGeneratedError.isInstance(error)) {
          throw new TipOutputError(
            error.message,
            stepCost(modelId, provider, [
              {
                usage: error.usage,
                response: {
                  id: error.response?.id,
                  modelId: error.response?.modelId,
                },
              },
            ]),
            { cause: error },
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
