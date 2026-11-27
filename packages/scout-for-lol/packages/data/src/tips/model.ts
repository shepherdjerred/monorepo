import { mkdir, rename } from "node:fs/promises";
import { z } from "zod";
import { type WikiRevisions, WikiRevisionsSchema } from "#src/tips/schema.ts";
import type { LookupResult } from "#src/tips/wiki.ts";

/**
 * The model boundary of the tip generator, and the two cost ideas Glitter's
 * context refresh uses, kept local because Glitter's versions live in the
 * Temporal worker, are written against its object store and throw Temporal
 * `ApplicationFailure`s, none of which this package can depend on:
 *
 * - a request-hash cache: one JSON file per (model, request), so an
 *   interrupted run, a retried drop or a changed validator never pays twice
 *   for a request already answered;
 * - a hard budget: every uncached call reserves its worst-case cost before it
 *   is made, so a run can never overshoot its limit by more than a rounding
 *   error.
 */

export type TipUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
};

export const EMPTY_USAGE: TipUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  costUsd: 0,
};

export function addUsage(left: TipUsage, right: TipUsage): TipUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

const TipUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

/** USD per million tokens. */
export type TipModelPricing = { inputPerMTok: number; outputPerMTok: number };

/** The wiki `lookup` tool a model may call: a page title in, page text out. */
export type WikiLookup = (title: string) => Promise<LookupResult>;

export type TipModelRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
  /** When set, the model may call a `lookup` tool that reads the League of Legends Wiki. */
  lookup?: WikiLookup | undefined;
};

export type TipModelResult<T> = {
  object: T;
  usage: TipUsage;
  /** True when the answer came from the request cache and cost nothing. */
  cached: boolean;
  /** How many times the model called `lookup`. */
  toolCalls: number;
  /** The wiki pages those calls returned, page title to revision id. */
  lookedUp: WikiRevisions;
};

export type TipModel = {
  /** The model id stamped into every set it writes. */
  readonly name: string;
  readonly pricing: TipModelPricing;
  generate: <T>(request: TipModelRequest<T>) => Promise<TipModelResult<T>>;
};

/** The model answered but never in the requested shape. The call was billed. */
export class TipOutputError extends Error {
  readonly usage: TipUsage;

  constructor(message: string, usage: TipUsage, options?: ErrorOptions) {
    super(message, options);
    this.name = "TipOutputError";
    this.usage = usage;
  }
}

/** The call failed after being billed (for example a transport error on a retry). */
export class TipCallError extends Error {
  readonly usage: TipUsage;

  constructor(message: string, usage: TipUsage, options?: ErrorOptions) {
    super(message, options);
    this.name = "TipCallError";
    this.usage = usage;
  }
}

export class TipBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TipBudgetExceededError";
  }
}

/** Upper bound on tokens in a text: one per UTF-8 byte, as Glitter's budget does. */
export function tokenUpperBound(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function costUsd(
  pricing: TipModelPricing,
  tokens: { input: number; output: number },
): number {
  return (
    (tokens.input * pricing.inputPerMTok +
      tokens.output * pricing.outputPerMTok) /
    1_000_000
  );
}

export type BudgetSummary = {
  maxCostUsd: number;
  spentUsd: number;
  calls: number;
  cacheHits: number;
  cachedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export class GenerationBudget {
  readonly #maxCostUsd: number;
  #spentUsd = 0;
  #reservedUsd = 0;
  #calls = 0;
  #cacheHits = 0;
  #cachedCostUsd = 0;
  #inputTokens = 0;
  #outputTokens = 0;

  constructor(maxCostUsd: number) {
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      throw new Error("the generation budget must be a positive number");
    }
    this.#maxCostUsd = maxCostUsd;
  }

  /** Reserve a call's worst-case cost, or refuse before any money is spent. */
  reserve(worstCaseUsd: number): void {
    if (this.#spentUsd + this.#reservedUsd + worstCaseUsd > this.#maxCostUsd) {
      throw new TipBudgetExceededError(
        `budget exhausted: $${this.#spentUsd.toFixed(4)} spent, $${worstCaseUsd.toFixed(4)} worst case for the next call, $${this.#maxCostUsd.toFixed(2)} limit`,
      );
    }
    this.#reservedUsd += worstCaseUsd;
  }

  /** Settle a reservation with what the call really cost. */
  settle(worstCaseUsd: number, usage: TipUsage): void {
    this.#reservedUsd -= worstCaseUsd;
    this.#spentUsd += usage.costUsd;
    this.#calls += 1;
    this.#inputTokens += usage.inputTokens;
    this.#outputTokens += usage.outputTokens;
  }

  recordCacheHit(usage: TipUsage): void {
    this.#cacheHits += 1;
    this.#cachedCostUsd += usage.costUsd;
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  summary(): BudgetSummary {
    return {
      maxCostUsd: this.#maxCostUsd,
      spentUsd: this.#spentUsd,
      calls: this.#calls,
      cacheHits: this.#cacheHits,
      cachedCostUsd: this.#cachedCostUsd,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
    };
  }
}

const CacheEntrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  model: z.string().min(1),
  requestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  object: z.unknown(),
  usage: TipUsageSchema,
  toolCalls: z.number().int().nonnegative().default(0),
  lookedUp: WikiRevisionsSchema.default({}),
});

export function requestSha256(
  model: string,
  request: Pick<
    TipModelRequest<unknown>,
    "system" | "prompt" | "schemaName" | "maxOutputTokens"
  > & { tools: boolean },
  salt = "",
): string {
  return new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify([
        model,
        request.schemaName,
        request.maxOutputTokens,
        request.tools,
        request.system,
        request.prompt,
        salt,
      ]),
    )
    .digest("hex");
}

async function readCacheEntry(
  path: string,
): Promise<z.infer<typeof CacheEntrySchema> | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  const value: unknown = await file.json();
  return CacheEntrySchema.parse(value);
}

async function writeCacheEntry(
  path: string,
  entry: z.infer<typeof CacheEntrySchema>,
): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, JSON.stringify(entry));
  await rename(temporary, path);
}

/**
 * Wrap a model with the request cache (when `cacheDirectory` is set) and the
 * budget. A cache hit costs nothing and is not charged; a miss reserves its
 * worst case, calls the model, caches the raw answer and settles the real
 * usage. A call that fails after being billed still settles its usage.
 */
export function meteredModel(input: {
  model: TipModel;
  budget: GenerationBudget;
  cacheDirectory?: string | undefined;
  /** Mixed into every request key, so a second run of the same eval asks the model again. */
  salt?: string | undefined;
}): TipModel {
  const { model, budget, cacheDirectory } = input;
  return {
    name: model.name,
    pricing: model.pricing,
    generate: async <T>(
      request: TipModelRequest<T>,
    ): Promise<TipModelResult<T>> => {
      const sha = requestSha256(
        model.name,
        { ...request, tools: request.lookup !== undefined },
        input.salt,
      );
      const path =
        cacheDirectory === undefined
          ? undefined
          : `${cacheDirectory}/${sha}.json`;
      if (path !== undefined) {
        const entry = await readCacheEntry(path);
        if (entry !== undefined) {
          if (entry.requestSha256 !== sha || entry.model !== model.name) {
            throw new Error(
              `request cache entry ${path} does not match its key`,
            );
          }
          budget.recordCacheHit(entry.usage);
          return {
            object: request.schema.parse(entry.object),
            usage: entry.usage,
            cached: true,
            toolCalls: entry.toolCalls,
            lookedUp: entry.lookedUp,
          };
        }
      }
      const worstCase = costUsd(model.pricing, {
        input:
          tokenUpperBound(request.system) + tokenUpperBound(request.prompt),
        output: request.maxOutputTokens,
      });
      budget.reserve(worstCase);
      try {
        const result = await model.generate(request);
        budget.settle(worstCase, result.usage);
        if (path !== undefined) {
          await mkdir(cacheDirectory ?? "", { recursive: true });
          await writeCacheEntry(path, {
            schemaVersion: 1,
            model: model.name,
            requestSha256: sha,
            object: result.object,
            usage: result.usage,
            toolCalls: result.toolCalls,
            lookedUp: result.lookedUp,
          });
        }
        return result;
      } catch (error: unknown) {
        budget.settle(
          worstCase,
          error instanceof TipOutputError || error instanceof TipCallError
            ? error.usage
            : EMPTY_USAGE,
        );
        throw error;
      }
    },
  };
}
