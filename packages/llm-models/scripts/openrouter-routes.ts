/**
 * OpenRouter route availability for the catalog cross-check.
 *
 * Separate from the pricing/context drift logic in `sync-from-upstreams.ts`
 * because it answers a different question about a different upstream: not "is
 * our price still right" but "can we still reach this model at all". A route
 * we list but OpenRouter no longer serves is a runtime outage waiting for the
 * first caller, and it is invisible to the pricing comparison.
 *
 * Pure: callers fetch the payloads and pass them in, so this stays unit
 * testable without network access.
 */
import { z } from "zod";
import type { ModelEntry } from "#src/index.ts";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_EMBEDDINGS_URL =
  "https://openrouter.ai/api/v1/embeddings/models";

// `.loose()`: we read only `id`, and OpenRouter adds fields regularly. A strict
// shape here would turn an unrelated upstream addition into a hard failure of
// the whole cross-check.
const OpenRouterCatalogSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) }).loose()),
});

/** The ids OpenRouter currently serves, split by the endpoint that serves them. */
export type OpenRouterRouteIndex = {
  readonly models: ReadonlySet<string>;
  readonly embeddings: ReadonlySet<string>;
};

export function indexOpenRouterRoutes(
  modelsRaw: unknown,
  embeddingsRaw: unknown,
): OpenRouterRouteIndex {
  return {
    models: new Set(
      OpenRouterCatalogSchema.parse(modelsRaw).data.map((entry) => entry.id),
    ),
    embeddings: new Set(
      OpenRouterCatalogSchema.parse(embeddingsRaw).data.map(
        (entry) => entry.id,
      ),
    ),
  };
}

/**
 * Why `id`'s OpenRouter route is unusable, or `undefined` when it is fine.
 *
 * Only `current` and `preview` models are checked: a `deprecated` entry is kept
 * for historical cost math, and OpenRouter dropping it is expected rather than
 * a regression.
 */
export function missingOpenRouterRoute(
  id: string,
  entry: ModelEntry,
  index: OpenRouterRouteIndex,
): string | undefined {
  if (entry.status !== "current" && entry.status !== "preview") {
    return undefined;
  }
  const route = entry.routes.openRouter;
  if (route === undefined) {
    return `${id} (route not configured)`;
  }
  const available =
    route.endpoint === "embedding"
      ? index.embeddings.has(route.modelId)
      : index.models.has(route.modelId);
  return available
    ? undefined
    : `${id} (${route.modelId} missing from ${route.endpoint} catalog)`;
}
