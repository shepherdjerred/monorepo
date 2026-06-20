/**
 * `@shepherdjerred/llm-models` — language-neutral catalog of the active LLM
 * models we use, with pricing and capabilities.
 *
 * The source of truth is `catalog.json` (read by every language). This module
 * is the TypeScript view: it validates the JSON with Zod at load and exposes
 * typed accessors. Python consumers validate the same JSON with Pydantic.
 *
 * Units: token prices are **USD per 1,000,000 tokens**; image prices are
 * **USD per image**.
 */
import { z } from "zod";
import catalogJson from "#catalog.json" with { type: "json" };

export const ProviderSchema = z.enum(["openai", "anthropic", "google"]);
export type Provider = z.infer<typeof ProviderSchema>;

/** USD per 1M tokens. `cachedInput` is OpenAI prompt-cache hits; `cacheRead`/`cacheWrite` are Anthropic cache reads/creations. */
export const TextPricingSchema = z.object({
  modality: z.literal("text"),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cachedInput: z.number().nonnegative().optional(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});
export type TextPricing = z.infer<typeof TextPricingSchema>;

/** USD per generated image. */
export const ImagePricingSchema = z.object({
  modality: z.literal("image"),
  perImage: z.number().nonnegative(),
});
export type ImagePricing = z.infer<typeof ImagePricingSchema>;

export const ModelPricingSchema = z.discriminatedUnion("modality", [
  TextPricingSchema,
  ImagePricingSchema,
]);
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ModelCapabilitiesSchema = z.object({
  supportsTemperature: z.boolean(),
  supportsTopP: z.boolean(),
  maxTokens: z.number().int().positive().optional(),
  adaptiveThinking: z.boolean().optional(),
  effortTiers: z.array(z.string()).optional(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelStatusSchema = z.enum(["current", "preview", "deprecated"]);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  provider: ProviderSchema,
  displayName: z.string().min(1),
  description: z.string().optional(),
  pricing: ModelPricingSchema,
  contextWindow: z.number().int().positive().optional(),
  capabilities: ModelCapabilitiesSchema,
  status: ModelStatusSchema,
  category: z.string().optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const CatalogSchema = z
  .record(z.string(), ModelEntrySchema)
  .refine(
    (cat) => Object.entries(cat).every(([key, entry]) => key === entry.id),
    {
      message: "catalog key must equal entry.id",
    },
  );
export type Catalog = z.infer<typeof CatalogSchema>;

/** The validated catalog, keyed by model id. Throws at import time if `catalog.json` is malformed. */
export const MODELS: Catalog = CatalogSchema.parse(catalogJson);

/** A model id known to the catalog. Validated at runtime (no compile-time literal union — the source is JSON). */
export type ModelId = string;

export function isModelId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODELS, id);
}

export function assertModelId(id: string): void {
  if (!isModelId(id)) {
    throw new Error(`Unknown model id: ${id}`);
  }
}

export function getModel(id: string): ModelEntry | undefined {
  return MODELS[id];
}

export function getPricing(id: string): ModelPricing | undefined {
  return MODELS[id]?.pricing;
}

/** Per-token (not per-1M) text pricing, for callers that accumulate raw token counts (e.g. monarch). */
export function getPerTokenPricing(
  id: string,
): { input: number; output: number } | undefined {
  const pricing = MODELS[id]?.pricing;
  if (pricing?.modality !== "text") {
    return undefined;
  }
  return {
    input: pricing.input / 1_000_000,
    output: pricing.output / 1_000_000,
  };
}

export type TextUsage = {
  inputTokens: number;
  outputTokens: number;
  /** OpenAI: cached-input tokens (a subset of `inputTokens`, billed at the cached rate). */
  cachedInputTokens?: number;
  /** Anthropic: cache-read tokens (separate from `inputTokens`). */
  cacheReadTokens?: number;
  /** Anthropic: cache-creation tokens (separate from `inputTokens`). */
  cacheWriteTokens?: number;
};

/**
 * Total USD for a text-model turn. Returns `undefined` for unknown or
 * image-only models (callers can surface "no list price on file").
 *
 * Handles both billing conventions: OpenAI passes `cachedInputTokens` as a
 * subset of `inputTokens`; Anthropic passes `cacheRead/WriteTokens` separately
 * and `inputTokens` already excludes them.
 */
export function costForTextUsage(
  id: string,
  usage: TextUsage,
): number | undefined {
  const pricing = MODELS[id]?.pricing;
  if (pricing?.modality !== "text") {
    return undefined;
  }
  const cachedInput = usage.cachedInputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInput);
  const total =
    uncachedInput * pricing.input +
    cachedInput * (pricing.cachedInput ?? pricing.input) +
    cacheRead * (pricing.cacheRead ?? pricing.input) +
    cacheWrite * (pricing.cacheWrite ?? pricing.input) +
    usage.outputTokens * pricing.output;
  return total / 1_000_000;
}

export function allModelIds(): string[] {
  return Object.keys(MODELS);
}

export function modelsByProvider(provider: Provider): ModelEntry[] {
  return Object.values(MODELS).filter((model) => model.provider === provider);
}
