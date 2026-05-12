/**
 * Embedding provider with primary-then-fallback semantics for the
 * pr-review-bot dismissed-comments learning loop (Phase 9 of
 * packages/docs/plans/2026-05-10_sota-pr-review-bot.md).
 *
 * Primary: Voyage AI `voyage-3-lite` via REST API. 384-d output.
 * Fallback: `@xenova/transformers` running `Xenova/bge-small-en-v1.5`
 * locally in-process. 384-d output.
 *
 * Both produce 384-dimensional vectors so Redis-stored entries are
 * provider-agnostic — we can swap providers without migrating dismissed-
 * comment records. Cosine similarity stays meaningful across mixed
 * provider history because the threshold (0.85) was calibrated for
 * single-provider stability; mixed history widens the band slightly but
 * dedupe is best-effort by design.
 *
 * The fallback triggers on:
 *   - missing `VOYAGE_API_KEY` (e.g., 1P field unset in dev)
 *   - HTTP 429 (rate limit)
 *   - HTTP 5xx
 *   - network error / timeout (5s)
 *
 * If both providers fail the caller receives `null` and is expected to
 * fail-closed (keep the finding, do not dedupe).
 */
import { z } from "zod/v4";
import {
  prReviewEmbeddingFallbackTotal,
  prReviewEmbeddingUnavailableTotal,
} from "#observability/pr-review-metrics.ts";

export const EMBEDDING_DIM = 384;
const VOYAGE_TIMEOUT_MS = 5000;
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite";

const VoyageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: z.array(z.number()).length(EMBEDDING_DIM),
      }),
    )
    .min(1),
});

export type EmbeddingProvider = "voyage" | "local";

export type EmbeddingResult = {
  /** 384-dim unit-length float vector. */
  readonly vector: readonly number[];
  /** Which provider produced the vector. */
  readonly provider: EmbeddingProvider;
};

/**
 * Minimal `fetch` shape used by the Voyage call. Declared as a function
 * type rather than `typeof fetch` so tests can pass plain async lambdas
 * without satisfying the full Bun/DOM fetch surface (which carries a
 * `preconnect` field tests don't need).
 */
export type VoyageFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type EmbedDeps = {
  /** Override for tests; defaults to `Bun.env.VOYAGE_API_KEY`. */
  readonly voyageApiKey?: string | undefined;
  /** Override for tests; defaults to the real Voyage REST endpoint. */
  readonly voyageFetch?: VoyageFetch;
  /** Override for tests; defaults to dynamic import of `@xenova/transformers`. */
  readonly localEmbedder?: (text: string) => Promise<readonly number[]>;
};

let cachedLocalPipeline: ((text: string) => Promise<readonly number[]>) | null =
  null;

/**
 * Dynamic-import @xenova/transformers lazily so the worker process doesn't
 * pay the ~200 MB cold-start cost unless Voyage is unavailable. The
 * pipeline is cached for the worker lifetime once created.
 */
async function loadLocalPipeline(): Promise<
  (text: string) => Promise<readonly number[]>
> {
  if (cachedLocalPipeline !== null) return cachedLocalPipeline;
  // The transformers package isn't a hard dep — it's loaded on first
  // fallback. Specify the import path indirectly so TypeScript's static
  // module resolver doesn't require the package to be installed in the
  // typecheck environment. Runtime guards then narrow the pipeline
  // factory + the extractor return shape to the (well-documented)
  // @xenova surface.
  const moduleId = "@xenova/transformers";
  const mod: unknown = await import(moduleId);
  if (
    typeof mod !== "object" ||
    mod === null ||
    !("pipeline" in mod) ||
    typeof mod.pipeline !== "function"
  ) {
    throw new TypeError(
      "@xenova/transformers did not expose a pipeline factory",
    );
  }
  const factory = mod.pipeline;
  // Reflect.apply preserves the unknown-call surface while satisfying
  // the lint rule that bans calling a bare `Function` type.
  const extractorUnknown: unknown = await Reflect.apply(factory, undefined, [
    "feature-extraction",
    "Xenova/bge-small-en-v1.5",
  ]);
  if (typeof extractorUnknown !== "function") {
    throw new TypeError(
      "@xenova/transformers pipeline factory did not return a callable extractor",
    );
  }
  const extractor = extractorUnknown;
  const embed = async (text: string): Promise<readonly number[]> => {
    const output: unknown = await Reflect.apply(extractor, undefined, [
      text,
      { pooling: "mean", normalize: true },
    ]);
    if (
      typeof output !== "object" ||
      output === null ||
      !("data" in output) ||
      !(output.data instanceof Float32Array)
    ) {
      throw new TypeError(
        "@xenova/transformers extractor returned an unexpected shape",
      );
    }
    return [...output.data];
  };
  cachedLocalPipeline = embed;
  return embed;
}

/**
 * Voyage AI request — returns `null` and triggers fallback on any error.
 * Errors are intentionally NOT thrown: callers always need a vector to
 * proceed (or `null` for fail-closed), and the fallback handles the
 * "Voyage is dead" case transparently.
 */
async function voyageEmbed(
  text: string,
  apiKey: string,
  fetchImpl: VoyageFetch,
): Promise<
  { readonly vector: readonly number[] } | { readonly fallbackReason: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, VOYAGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [text],
        model: VOYAGE_MODEL,
        input_type: "document",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        fallbackReason:
          response.status === 429
            ? "rate-limit"
            : `http-${String(response.status)}`,
      };
    }
    const parsed = VoyageResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { fallbackReason: "schema-mismatch" };
    }
    const vector = parsed.data.data[0]?.embedding;
    if (vector === undefined) {
      return { fallbackReason: "empty-response" };
    }
    return { vector };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { fallbackReason: "timeout" };
    }
    return { fallbackReason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embed a single normalized claim string. Tries Voyage first; falls back
 * to local @xenova/transformers on missing key, rate-limit, 5xx, or
 * timeout. Returns `null` if both providers fail — caller must fail-closed.
 *
 * Emits Prometheus counters for fallback and unavailability so the
 * dashboard surfaces provider health without coupling business logic.
 */
export async function embedClaim(
  text: string,
  deps: EmbedDeps = {},
): Promise<EmbeddingResult | null> {
  const apiKey = deps.voyageApiKey ?? Bun.env["VOYAGE_API_KEY"] ?? "";
  const fetchImpl = deps.voyageFetch ?? fetch;
  const localEmbedder = deps.localEmbedder;

  let fallbackReason: string;
  if (apiKey === "") {
    fallbackReason = "no-key";
  } else {
    const primary = await voyageEmbed(text, apiKey, fetchImpl);
    if ("vector" in primary) {
      return { vector: primary.vector, provider: "voyage" };
    }
    fallbackReason = primary.fallbackReason;
  }

  prReviewEmbeddingFallbackTotal.inc({ reason: fallbackReason });
  try {
    const local = localEmbedder ?? (await loadLocalPipeline());
    const vector = await local(text);
    if (vector.length !== EMBEDDING_DIM) {
      prReviewEmbeddingUnavailableTotal.inc();
      return null;
    }
    return { vector, provider: "local" };
  } catch {
    prReviewEmbeddingUnavailableTotal.inc();
    return null;
  }
}

/**
 * Cosine similarity between two same-length float vectors. Returns 0 for
 * a zero-vector input (defensive — Voyage/bge always return unit-norm
 * vectors so this branch is unreachable in practice).
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [i, ai] of a.entries()) {
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
