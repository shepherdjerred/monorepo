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

export const LongContextSurchargeSchema = z.strictObject({
  /** The surcharge applies only when the complete request exceeds this input-token count. */
  thresholdInputTokens: z.number().int().nonnegative(),
  inputMultiplier: z.number().positive(),
  outputMultiplier: z.number().positive(),
});
export type LongContextSurcharge = z.infer<typeof LongContextSurchargeSchema>;

/**
 * How long a cache entry lives. Providers charge a different write price per
 * TTL, so the bucket is a pricing dimension, not a detail.
 */
export const CacheTtlSchema = z.enum(["5m", "1h"]);
export type CacheTtl = z.infer<typeof CacheTtlSchema>;

/**
 * The billing tier a request ran under, as the provider reports it back.
 * `batch` is roughly half price; `priority` is a premium.
 */
export const ServiceTierSchema = z.enum(["standard", "priority", "batch"]);
export type ServiceTier = z.infer<typeof ServiceTierSchema>;

/** USD per 1M tokens. Cache fields describe provider-specific discounted reads and billed writes. */
export const TextPricingSchema = z.strictObject({
  modality: z.literal("text"),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cachedInput: z.number().nonnegative().optional(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
  /**
   * Per-TTL cache-write prices, where the provider charges by bucket. Takes
   * precedence over the flat `cacheWrite` for tokens whose TTL is known;
   * `cacheWrite` remains the fallback for a provider that reports an
   * undifferentiated total.
   */
  cacheWriteByTtl: z
    .strictObject({
      "5m": z.number().nonnegative().optional(),
      "1h": z.number().nonnegative().optional(),
    })
    .optional(),
  /**
   * Multipliers applied to the whole turn when the response reports a
   * non-standard `service_tier`. Absent means the model is not offered on that
   * tier, and a request claiming it is a contract violation worth failing on
   * rather than silently pricing at 1.0.
   */
  serviceTierMultipliers: z
    .strictObject({
      priority: z.number().positive().optional(),
      batch: z.number().positive().optional(),
    })
    .optional(),
  /**
   * Server-side tools the provider bills per request rather than per token.
   * USD per request, NOT per 1M — these are counted, not measured.
   */
  serverToolPricing: z
    .strictObject({
      webSearchPerRequest: z.number().nonnegative().optional(),
    })
    .optional(),
  longContextSurcharge: LongContextSurchargeSchema.optional(),
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
  inputModalities: z.array(z.enum(["text", "image", "audio", "video"])),
  outputModalities: z.array(z.enum(["text", "image", "embedding"])),
  tools: z.boolean(),
  structuredOutputs: z.boolean(),
  webSearch: z.boolean(),
  reasoning: z.boolean(),
  supportsTemperature: z.boolean(),
  supportsTopP: z.boolean(),
  maxTokens: z.number().int().positive().optional(),
  adaptiveThinking: z.boolean().optional(),
  effortTiers: z.array(z.string()).optional(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelEndpointSchema = z.enum(["language", "embedding", "image"]);
export type ModelEndpoint = z.infer<typeof ModelEndpointSchema>;

/**
 * How to reach this model on its first-party provider.
 *
 * `provider` is the transport, which is not always the creator: Claude served
 * through Vertex would carry `provider: "google"` with `ModelEntry.provider`
 * still `"anthropic"`. Keeping them separate is what lets cost attribution and
 * credential selection disagree when they legitimately should.
 */
export const NativeRouteSchema = z.strictObject({
  provider: ProviderSchema,
  modelId: z.string().min(1),
  endpoint: ModelEndpointSchema,
});
export type NativeRoute = z.infer<typeof NativeRouteSchema>;

export const NativeSdkRouteSchema = z.strictObject({
  modelId: z.string().min(1),
});
export type NativeSdkRoute = z.infer<typeof NativeSdkRouteSchema>;

export const ModelRoutesSchema = z.strictObject({
  /**
   * Optional on purpose: a model whose provider has retired it keeps its
   * catalog entry so historical spend still prices, but loses its route.
   * `requireNativeRoute` is what turns that into a loud failure at call time.
   */
  native: NativeRouteSchema.optional(),
  claudeAgentSdk: NativeSdkRouteSchema.optional(),
  codexSdk: NativeSdkRouteSchema.optional(),
});
export type ModelRoutes = z.infer<typeof ModelRoutesSchema>;

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
  routes: ModelRoutesSchema,
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

export function getNativeRoute(id: string): NativeRoute | undefined {
  return MODELS[id]?.routes.native;
}

// A provider route is not guaranteed to be unique: a dated snapshot and its
// undated alias can share one upstream model (anthropic's claude-haiku-4.5 is
// reached by both claude-haiku-4-5 and claude-haiku-4-5-20251001). A
// first-match reverse lookup would attribute every dated run to the alias, so
// ambiguous routes resolve to nothing and callers fall back to the raw route
// id — an unresolved route is recoverable, a confidently wrong one is not.
//
// Keyed by provider *and* model id, because two providers may legitimately
// serve the same upstream name (Claude on Anthropic and on Vertex).
function nativeRouteKey(provider: Provider, routeModelId: string): string {
  return `${provider} ${routeModelId}`;
}

const CATALOG_IDS_BY_NATIVE_ROUTE = ((): ReadonlyMap<
  string,
  readonly string[]
> => {
  const byRoute = new Map<string, string[]>();
  for (const model of Object.values(MODELS)) {
    const route = model.routes.native;
    if (route === undefined) continue;
    const key = nativeRouteKey(route.provider, route.modelId);
    const ids = byRoute.get(key) ?? [];
    ids.push(model.id);
    byRoute.set(key, ids);
  }
  return byRoute;
})();

/**
 * Resolve a provider route back to the repository's stable catalog id.
 *
 * Returns undefined when the route is unknown *or* when more than one catalog
 * entry claims it, so attribution never reports the wrong model.
 */
export function modelIdForNativeRoute(
  provider: Provider,
  routeModelId: string,
): string | undefined {
  const ids = CATALOG_IDS_BY_NATIVE_ROUTE.get(
    nativeRouteKey(provider, routeModelId),
  );
  return ids?.length === 1 ? ids[0] : undefined;
}

export function requireNativeRoute(
  id: string,
  endpoint?: ModelEndpoint,
): NativeRoute {
  const model = getModel(id);
  if (model === undefined) {
    throw new Error(`Unknown model id: ${id}`);
  }
  const route = model.routes.native;
  if (route === undefined) {
    throw new Error(`Model ${id} has no native provider route`);
  }
  if (endpoint !== undefined && route.endpoint !== endpoint) {
    throw new Error(
      `Model ${id} uses ${route.provider} ${route.endpoint}, not ${endpoint}`,
    );
  }
  return route;
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
  /**
   * Anthropic `usage.cache_creation`: the same tokens as `cacheWriteTokens`,
   * split by TTL bucket. When present this is authoritative and
   * `cacheWriteTokens` is ignored, because the two describe one quantity and
   * adding both would bill every cache write twice.
   */
  cacheWriteTokensByTtl?: Partial<Record<CacheTtl, number>>;
  /** The tier the provider reports the turn ran under. Absent means `standard`. */
  serviceTier?: ServiceTier;
  /** Server-side tool invocations, billed per request rather than per token. */
  serverToolRequests?: { webSearch?: number };
};

/**
 * Total USD for a text-model turn. Returns `undefined` for unknown or
 * image-only models, and for a turn this catalog cannot price honestly — a
 * non-standard service tier with no multiplier on file, or a billed server
 * tool with no per-request price. Callers surface that as "no list price on
 * file" rather than a confidently wrong number; the catalog-vs-billed
 * discrepancy alert is what catches a systematic gap.
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

  const tierMultiplier = serviceTierMultiplier(pricing, usage.serviceTier);
  if (tierMultiplier === undefined) {
    return undefined;
  }

  const toolCost = serverToolCost(pricing, usage.serverToolRequests);
  if (toolCost === undefined) {
    return undefined;
  }

  const cachedInput = usage.cachedInputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = cacheWriteCost(pricing, usage);
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInput);
  const billedInputTokens =
    usage.inputTokens + cacheRead + cacheWrite.billedTokens;
  const longContext = pricing.longContextSurcharge;
  const surchargeApplies =
    longContext !== undefined &&
    billedInputTokens > longContext.thresholdInputTokens;
  const inputMultiplier = surchargeApplies ? longContext.inputMultiplier : 1;
  const outputMultiplier = surchargeApplies ? longContext.outputMultiplier : 1;

  const tokenCost =
    (uncachedInput * pricing.input +
      cachedInput * (pricing.cachedInput ?? pricing.input) +
      cacheRead * cacheReadPrice(pricing) +
      cacheWrite.cost) *
      inputMultiplier +
    usage.outputTokens * pricing.output * outputMultiplier;

  return (tokenCost / 1_000_000 + toolCost) * tierMultiplier;
}

/**
 * Price per 1M for reading a cached prompt prefix.
 *
 * The two providers name this field differently and only one of them uses
 * `cacheRead`: Anthropic publishes an explicit cache-read rate, while OpenAI
 * calls the same thing `cachedInput`. Falling straight back to `input` would
 * bill an OpenAI cache read at the full uncached rate — a 10x overcharge on
 * gpt-5.4-nano — so `cachedInput` sits between them in the chain.
 */
function cacheReadPrice(pricing: TextPricing): number {
  return pricing.cacheRead ?? pricing.cachedInput ?? pricing.input;
}

/**
 * Cache-write tokens and their unscaled cost (still per 1M, like the other
 * token terms). The per-TTL breakdown wins where present, because it describes
 * the same tokens as the flat total at a more accurate price.
 */
function cacheWriteCost(
  pricing: TextPricing,
  usage: TextUsage,
): { billedTokens: number; cost: number } {
  const flat = pricing.cacheWrite ?? pricing.input;
  const byTtl = usage.cacheWriteTokensByTtl;
  if (byTtl === undefined) {
    const billedTokens = usage.cacheWriteTokens ?? 0;
    return { billedTokens, cost: billedTokens * flat };
  }
  const fiveMinute = byTtl["5m"] ?? 0;
  const hour = byTtl["1h"] ?? 0;
  return {
    billedTokens: fiveMinute + hour,
    cost:
      fiveMinute * (pricing.cacheWriteByTtl?.["5m"] ?? flat) +
      hour * (pricing.cacheWriteByTtl?.["1h"] ?? flat),
  };
}

/**
 * The whole-turn multiplier for a reported service tier, or `undefined` when
 * the model has no price on file for that tier.
 */
function serviceTierMultiplier(
  pricing: TextPricing,
  tier: ServiceTier | undefined,
): number | undefined {
  return tier === undefined || tier === "standard"
    ? 1
    : pricing.serviceTierMultipliers?.[tier];
}

/**
 * USD for per-request server tools, or `undefined` when a tool was billed and
 * no per-request price is on file.
 */
function serverToolCost(
  pricing: TextPricing,
  requests: TextUsage["serverToolRequests"],
): number | undefined {
  const webSearch = requests?.webSearch ?? 0;
  if (webSearch === 0) return 0;
  const perRequest = pricing.serverToolPricing?.webSearchPerRequest;
  return perRequest === undefined ? undefined : webSearch * perRequest;
}

/** Price independent requests without combining their context lengths. */
export function costForTextUsageByTurn(
  id: string,
  usages: readonly TextUsage[],
): number | undefined {
  let total = 0;
  for (const usage of usages) {
    const cost = costForTextUsage(id, usage);
    if (cost === undefined) return undefined;
    total += cost;
  }
  return total;
}

export function allModelIds(): string[] {
  return Object.keys(MODELS);
}

export function modelsByProvider(provider: Provider): ModelEntry[] {
  return Object.values(MODELS).filter((model) => model.provider === provider);
}
