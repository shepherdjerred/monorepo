// Offline model calls on the Message Batches API: half price, with the shared
// part of each prompt marked as a cache breakpoint. The batch API has no tool
// loop, so a request that ends in a `lookup` tool call is answered locally and
// resubmitted in the next round, until every job has an answer.
//
// Spend is guarded the same way as the interactive path: every round reserves
// the worst case of its requests (at the batch price, with the output capped by
// `maxTokens`) before it is submitted, and settles the real cost after.

import {
  type BatchCacheControl,
  type BatchClient,
  type BatchMessage,
  type BatchRawBlock,
  type BatchRequest,
  type BatchUsage,
  batchCostUsd,
  createAnthropicBatchClient,
  toStructuredOutputSchema,
} from "@shepherdjerred/llm-runtime/batch";
import { providerCredentialsFromEnv } from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import {
  type GenerationBudget,
  type WikiLookup,
  tokenUpperBound,
} from "#src/tips/model.ts";
import type { WikiRevisions } from "#src/tips/schema.ts";

/** Characters per input token measured on these prompts, padded for safety. */
const CHARS_PER_TOKEN = 1.3;
const LOOKUP_DESCRIPTION =
  "Read a page of the official League of Legends Wiki by its title, for example an item, a status such as Slow, a mechanic, or a champion's ability notes. Returns the page text, or the closest titles when no page has that title.";
const LOOKUP_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
};

/**
 * Searches a run may spend in all. A job asks for what it may use; the limit
 * grants up to what is left and takes back what the job did not use.
 */
export class SearchLimit {
  readonly #max: number;
  #used = 0;
  #granted = 0;

  constructor(max: number) {
    this.#max = max;
  }

  grant(want: number): number {
    const give = Math.max(
      0,
      Math.min(want, this.#max - this.#used - this.#granted),
    );
    this.#granted += give;
    return give;
  }

  settle(granted: number, used: number): void {
    this.#granted -= granted;
    this.#used += used;
  }

  get used(): number {
    return this.#used;
  }

  get max(): number {
    return this.#max;
  }
}

/** Input tokens one dynamic-filtering search adds (measured: a search request read 37,579 input tokens against 13,266 for the basic tool). */
const SEARCH_TOKEN_ALLOWANCE = 40_000;

export type SearchTool = {
  /** Versioned tool type, e.g. `web_search_20260209`. */
  type: string;
  /** Searches this one job may run, in all its rounds. */
  maxUses: number;
};

export type BatchJob<T> = {
  id: string;
  model: string;
  system: string;
  /** What jobs of one champion share; the cache breakpoint ends it. */
  prefix: string;
  rest: string;
  schema: z.ZodType<T>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  lookup?: WikiLookup | undefined;
  /** The server-side web search tool, when this job may use it. */
  search?: SearchTool | undefined;
};

export type BatchJobResult<T> = {
  id: string;
  /** The answer, or why there is none. */
  outcome: { status: "ok"; object: T } | { status: "failed"; reason: string };
  /** Token totals across every round of the job. */
  tokens: BatchUsage;
  /** What the job cost at the batch tier, cache reads and writes included. */
  costUsd: number;
  /** The same tokens at the standard price with no caching, for the savings comparison. */
  listUsd: number;
  toolCalls: number;
  lookedUp: WikiRevisions;
  rounds: number;
  /** Web searches the job ran. */
  searches: number;
  /** URLs of the pages the searches returned or cited; the only search data kept. */
  searchUrls: string[];
  /**
   * Text of the search results the model saw, for the copying check. Held in
   * memory for the call and never written anywhere.
   */
  searchTexts: string[];
};

type JobState<T> = {
  job: BatchJob<T>;
  messages: BatchMessage[];
  tokens: BatchUsage;
  costUsd: number;
  toolCalls: number;
  lookedUp: Record<string, number>;
  rounds: number;
  searches: number;
  searchUrls: Set<string>;
  searchTexts: string[];
  /** Searches granted for the round being run. */
  granted: number;
  /** Searches the limit granted that are still unspent across the job's rounds. */
  searchesLeft: number;
  result: BatchJobResult<T>["outcome"] | undefined;
};

const NO_TOKENS: BatchUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWriteByTtl: {},
};

function addTokens(left: BatchUsage, right: BatchUsage): BatchUsage {
  const byTtl: BatchUsage["cacheWriteByTtl"] = { ...left.cacheWriteByTtl };
  for (const [ttl, count] of Object.entries(right.cacheWriteByTtl)) {
    if (ttl === "5m" || ttl === "1h") {
      byTtl[ttl] = (byTtl[ttl] ?? 0) + count;
    }
  }
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    cacheWriteByTtl: byTtl,
    webSearchRequests:
      (left.webSearchRequests ?? 0) + (right.webSearchRequests ?? 0),
  };
}

/** The standard-tier price of the same tokens with nothing cached. */
export function listPriceUsd(model: string, tokens: BatchUsage): number {
  return batchCostUsd(
    model,
    {
      ...NO_TOKENS,
      inputTokens:
        tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens,
      outputTokens: tokens.outputTokens,
    },
    "standard",
  );
}

function firstUserMessage(
  job: BatchJob<unknown>,
  cache: BatchCacheControl | undefined,
): BatchMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `${job.prefix}\n\n`,
        ...(cache === undefined ? {} : { cache_control: cache }),
      },
      { type: "text", text: job.rest },
    ],
  };
}

function requestFor<T>(
  state: JobState<T>,
  schema: Record<string, unknown>,
  final: boolean,
): BatchRequest {
  const { job } = state;
  const tools: NonNullable<BatchRequest["tools"]> = [
    ...(job.lookup === undefined
      ? []
      : [
          {
            name: "lookup",
            description: LOOKUP_DESCRIPTION,
            inputSchema: LOOKUP_SCHEMA,
          },
        ]),
    ...(job.search === undefined || state.granted <= 0
      ? []
      : [
          {
            type: job.search.type,
            name: "web_search",
            maxUses: state.granted,
          },
        ]),
  ];
  return {
    customId: job.id,
    model: job.model,
    system: job.system,
    messages: state.messages,
    maxTokens: job.maxTokens,
    ...(tools.length === 0
      ? {}
      : {
          tools,
          ...(final ? { toolChoice: "none" as const } : {}),
        }),
    jsonSchema: schema,
    effort: job.effort,
  };
}

/** Everything a response's search blocks reveal: result URLs, and the text the model read (titles, citations, filtered excerpts). */
function searchEvidence(blocks: readonly BatchRawBlock[]): {
  urls: string[];
  texts: string[];
} {
  const urls: string[] = [];
  const texts: string[] = [];
  const strings = (value: unknown): string[] => {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => strings(item));
    }
    return value !== null && typeof value === "object"
      ? Object.values(value).flatMap((item) => strings(item))
      : [];
  };
  for (const block of blocks) {
    const type = block["type"];
    if (type === "web_search_tool_result" && Array.isArray(block["content"])) {
      for (const result of block["content"]) {
        if (result !== null && typeof result === "object") {
          const url: unknown = Reflect.get(result, "url");
          const title: unknown = Reflect.get(result, "title");
          if (typeof url === "string") {
            urls.push(url);
          }
          if (typeof title === "string") {
            texts.push(title);
          }
        }
      }
    } else if (
      typeof type === "string" &&
      type.endsWith("_tool_result") &&
      type !== "web_search_tool_result"
    ) {
      // Dynamic filtering runs code over the results; its output is what the model read.
      texts.push(...strings(block["content"]));
    } else if (type === "text" && Array.isArray(block["citations"])) {
      for (const citation of block["citations"]) {
        if (citation !== null && typeof citation === "object") {
          const url: unknown = Reflect.get(citation, "url");
          const cited: unknown = Reflect.get(citation, "cited_text");
          if (typeof url === "string") {
            urls.push(url);
          }
          if (typeof cited === "string") {
            texts.push(cited);
          }
        }
      }
    }
  }
  return { urls, texts };
}

/** The most a request can cost: every input token written to the cache at its premium, the output at the cap. */
function worstCaseUsd(request: BatchRequest, writeFactor: number): number {
  const chars =
    tokenUpperBound(JSON.stringify(request.system ?? "")) +
    tokenUpperBound(JSON.stringify(request.messages));
  const searches = (request.tools ?? []).reduce(
    (sum, tool) => sum + ("maxUses" in tool ? (tool.maxUses ?? 0) : 0),
    0,
  );
  return batchCostUsd(request.model, {
    ...NO_TOKENS,
    inputTokens:
      Math.ceil((chars / CHARS_PER_TOKEN) * writeFactor) +
      searches * SEARCH_TOKEN_ALLOWANCE,
    outputTokens: request.maxTokens,
    webSearchRequests: searches,
  });
}

const LookupInputSchema = z.object({ title: z.string() });

async function answerTools<T>(
  state: JobState<T>,
  blocks: readonly BatchRawBlock[],
): Promise<void> {
  const lookup = state.job.lookup;
  const results: {
    type: "tool_result";
    tool_use_id: string;
    content: string;
  }[] = [];
  for (const block of blocks) {
    if (block["type"] !== "tool_use" || typeof block["id"] !== "string") {
      continue;
    }
    const input = LookupInputSchema.safeParse(block["input"]);
    state.toolCalls += 1;
    if (lookup === undefined || !input.success) {
      results.push({
        type: "tool_result",
        tool_use_id: block["id"],
        content: "That tool call could not be run.",
      });
      continue;
    }
    const answer = await lookup(input.data.title);
    Object.assign(state.lookedUp, answer.pages);
    results.push({
      type: "tool_result",
      tool_use_id: block["id"],
      content: answer.text,
    });
  }
  state.messages.push(
    { role: "assistant", content: blocks },
    { role: "user", content: results },
  );
}

/**
 * Run the jobs to completion in as many batch rounds as tool calls need (at
 * most `maxRounds`; the last round forbids tools so every job ends with an
 * answer). A job that fails stays failed; nothing is retried.
 */
export async function runBatchJobs<T>(
  client: BatchClient,
  jobs: readonly BatchJob<T>[],
  options: {
    budget: GenerationBudget;
    /** The run's search allowance; a job gets no search tool once it is spent. */
    searches?: SearchLimit | undefined;
    cache?: BatchCacheControl | undefined;
    maxRounds?: number;
    pollMs?: number;
    log?: ((line: string) => void) | undefined;
  },
): Promise<BatchJobResult<T>[]> {
  const maxRounds = options.maxRounds ?? 4;
  const log = options.log ?? (() => undefined);
  const states: JobState<T>[] = jobs.map((job) => ({
    job,
    messages: [firstUserMessage(job, options.cache)],
    tokens: NO_TOKENS,
    costUsd: 0,
    toolCalls: 0,
    lookedUp: {},
    rounds: 0,
    searches: 0,
    searchUrls: new Set<string>(),
    searchTexts: [],
    granted: 0,
    searchesLeft: 0,
    result: undefined,
  }));
  const schemas = new Map(
    jobs.map((job) => [
      job.id,
      toStructuredOutputSchema(z.toJSONSchema(job.schema, { io: "output" })),
    ]),
  );

  for (let round = 1; round <= maxRounds; round += 1) {
    const pending = states.filter((state) => state.result === undefined);
    if (pending.length === 0) {
      break;
    }
    for (const state of pending) {
      // A job's search allowance is granted once, on its first round, and a
      // later round (a lookup answer, a paused turn) draws on what is left.
      if (state.job.search !== undefined) {
        if (state.rounds === 0) {
          state.searchesLeft = options.searches
            ? options.searches.grant(state.job.search.maxUses)
            : state.job.search.maxUses;
        }
        state.granted = state.searchesLeft;
      }
    }
    const requests = pending.map((state) =>
      requestFor(state, schemas.get(state.job.id) ?? {}, round === maxRounds),
    );
    const writeFactor =
      options.cache === undefined ? 1 : options.cache.ttl === "5m" ? 1.25 : 2;
    const worst = requests.reduce(
      (sum, request) => sum + worstCaseUsd(request, writeFactor),
      0,
    );
    options.budget.reserve(worst);
    let outcomes;
    try {
      outcomes = await client.run(requests, {
        ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
        onPoll: (status) => {
          log(
            `round ${round.toString()}: ${status.processing_status} ${JSON.stringify(status.request_counts ?? {})}`,
          );
        },
      });
    } catch (error: unknown) {
      options.budget.settle(worst, {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
      });
      throw error;
    }
    let spent = 0;
    const byId = new Map(
      outcomes.map((outcome) => [outcome.customId, outcome]),
    );
    for (const state of pending) {
      state.rounds += 1;
      const outcome = byId.get(state.job.id);
      if (outcome === undefined || outcome.status !== "succeeded") {
        state.result = {
          status: "failed",
          reason:
            outcome === undefined
              ? "the batch returned no result for this request"
              : outcome.error,
        };
        continue;
      }
      state.tokens = addTokens(state.tokens, outcome.usage);
      state.costUsd += outcome.costUsd;
      spent += outcome.costUsd;
      const ran = outcome.usage.webSearchRequests ?? 0;
      state.searches += ran;
      state.searchesLeft = Math.max(0, state.searchesLeft - ran);
      const evidence = searchEvidence(outcome.rawContent);
      for (const url of evidence.urls) {
        state.searchUrls.add(url);
      }
      state.searchTexts.push(...evidence.texts);
      if (outcome.stopReason === "pause_turn") {
        // The server's search loop paused; send its work back to continue.
        state.messages.push({ role: "assistant", content: outcome.rawContent });
        continue;
      }
      const calls = outcome.rawContent.some(
        (block) => block["type"] === "tool_use",
      );
      if (outcome.stopReason === "tool_use" && calls) {
        await answerTools(state, outcome.rawContent);
        continue;
      }
      if (outcome.stopReason === "max_tokens") {
        state.result = {
          status: "failed",
          reason: "the answer hit max_tokens",
        };
        continue;
      }
      try {
        state.result = {
          status: "ok",
          object: state.job.schema.parse(JSON.parse(outcome.text)),
        };
      } catch (error: unknown) {
        state.result = {
          status: "failed",
          reason: `the answer did not match the requested shape: ${error instanceof Error ? error.message.slice(0, 200) : "unparseable"}`,
        };
      }
    }
    options.budget.settle(worst, {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: spent,
    });
  }

  // Searches a job was granted but did not use go back to the run's allowance.
  if (options.searches !== undefined) {
    for (const state of states) {
      if (state.job.search !== undefined) {
        options.searches.settle(
          state.searches + state.searchesLeft,
          state.searches,
        );
      }
    }
  }

  return states.map((state) => ({
    id: state.job.id,
    outcome: state.result ?? {
      status: "failed",
      reason: "no answer within the round limit",
    },
    tokens: state.tokens,
    costUsd: state.costUsd,
    listUsd: listPriceUsd(state.job.model, state.tokens),
    toolCalls: state.toolCalls,
    lookedUp: state.lookedUp,
    rounds: state.rounds,
    searches: state.searches,
    searchUrls: [...state.searchUrls],
    searchTexts: state.searchTexts,
  }));
}

export function createTipBatchClient(): BatchClient {
  const credentials = providerCredentialsFromEnv().anthropic;
  if (credentials === undefined) {
    throw new Error(
      "no Anthropic credentials: set ANTHROPIC_API_KEY or the federation variables",
    );
  }
  return createAnthropicBatchClient({
    credentials,
    fetch: retryingFetch,
  });
}

const NETWORK_RETRIES = 40;
const NETWORK_RETRY_MS = 15_000;

/**
 * A batch runs for minutes to tens of minutes, long enough for a local network
 * blip (a failed DNS lookup, a reset connection) to land on a poll. A request
 * that did not complete is sent again when that is safe, so the
 * run waits the blip out instead of losing a paid batch.
 */
async function retryingFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error ? String(error.code) : "";
      // A failed lookup never reached the API; a reset or timeout may have, so
      // only a read is sent again after one.
      const neverSent = ["ENOTFOUND", "EAI_AGAIN"].includes(code);
      const maybeSent = ["ECONNRESET", "ETIMEDOUT"].includes(code);
      const isRead = (init?.method ?? "GET") === "GET";
      const retryable = neverSent || (maybeSent && isRead);
      if (!retryable || attempt >= NETWORK_RETRIES) {
        throw error;
      }
      await Bun.sleep(NETWORK_RETRY_MS);
    }
  }
}
