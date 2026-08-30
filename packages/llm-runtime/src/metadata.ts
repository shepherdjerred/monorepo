import type { LanguageModelUsage, ProviderMetadata } from "ai";
import {
  costForTextUsage,
  getPricing,
  type TextPricing,
  type TextUsage,
} from "@shepherdjerred/llm-models";
import { z } from "zod";
import type {
  OpenRouterCallMetadata,
  OpenRouterTokenBreakdown,
} from "./types.ts";

const RouterAttemptSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    status: z.number().int(),
  })
  .loose();

const RouterMetadataSchema = z
  .object({
    requested: z.string().optional(),
    strategy: z.string().optional(),
    region: z.string().nullable().optional(),
    attempt: z.number().int().nonnegative().optional(),
    attempts: z.array(RouterAttemptSchema).optional(),
  })
  .loose();

const ResponseBodySchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
        prompt_tokens_details: z
          .object({
            cached_tokens: z.number().int().nonnegative().optional(),
            cache_write_tokens: z.number().int().nonnegative().optional(),
          })
          .loose()
          .optional(),
        completion_tokens_details: z
          .object({
            reasoning_tokens: z.number().int().nonnegative().optional(),
          })
          .loose()
          .optional(),
        cost: z.number().nonnegative().optional(),
        cost_details: z
          .object({
            upstream_inference_cost: z.number().nonnegative().optional(),
          })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
    data: z.array(z.unknown()).optional(),
    openrouter_metadata: RouterMetadataSchema.optional(),
  })
  .loose();

const OpenRouterProviderMetadataSchema = z
  .object({
    openrouter: z
      .object({
        provider: z.string().optional(),
        usage: z
          .object({
            promptTokens: z.number().nonnegative().optional(),
            completionTokens: z.number().nonnegative().optional(),
            totalTokens: z.number().nonnegative().optional(),
            promptTokensDetails: z
              .object({ cachedTokens: z.number().nonnegative().optional() })
              .loose()
              .optional(),
            completionTokensDetails: z
              .object({ reasoningTokens: z.number().nonnegative().optional() })
              .loose()
              .optional(),
            cost: z.number().nonnegative().optional(),
            costDetails: z
              .object({
                upstreamInferenceCost: z.number().nonnegative().optional(),
              })
              .loose()
              .optional(),
          })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const ZERO_TOKENS: OpenRouterTokenBreakdown = {
  input: 0,
  output: 0,
  cachedInput: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
};

export function tokenBreakdown(
  usage: LanguageModelUsage | undefined,
): OpenRouterTokenBreakdown {
  if (usage === undefined) return { ...ZERO_TOKENS };
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cachedInput: usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWrite: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    reasoning: usage.outputTokenDetails.reasoningTokens ?? 0,
    total: usage.totalTokens ?? 0,
  };
}

export function addTokenBreakdown(
  left: OpenRouterTokenBreakdown,
  right: OpenRouterTokenBreakdown,
): OpenRouterTokenBreakdown {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cachedInput: left.cachedInput + right.cachedInput,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    reasoning: left.reasoning + right.reasoning,
    total: left.total + right.total,
  };
}

export function emptyTokenBreakdown(): OpenRouterTokenBreakdown {
  return { ...ZERO_TOKENS };
}

type ParsedProviderData = z.infer<
  typeof OpenRouterProviderMetadataSchema
>["openrouter"];
type ParsedResponseBody = z.infer<typeof ResponseBodySchema>;
type ParsedRouterMetadata = z.infer<typeof RouterMetadataSchema>;

function providerData(
  metadata: ProviderMetadata | undefined,
): ParsedProviderData {
  const parsed = OpenRouterProviderMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data.openrouter : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

function responseBodyData(body: unknown): ParsedResponseBody | undefined {
  const parsed = ResponseBodySchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

function responseIdentity(input: {
  body: ParsedResponseBody | undefined;
  responseId: string | undefined;
  resolvedModel: string | undefined;
}): Pick<OpenRouterCallMetadata, "generationId" | "resolvedModel"> {
  return {
    generationId: nonEmpty(input.body?.id) ?? nonEmpty(input.responseId),
    resolvedModel: nonEmpty(input.body?.model) ?? nonEmpty(input.resolvedModel),
  };
}

function routingFields(input: {
  router: ParsedRouterMetadata | undefined;
  provider: ParsedProviderData;
  responseProvider: string | undefined;
  requestedModel: string;
}): Pick<
  OpenRouterCallMetadata,
  | "requestedModel"
  | "upstreamProvider"
  | "route"
  | "region"
  | "fallbackAttempts"
  | "attempts"
> {
  const attempts = input.router?.attempts ?? [];
  return {
    // Keep repository-owned stable ids as the requested identity. The router's
    // canonical route belongs in resolved metadata, not in this field.
    requestedModel: input.requestedModel,
    upstreamProvider:
      nonEmpty(input.provider?.provider) ??
      nonEmpty(input.responseProvider) ??
      nonEmpty(attempts.at(-1)?.provider),
    route: nonEmpty(input.router?.strategy),
    region: nonEmpty(input.router?.region ?? undefined),
    fallbackAttempts: Math.max(
      0,
      (input.router?.attempt ?? Math.max(1, attempts.length)) - 1,
    ),
    attempts,
  };
}

/**
 * Map our normalized breakdown onto the billing convention the requested
 * model's catalog entry actually declares.
 *
 * Anthropic entries price cache reads (`cacheRead`) and cache creations
 * (`cacheWrite`) with their own rates and expect `inputTokens` to exclude both;
 * OpenAI entries price a `cachedInput` subset of an inclusive `inputTokens`.
 * Sending cache reads as `cachedInputTokens` for an Anthropic model would fall
 * back to `pricing.input` — a 10x overcharge on Claude cache reads — and would
 * silently drop cache-creation cost entirely.
 *
 * OpenAI entries may additionally declare a separately billed cache write
 * (currently Luna), while ordinary OpenAI prompt caching has no write rate.
 */
function textUsageForPricing(
  pricing: TextPricing,
  tokens: OpenRouterTokenBreakdown,
): TextUsage {
  if (pricing.cacheRead !== undefined) {
    return {
      inputTokens: Math.max(0, tokens.input - tokens.cachedInput),
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cachedInput,
      cacheWriteTokens: tokens.cacheWrite,
    };
  }
  return {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cachedInputTokens: tokens.cachedInput,
    cacheWriteTokens: tokens.cacheWrite,
  };
}

function catalogCost(
  body: ParsedResponseBody | undefined,
  requestedModel: string,
  tokens: OpenRouterTokenBreakdown,
): number | undefined {
  const pricing = getPricing(requestedModel);
  if (pricing === undefined) return undefined;
  if (pricing.modality === "image") {
    return body?.data === undefined
      ? undefined
      : pricing.perImage * body.data.length;
  }
  if (tokens.total === 0 && tokens.input === 0 && tokens.output === 0) {
    return undefined;
  }
  return costForTextUsage(requestedModel, textUsageForPricing(pricing, tokens));
}

function costFields(
  provider: ParsedProviderData,
  body: ParsedResponseBody | undefined,
  requestedModel: string,
  tokens: OpenRouterTokenBreakdown,
): Pick<
  OpenRouterCallMetadata,
  "actualCostUsd" | "catalogCostUsd" | "upstreamCostUsd"
> {
  return {
    actualCostUsd: provider?.usage?.cost ?? body?.usage?.cost,
    catalogCostUsd: catalogCost(body, requestedModel, tokens),
    upstreamCostUsd:
      provider?.usage?.costDetails?.upstreamInferenceCost ??
      body?.usage?.cost_details?.upstream_inference_cost,
  };
}

function responseTokenBreakdown(
  usage: LanguageModelUsage | undefined,
  body: ParsedResponseBody | undefined,
): OpenRouterTokenBreakdown {
  return {
    input: inputTokens(usage, body),
    output: outputTokens(usage, body),
    cachedInput: cachedInputTokens(usage, body),
    cacheWrite: cacheWriteTokens(usage, body),
    reasoning: reasoningTokens(usage, body),
    total: totalTokens(usage, body),
  };
}

function inputTokens(
  usage: LanguageModelUsage | undefined,
  body: ParsedResponseBody | undefined,
): number {
  return usage?.inputTokens ?? body?.usage?.prompt_tokens ?? 0;
}

function outputTokens(
  usage: LanguageModelUsage | undefined,
  body: ParsedResponseBody | undefined,
): number {
  return usage?.outputTokens ?? body?.usage?.completion_tokens ?? 0;
}

function cachedInputTokens(
  usage: LanguageModelUsage | undefined,
  body: ParsedResponseBody | undefined,
): number {
  return (
    usage?.inputTokenDetails.cacheReadTokens ??
    body?.usage?.prompt_tokens_details?.cached_tokens ??
    0
  );
}

function cacheWriteTokens(
  usage: LanguageModelUsage | undefined,
  body: ParsedResponseBody | undefined,
): number {
  return (
    usage?.inputTokenDetails.cacheWriteTokens ??
    body?.usage?.prompt_tokens_details?.cache_write_tokens ??
    0
  );
}

function reasoningTokens(
  usage: LanguageModelUsage | undefined,
  body: ParsedResponseBody | undefined,
): number {
  return (
    usage?.outputTokenDetails.reasoningTokens ??
    body?.usage?.completion_tokens_details?.reasoning_tokens ??
    0
  );
}

function totalTokens(
  usage: LanguageModelUsage | undefined,
  body: ParsedResponseBody | undefined,
): number {
  return usage?.totalTokens ?? body?.usage?.total_tokens ?? 0;
}

export function parseOpenRouterMetadata(input: {
  requestedModel: string;
  responseId?: string | undefined;
  resolvedModel?: string | undefined;
  usage?: LanguageModelUsage | undefined;
  providerMetadata?: ProviderMetadata | undefined;
  responseBody?: unknown;
}): OpenRouterCallMetadata {
  const provider = providerData(input.providerMetadata);
  const body = responseBodyData(input.responseBody);
  const router = body?.openrouter_metadata;
  const tokens = responseTokenBreakdown(input.usage, body);

  return {
    ...responseIdentity({
      body,
      responseId: input.responseId,
      resolvedModel: input.resolvedModel,
    }),
    ...routingFields({
      router,
      provider,
      responseProvider: body?.provider,
      requestedModel: input.requestedModel,
    }),
    tokens,
    ...costFields(provider, body, input.requestedModel, tokens),
    routerMetadataPresent: router !== undefined,
  };
}
