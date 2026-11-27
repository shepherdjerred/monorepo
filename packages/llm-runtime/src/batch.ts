/**
 * Anthropic Message Batches: submit a set of requests, poll until the batch
 * ends, and collect typed results with their cost.
 *
 * Offline jobs (generating and judging tips ahead of time) pay half price on
 * the batch tier and can mark shared prompt prefixes with cache breakpoints.
 * The batch API takes no tool loop: a request that ends in a `tool_use` block
 * is answered by the caller, which appends the tool result and submits the
 * unfinished requests as the next batch.
 *
 * This is deliberately small. It does not retry a failed request (the outcome
 * says it failed) and it never decides what to do with a spend limit: callers
 * read `costUsd` from each outcome and account for it themselves.
 */
import { costForTextUsage, type CacheTtl } from "@shepherdjerred/llm-models";
import { z } from "zod";
import { createFederatedAnthropicFetch } from "./anthropic-federation.ts";
import type { AnthropicCredentials, RuntimeFetch } from "./types.ts";

const API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_POLL_MS = 15_000;
/** What the API accepts as a custom id. */
const CUSTOM_ID_PATTERN = /^[\w-]{1,64}$/u;

/** Where a cache breakpoint ends a reusable prefix. `1h` costs more to write and survives longer. */
export type BatchCacheControl = { type: "ephemeral"; ttl?: CacheTtl };

export type BatchTextBlock = {
  type: "text";
  text: string;
  cache_control?: BatchCacheControl;
};
export type BatchToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
export type BatchToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};
export type BatchContentBlock =
  BatchTextBlock | BatchToolUseBlock | BatchToolResultBlock;

/** A content block exactly as the API returned it (thinking blocks carry signatures that must be replayed). */
export type BatchRawBlock = Readonly<Record<string, unknown>>;

export type BatchMessage = {
  role: "user" | "assistant";
  content: string | readonly BatchContentBlock[] | readonly BatchRawBlock[];
};

export type BatchFunctionTool = {
  name: string;
  description: string;
  /** A JSON Schema object for the tool input. */
  inputSchema: Record<string, unknown>;
};

/**
 * A tool Anthropic runs on its servers (web search): declared by a versioned
 * `type`, executed inside the one request, never answered by the caller. Each
 * search is billed on top of the tokens.
 */
export type BatchServerTool = {
  /** Versioned type string, e.g. `web_search_20260209`. */
  type: string;
  name: string;
  /** Searches this one request may run. */
  maxUses?: number | undefined;
};

export type BatchTool = BatchFunctionTool | BatchServerTool;

/** USD per web search, on top of the tokens (Anthropic's published price: $10 per 1,000). */
export const WEB_SEARCH_USD = 0.01;

export type BatchRequest = {
  /** Unique within the batch; results come back under it. */
  customId: string;
  model: string;
  system?: string | readonly BatchTextBlock[] | undefined;
  messages: readonly BatchMessage[];
  maxTokens: number;
  tools?: readonly BatchTool[] | undefined;
  /** `none` forbids tool calls on this request even though tools are declared. */
  toolChoice?: "auto" | "none" | undefined;
  /** Structured output: a JSON Schema the final answer must match. */
  jsonSchema?: Record<string, unknown> | undefined;
  effort?: "low" | "medium" | "high" | undefined;
};

export type BatchUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Cache writes by TTL bucket, when the API reports them. */
  cacheWriteByTtl: Partial<Record<CacheTtl, number>>;
  /** Server-side web searches the request ran. */
  webSearchRequests?: number | undefined;
};

export type BatchOutcome =
  | {
      customId: string;
      status: "succeeded";
      /** The assistant's content blocks, text and tool_use. */
      content: readonly BatchContentBlock[];
      /**
       * Every block of the response as returned, thinking included. A tool
       * loop replays these as the assistant turn.
       */
      rawContent: readonly BatchRawBlock[];
      /** The concatenated text blocks. */
      text: string;
      stopReason: string;
      usage: BatchUsage;
      /** Catalog cost at the batch tier, including cache reads and writes. */
      costUsd: number;
    }
  | {
      customId: string;
      status: "errored" | "canceled" | "expired";
      error: string;
    };

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
  cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().int().nonnegative().optional(),
      ephemeral_1h_input_tokens: z.number().int().nonnegative().optional(),
    })
    .nullish(),
  server_tool_use: z
    .object({
      web_search_requests: z.number().int().nonnegative().optional(),
    })
    .nullish(),
});

const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown().default({}),
});

const ContentBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  // Thinking and other block types carry no answer; they are not replayed.
  z.object({ type: z.string() }).loose(),
]);

const ResultLineSchema = z.object({
  custom_id: z.string(),
  result: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("succeeded"),
      message: z.object({
        content: z.array(ContentBlockSchema),
        stop_reason: z.string().nullable(),
        usage: UsageSchema,
      }),
    }),
    z.object({
      type: z.literal("errored"),
      error: z.unknown(),
    }),
    z.object({ type: z.literal("canceled") }),
    z.object({ type: z.literal("expired") }),
  ]),
});

const BatchStatusSchema = z.object({
  id: z.string(),
  processing_status: z.enum(["in_progress", "canceling", "ended"]),
  results_url: z.string().nullish(),
  request_counts: z
    .object({
      processing: z.number().int(),
      succeeded: z.number().int(),
      errored: z.number().int(),
      canceled: z.number().int(),
      expired: z.number().int(),
    })
    .optional(),
});
export type BatchStatus = z.infer<typeof BatchStatusSchema>;

/** Keywords Anthropic's structured-output grammar does not accept. */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
]);

/** A zod-generated JSON Schema, with the keywords structured outputs reject removed and `oneOf` written as `anyOf`. */
export function toStructuredOutputSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => strip(item));
    }
    return value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key))
            // Zod writes a discriminated union as `oneOf`; the grammar takes `anyOf`.
            .map(([key, item]) => [
              key === "oneOf" ? "anyOf" : key,
              strip(item),
            ]),
        )
      : value;
  };
  const stripped = strip(schema);
  return typeof stripped === "object" && stripped !== null
    ? Object.fromEntries(Object.entries(stripped))
    : {};
}

export function toBatchUsage(raw: z.infer<typeof UsageSchema>): BatchUsage {
  const byTtl: Partial<Record<CacheTtl, number>> = {};
  const split = raw.cache_creation;
  if (split?.ephemeral_5m_input_tokens !== undefined) {
    byTtl["5m"] = split.ephemeral_5m_input_tokens;
  }
  if (split?.ephemeral_1h_input_tokens !== undefined) {
    byTtl["1h"] = split.ephemeral_1h_input_tokens;
  }
  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    cacheWriteTokens: raw.cache_creation_input_tokens ?? 0,
    cacheWriteByTtl: byTtl,
    webSearchRequests: raw.server_tool_use?.web_search_requests ?? 0,
  };
}

/**
 * The catalog cost of a turn, at the batch tier (half price) or the standard
 * tier. Throws when the model has no price on file: a silent zero would let a
 * budget overspend.
 */
export function batchCostUsd(
  model: string,
  usage: BatchUsage,
  tier: "batch" | "standard" = "batch",
): number {
  const cost = costForTextUsage(model, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    ...(Object.keys(usage.cacheWriteByTtl).length === 0
      ? {}
      : { cacheWriteTokensByTtl: usage.cacheWriteByTtl }),
    serviceTier: tier,
  });
  if (cost === undefined) {
    throw new Error(`no ${tier} price on file for ${model}`);
  }
  return cost + (usage.webSearchRequests ?? 0) * WEB_SEARCH_USD;
}

function paramsOf(request: BatchRequest): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (request.jsonSchema !== undefined) {
    output["format"] = { type: "json_schema", schema: request.jsonSchema };
  }
  if (request.effort !== undefined) {
    output["effort"] = request.effort;
  }
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    ...(request.system === undefined ? {} : { system: request.system }),
    messages: request.messages,
    ...(request.tools === undefined || request.tools.length === 0
      ? {}
      : {
          tools: request.tools.map((tool) =>
            "type" in tool
              ? {
                  type: tool.type,
                  name: tool.name,
                  ...(tool.maxUses === undefined
                    ? {}
                    : { max_uses: tool.maxUses }),
                }
              : {
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema,
                },
          ),
        }),
    ...(request.toolChoice === undefined
      ? {}
      : { tool_choice: { type: request.toolChoice } }),
    ...(Object.keys(output).length === 0 ? {} : { output_config: output }),
  };
}

function outcomeOf(line: z.infer<typeof ResultLineSchema>): BatchOutcome {
  const { custom_id: customId, result } = line;
  if (result.type === "succeeded") {
    const content = result.message.content.flatMap(
      (block): BatchContentBlock[] => {
        const text = TextBlockSchema.safeParse(block);
        if (text.success) {
          return [text.data];
        }
        const toolUse = ToolUseBlockSchema.safeParse(block);
        return toolUse.success ? [toolUse.data] : [];
      },
    );
    return {
      customId,
      status: "succeeded",
      content,
      rawContent: result.message.content.map((block) => ({ ...block })),
      text: content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(""),
      stopReason: result.message.stop_reason ?? "unknown",
      usage: toBatchUsage(result.message.usage),
      costUsd: 0,
    };
  }
  return {
    customId,
    status: result.type,
    error:
      result.type === "errored" ? JSON.stringify(result.error) : result.type,
  };
}

export type BatchClientOptions = {
  credentials: AnthropicCredentials;
  fetch?: RuntimeFetch | undefined;
  baseUrl?: string | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
};

export type BatchClient = {
  /** Create a batch; the id is what `wait` and `results` take. */
  submit: (requests: readonly BatchRequest[]) => Promise<string>;
  status: (id: string) => Promise<BatchStatus>;
  /** Poll until the batch has ended. */
  wait: (
    id: string,
    options?: {
      pollMs?: number;
      onPoll?: (status: BatchStatus) => void;
    },
  ) => Promise<BatchStatus>;
  /** The batch's results, one outcome per request, with cost at the batch tier. */
  results: (
    id: string,
    models: ReadonlyMap<string, string>,
  ) => Promise<BatchOutcome[]>;
  /** Submit, wait and collect. */
  run: (
    requests: readonly BatchRequest[],
    options?: { pollMs?: number; onPoll?: (status: BatchStatus) => void },
  ) => Promise<BatchOutcome[]>;
};

export function createAnthropicBatchClient(
  options: BatchClientOptions,
): BatchClient {
  const base = options.baseUrl ?? API_BASE;
  const baseFetch: RuntimeFetch =
    options.fetch ?? ((input, init) => fetch(input, init));
  const authenticated: RuntimeFetch =
    options.credentials.kind === "federation"
      ? createFederatedAnthropicFetch(options.credentials, { fetch: baseFetch })
      : baseFetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));

  async function call(
    path: string,
    init: { method: string; body?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
      ...(options.credentials.kind === "apiKey"
        ? { "x-api-key": options.credentials.apiKey }
        : {}),
    };
    const response = await authenticated(`${base}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Anthropic batch request ${init.method} ${path} failed: HTTP ${response.status.toString()} ${detail.slice(0, 300)}`,
      );
    }
    return response;
  }

  async function status(id: string): Promise<BatchStatus> {
    const response = await call(`/v1/messages/batches/${id}`, {
      method: "GET",
    });
    return BatchStatusSchema.parse(await response.json());
  }

  async function wait(
    id: string,
    waitOptions: {
      pollMs?: number;
      onPoll?: (status: BatchStatus) => void;
    } = {},
  ): Promise<BatchStatus> {
    for (;;) {
      const current = await status(id);
      waitOptions.onPoll?.(current);
      if (current.processing_status === "ended") {
        return current;
      }
      await sleep(waitOptions.pollMs ?? DEFAULT_POLL_MS);
    }
  }

  async function results(
    id: string,
    models: ReadonlyMap<string, string>,
  ): Promise<BatchOutcome[]> {
    const response = await call(`/v1/messages/batches/${id}/results`, {
      method: "GET",
    });
    const body = await response.text();
    const lines = body.split("\n").filter((line) => line.trim() !== "");
    return lines.map((line) => {
      const outcome = outcomeOf(ResultLineSchema.parse(JSON.parse(line)));
      if (outcome.status !== "succeeded") {
        return outcome;
      }
      const model = models.get(outcome.customId);
      if (model === undefined) {
        throw new Error(`batch result ${outcome.customId} was never requested`);
      }
      return { ...outcome, costUsd: batchCostUsd(model, outcome.usage) };
    });
  }

  async function submit(requests: readonly BatchRequest[]): Promise<string> {
    const bad = requests.find(
      (request) => !CUSTOM_ID_PATTERN.test(request.customId),
    );
    if (bad !== undefined) {
      throw new Error(
        `batch custom id "${bad.customId}" must match ${CUSTOM_ID_PATTERN.source}`,
      );
    }
    const ids = new Set(requests.map((request) => request.customId));
    if (ids.size !== requests.length) {
      throw new Error("batch requests need unique custom ids");
    }
    const response = await call("/v1/messages/batches", {
      method: "POST",
      body: JSON.stringify({
        requests: requests.map((request) => ({
          custom_id: request.customId,
          params: paramsOf(request),
        })),
      }),
    });
    return BatchStatusSchema.parse(await response.json()).id;
  }

  return {
    submit,
    status,
    wait,
    results,
    run: async (requests, runOptions = {}) => {
      const id = await submit(requests);
      await wait(id, runOptions);
      return results(
        id,
        new Map(requests.map((request) => [request.customId, request.model])),
      );
    },
  };
}
