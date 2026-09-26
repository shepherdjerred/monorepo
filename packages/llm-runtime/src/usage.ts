/**
 * Map an AI SDK call result onto the repository's token and cost shapes.
 *
 * This replaces the OpenRouter metadata parser. The gateway handed back a
 * dollar figure and its own routing story; first-party providers hand back
 * token counts and nothing else, so cost becomes arithmetic we do here against
 * the catalog. The inputs are richer than the gateway's were, which is why the
 * catalog grew per-TTL cache prices, service tiers, and per-request tool
 * charges to consume them.
 */
import {
  costForTextUsage,
  type CacheTtl,
  type Provider,
  type ServiceTier,
  type TextUsage,
} from "@shepherdjerred/llm-models";
import { z } from "zod";
import type { LlmCallMetadata, TokenBreakdown } from "./types.ts";

const ZERO_TOKENS: TokenBreakdown = {
  input: 0,
  output: 0,
  cachedInput: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
};

export function emptyTokenBreakdown(): TokenBreakdown {
  return { ...ZERO_TOKENS };
}

export function addTokenBreakdown(
  left: TokenBreakdown,
  right: TokenBreakdown,
): TokenBreakdown {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cachedInput: left.cachedInput + right.cachedInput,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    reasoning: left.reasoning + right.reasoning,
    total: left.total + right.total,
  };
}

/**
 * The AI SDK's `LanguageModelUsage`, as much of it as we consume.
 *
 * Every field is optional in the SDK's own type, so each one is defaulted
 * rather than assumed: a provider that omits a detail should cost zero for it,
 * not crash the call that already succeeded.
 */
const SdkUsageSchema = z
  .object({
    inputTokens: z.number().nullish(),
    outputTokens: z.number().nullish(),
    totalTokens: z.number().nullish(),
    inputTokenDetails: z
      .object({
        noCacheTokens: z.number().nullish(),
        cacheReadTokens: z.number().nullish(),
        cacheWriteTokens: z.number().nullish(),
      })
      .nullish(),
    outputTokenDetails: z
      .object({
        reasoningTokens: z.number().nullish(),
      })
      .nullish(),
    raw: z.record(z.string(), z.unknown()).nullish(),
  })
  .loose();

/**
 * Anthropic's raw `usage`, for the three things the SDK's normalized shape
 * does not carry. Each is a pricing dimension, so a missing one means the
 * catalog prices the call as standard rather than guessing.
 */
const AnthropicRawUsageSchema = z
  .object({
    service_tier: z.enum(["standard", "priority", "batch"]).nullish(),
    cache_creation: z
      .object({
        ephemeral_5m_input_tokens: z.number().nullish(),
        ephemeral_1h_input_tokens: z.number().nullish(),
      })
      .nullish(),
    server_tool_use: z
      .object({
        web_search_requests: z.number().nullish(),
      })
      .nullish(),
  })
  .loose();

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function tokenBreakdown(usage: unknown): TokenBreakdown {
  const parsed = SdkUsageSchema.safeParse(usage);
  if (!parsed.success) return emptyTokenBreakdown();
  const details = parsed.data.inputTokenDetails;
  const cachedInput = count(details?.cacheReadTokens);
  const cacheWrite = count(details?.cacheWriteTokens);
  // `noCacheTokens` is the uncached remainder the SDK already computed for both
  // upstream conventions. Falling back to the inclusive `inputTokens` total
  // would double-count cache reads against `cachedInput` below it.
  const input =
    details?.noCacheTokens == null
      ? Math.max(0, count(parsed.data.inputTokens) - cachedInput - cacheWrite)
      : count(details.noCacheTokens);
  const output = count(parsed.data.outputTokens);
  return {
    input,
    output,
    cachedInput,
    cacheWrite,
    reasoning: count(parsed.data.outputTokenDetails?.reasoningTokens),
    total:
      parsed.data.totalTokens == null
        ? input + cachedInput + cacheWrite + output
        : count(parsed.data.totalTokens),
  };
}

type RawPricingDimensions = {
  serviceTier?: ServiceTier | undefined;
  cacheWriteByTtl?: Partial<Record<CacheTtl, number>> | undefined;
  serverToolRequests?: { webSearch: number } | undefined;
};

/**
 * Pull the pricing dimensions a provider reports outside the normalized usage
 * shape. Only Anthropic reports any of them today; OpenAI and Google carry no
 * equivalent fields, so they price as standard with no TTL split.
 */
function rawPricingDimensions(
  provider: Provider | "unknown",
  raw: unknown,
): RawPricingDimensions {
  if (provider !== "anthropic") return {};
  const parsed = AnthropicRawUsageSchema.safeParse(raw);
  if (!parsed.success) return {};

  const creation = parsed.data.cache_creation;
  const fiveMinute = count(creation?.ephemeral_5m_input_tokens);
  const hour = count(creation?.ephemeral_1h_input_tokens);
  const webSearch = count(parsed.data.server_tool_use?.web_search_requests);

  return {
    serviceTier: parsed.data.service_tier ?? undefined,
    cacheWriteByTtl:
      creation == null
        ? undefined
        : {
            ...(fiveMinute > 0 && { "5m": fiveMinute }),
            ...(hour > 0 && { "1h": hour }),
          },
    serverToolRequests: webSearch > 0 ? { webSearch } : undefined,
  };
}

/**
 * The pricing view of a call: non-overlapping token counts plus whichever
 * pricing dimensions the provider reported.
 */
export function pricingUsage(
  tokens: TokenBreakdown,
  dimensions: RawPricingDimensions,
): TextUsage {
  return {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cachedInput,
    cacheWriteTokens: tokens.cacheWrite,
    ...(dimensions.cacheWriteByTtl !== undefined && {
      cacheWriteTokensByTtl: dimensions.cacheWriteByTtl,
    }),
    ...(dimensions.serviceTier !== undefined && {
      serviceTier: dimensions.serviceTier,
    }),
    ...(dimensions.serverToolRequests !== undefined && {
      serverToolRequests: dimensions.serverToolRequests,
    }),
  };
}

export function parseNativeUsage(input: {
  requestedModel: string;
  provider: Provider | "unknown";
  responseId?: string | undefined;
  resolvedModel?: string | undefined;
  usage: unknown;
}): LlmCallMetadata {
  const tokens = tokenBreakdown(input.usage);
  const parsed = SdkUsageSchema.safeParse(input.usage);
  const dimensions = rawPricingDimensions(
    input.provider,
    parsed.success ? parsed.data.raw : undefined,
  );

  return {
    requestedModel: input.requestedModel,
    provider: input.provider,
    ...(input.responseId !== undefined && { responseId: input.responseId }),
    ...(input.resolvedModel !== undefined && {
      resolvedModel: input.resolvedModel,
    }),
    ...(dimensions.serviceTier !== undefined && {
      serviceTier: dimensions.serviceTier,
    }),
    ...(dimensions.cacheWriteByTtl !== undefined && {
      cacheWriteByTtl: dimensions.cacheWriteByTtl,
    }),
    ...(dimensions.serverToolRequests !== undefined && {
      serverToolRequests: dimensions.serverToolRequests,
    }),
    tokens,
    catalogCostUsd: costForTextUsage(
      input.requestedModel,
      pricingUsage(tokens, dimensions),
    ),
  };
}
