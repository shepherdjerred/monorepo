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
import catalogJson from "./catalog.json" with { type: "json" };

export const ProviderSchema = z.enum(["openai", "anthropic", "google"]);
export type Provider = z.infer<typeof ProviderSchema>;

/** USD per 1M tokens. `cachedInput` is OpenAI prompt-cache hits; `cacheRead`/`cacheWrite` are Anthropic cache reads/creations. */
export const TextPricingSchema = z.strictObject({
  modality: z.literal("text"),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cachedInput: z.number().nonnegative().optional(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});
export type TextPricing = z.infer<typeof TextPricingSchema>;

/** USD per generated image. */
export const ImagePricingSchema = z.strictObject({
  modality: z.literal("image"),
  perImage: z.number().nonnegative(),
});
export type ImagePricing = z.infer<typeof ImagePricingSchema>;

export const ModelPricingSchema = z.discriminatedUnion("modality", [
  TextPricingSchema,
  ImagePricingSchema,
]);
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ModelCapabilitiesSchema = z.strictObject({
  supportsTemperature: z.boolean(),
  supportsTopP: z.boolean(),
  maxTokens: z.number().int().positive().optional(),
  adaptiveThinking: z.boolean().optional(),
  effortTiers: z.array(z.string()).optional(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelStatusSchema = z.enum(["current", "preview", "deprecated"]);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

/** One reviewed divergence: what upstream published, and what we kept instead. */
export const AcceptedPriceSchema = z.strictObject({
  /** The upstream number the human saw and declined. */
  upstream: z.number().nonnegative(),
  /** The catalog number kept instead, so the pair can be re-verified later. */
  catalog: z.number().nonnegative(),
});
export type AcceptedPrice = z.infer<typeof AcceptedPriceSchema>;

export const ModelEntrySchema = z.strictObject({
  id: z.string().min(1),
  provider: ProviderSchema,
  displayName: z.string().min(1),
  description: z.string().optional(),
  pricing: ModelPricingSchema,
  contextWindow: z.number().int().positive().optional(),
  /** When true, the sync script will not overwrite contextWindow from upstream sources. */
  pinnedContextWindow: z.boolean().optional(),
  /**
   * A divergence a human looked at and decided to keep, so the sync script
   * stops re-reporting it every week.
   *
   * An acceptance is a claim about a PAIR — "upstream says `upstream`, we
   * deliberately hold `catalog`" — and both halves are checked. Recording only
   * the upstream number would let the catalog side drift away underneath the
   * decision: an intermediate plausible price gets applied, upstream later
   * returns to the accepted number, and the acceptance would then suppress a
   * catalog value nobody ever reviewed. Neither a blanket mute nor a
   * one-sided one is safe; this catalog feeds every cost calculation in the
   * repo, so a repricing must never pass silently.
   */
  acceptedUpstreamPricing: z
    .strictObject({
      input: AcceptedPriceSchema.optional(),
      output: AcceptedPriceSchema.optional(),
      /** Why the catalog value wins. Required — an unexplained mute rots. */
      reason: z.string().min(1),
      /**
       * When the acceptance lapses, as an ISO instant. Required, and not
       * optional on purpose: prices are time-bound, so an acceptance that
       * never expires is the rot this field exists to prevent. A date living
       * only in `reason` is prose the code cannot enforce — if the promotion
       * that justified the divergence is extended, an unexpiring acceptance
       * suppresses it forever with nothing to trigger re-adjudication. Past
       * this instant the divergence is reported again like any other.
       */
      // `offset: true` to match catalog.schema.json's RFC 3339 `date-time` and
      // the Python view. Zod's default accepts only `Z`, so an operator writing
      // a perfectly valid `-07:00` acceptance got a catalog every other
      // consumer reads and TypeScript alone refuses to import. A bare local
      // time stays rejected in all three: this is an instant, and an expiry
      // ambiguous by hours cannot decide whether a divergence is still accepted.
      expiresAt: z.iso.datetime({ offset: true }),
    })
    // An acceptance with neither price is well-formed and inert: `reconcile`
    // matches acceptances per field, so it can never suppress anything. It
    // would sit in the catalog carrying a reason and an expiry, reading like a
    // decision that was made while the divergence it names keeps re-alerting.
    // Omit the block entirely instead.
    .refine(
      (accepted) =>
        accepted.input !== undefined || accepted.output !== undefined,
      { message: "acceptedUpstreamPricing needs at least one of input/output" },
    )
    .optional(),
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
