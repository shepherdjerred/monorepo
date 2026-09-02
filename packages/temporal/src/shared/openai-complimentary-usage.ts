import { z } from "zod";

const CompletionResultSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    model: z.string().min(1),
    service_tier: z.string().min(1),
  })
  .loose();

const CostResultSchema = z
  .object({
    amount: z.object({ value: z.number().nonnegative(), currency: z.string() }),
    project_id: z.string().min(1),
  })
  .loose();

function usagePageSchema<RESULT extends z.ZodType>(result: RESULT) {
  return z
    .object({
      object: z.literal("page"),
      data: z.array(
        z
          .object({
            start_time: z.number().int().nonnegative(),
            end_time: z.number().int().nonnegative(),
            results: z.array(result),
          })
          .loose(),
      ),
      has_more: z.boolean(),
      next_page: z.string().min(1).nullable(),
    })
    .loose();
}

export type OpenAiUsageTokenRow = {
  readonly model: string;
  readonly serviceTier: string;
  readonly type: "input" | "output";
  readonly tokens: number;
};

export type OpenAiComplimentaryUsageResult = {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly observedAt: string;
  readonly tokenRows: readonly OpenAiUsageTokenRow[];
  readonly defaultTierTokens: number;
  readonly costUsd: number;
};

export type OpenAiUsageClientInput = {
  readonly adminKey: string;
  readonly projectId: string;
  readonly now: Date;
  readonly cancellationSignal?: AbortSignal;
  readonly fetcher?: OpenAiUsageFetch;
};

export type OpenAiUsageFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function utcMidnightSeconds(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      1000,
  );
}

function pageCursor(page: {
  readonly has_more: boolean;
  readonly next_page: string | null;
}): string | undefined {
  if (!page.has_more) return undefined;
  if (page.next_page === null) {
    throw new Error("OpenAI returned has_more without a next_page cursor");
  }
  return page.next_page;
}

async function fetchPage(input: {
  readonly url: URL;
  readonly adminKey: string;
  readonly fetcher: OpenAiUsageFetch;
  readonly cancellationSignal: AbortSignal | undefined;
}): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(30_000);
  const signal =
    input.cancellationSignal === undefined
      ? timeoutSignal
      : AbortSignal.any([input.cancellationSignal, timeoutSignal]);
  const response = await input.fetcher(input.url, {
    headers: { authorization: `Bearer ${input.adminKey}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `OpenAI organization API request failed: ${String(response.status)} ${await response.text()}`,
    );
  }
  return await response.json();
}

async function fetchPagedResults<RESULT extends z.ZodType>(input: {
  readonly path: string;
  readonly bucketWidth: string;
  readonly limit: number;
  readonly groupBy: readonly string[];
  readonly schema: RESULT;
  readonly startTime: number;
  readonly endTime: number;
  readonly adminKey: string;
  readonly projectId: string;
  readonly fetcher: OpenAiUsageFetch;
  readonly cancellationSignal: AbortSignal | undefined;
}): Promise<z.infer<RESULT>[]> {
  const results: z.infer<RESULT>[] = [];
  const PageSchema = usagePageSchema(input.schema);
  let cursor: string | undefined;
  do {
    const url = new URL(`https://api.openai.com/v1/organization/${input.path}`);
    url.searchParams.set("start_time", String(input.startTime));
    url.searchParams.set("end_time", String(input.endTime));
    url.searchParams.set("bucket_width", input.bucketWidth);
    url.searchParams.append("project_ids", input.projectId);
    for (const groupBy of input.groupBy) {
      url.searchParams.append("group_by", groupBy);
    }
    url.searchParams.set("limit", String(input.limit));
    if (cursor !== undefined) url.searchParams.set("page", cursor);
    const page = PageSchema.parse(
      await fetchPage({
        url,
        adminKey: input.adminKey,
        fetcher: input.fetcher,
        cancellationSignal: input.cancellationSignal,
      }),
    );
    for (const bucket of page.data) results.push(...bucket.results);
    cursor = pageCursor(page);
  } while (cursor !== undefined);
  return results;
}

function aggregateTokenRows(
  results: readonly z.infer<typeof CompletionResultSchema>[],
): OpenAiUsageTokenRow[] {
  const totals = new Map<string, OpenAiUsageTokenRow>();
  for (const result of results) {
    for (const [type, tokens] of [
      ["input", result.input_tokens],
      ["output", result.output_tokens],
    ] as const) {
      const key = `${result.model}\u{0}${result.service_tier}\u{0}${type}`;
      const previous = totals.get(key);
      totals.set(key, {
        model: result.model,
        serviceTier: result.service_tier,
        type,
        tokens: (previous?.tokens ?? 0) + tokens,
      });
    }
  }
  return [...totals.values()];
}

export async function fetchOpenAiComplimentaryUsage(
  input: OpenAiUsageClientInput,
): Promise<OpenAiComplimentaryUsageResult> {
  const fetcher = input.fetcher ?? fetch;
  const endTime = Math.floor((input.now.getTime() - 15 * 60 * 1000) / 1000);
  const cutoff = new Date(endTime * 1000);
  const startTime = utcMidnightSeconds(cutoff);
  const common = {
    startTime,
    endTime,
    adminKey: input.adminKey,
    projectId: input.projectId,
    fetcher,
    cancellationSignal: input.cancellationSignal,
  };
  const [completions, costs] = await Promise.all([
    fetchPagedResults({
      ...common,
      path: "usage/completions",
      bucketWidth: "1h",
      limit: 24,
      groupBy: ["model", "service_tier"],
      schema: CompletionResultSchema,
    }),
    fetchPagedResults({
      ...common,
      path: "costs",
      bucketWidth: "1d",
      limit: 31,
      groupBy: ["project_id"],
      schema: CostResultSchema,
    }),
  ]);
  const tokenRows = aggregateTokenRows(completions);
  return {
    windowStart: new Date(startTime * 1000).toISOString(),
    windowEnd: new Date(endTime * 1000).toISOString(),
    observedAt: input.now.toISOString(),
    tokenRows,
    defaultTierTokens: tokenRows
      .filter((row) => row.serviceTier === "default")
      .reduce((total, row) => total + row.tokens, 0),
    costUsd: costs.reduce((total, row) => total + row.amount.value, 0),
  };
}
