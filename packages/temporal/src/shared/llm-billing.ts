/**
 * Billed LLM spend, read from each provider's own cost report.
 *
 * This is the other half of cost accounting. The runtime prices every call from
 * the catalog as it happens, which is attributed and immediate but only as
 * right as the catalog and blind to anything that never passes through it —
 * the Codex runner, voice, the Whisper bridge. The provider's cost report is
 * what was actually charged, including every discount the catalog cannot know
 * about, of which OpenAI's data-sharing complimentary tokens are the large one.
 *
 * Google is absent on purpose: Cloud Billing has no API for spend to date, only
 * a daily export to BigQuery, which is a separate piece of work.
 */
import { z } from "zod";

export type BillingFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

/** One provider account's billed spend. */
export type BilledAccountCost = {
  readonly provider: "openai" | "anthropic";
  /** Human-readable project or workspace name, for a bounded metric label. */
  readonly account: string;
  /** The current UTC day so far. */
  readonly todayUsd: number;
  /** The trailing seven UTC days, today included. */
  readonly trailingSevenDaysUsd: number;
};

/** OpenAI token usage for the current UTC day, per project, model, and tier. */
export type BilledTokenRow = {
  readonly provider: "openai";
  readonly account: string;
  readonly model: string;
  readonly serviceTier: string;
  readonly type: "input" | "output";
  readonly tokens: number;
};

export type LlmBillingSnapshot = {
  readonly observedAt: string;
  readonly costs: readonly BilledAccountCost[];
  readonly tokens: readonly BilledTokenRow[];
};

const DAY_SECONDS = 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 30_000;

/** The label for spend no named project or workspace owns. */
export const DEFAULT_ACCOUNT = "default";

function utcMidnightSeconds(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      1000,
  );
}

async function getJson(input: {
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly fetcher: BillingFetch;
  readonly cancellationSignal: AbortSignal | undefined;
  readonly provider: string;
}): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal =
    input.cancellationSignal === undefined
      ? timeout
      : AbortSignal.any([input.cancellationSignal, timeout]);
  const response = await input.fetcher(input.url, {
    headers: input.headers,
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `${input.provider} billing request failed: ${String(response.status)} ${await response.text()}`,
    );
  }
  return await response.json();
}

// ---------------------------------------------------------------- OpenAI ----

const OpenAiPageSchema = <RESULT extends z.ZodType>(result: RESULT) =>
  z
    .object({
      data: z.array(
        z
          .object({
            start_time: z.number().int().nonnegative(),
            results: z.array(result),
          })
          .loose(),
      ),
      has_more: z.boolean(),
      next_page: z.string().min(1).nullable(),
    })
    .loose();

const OpenAiCostResultSchema = z
  .object({
    amount: z.object({ value: z.number(), currency: z.string() }),
    project_id: z.string().min(1).nullable(),
  })
  .loose();

const OpenAiCompletionResultSchema = z
  .object({
    project_id: z.string().min(1).nullable(),
    model: z.string().min(1),
    service_tier: z.string().min(1),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  })
  .loose();

/** OpenAI projects and Anthropic workspaces list with the same page shape. */
const AccountListSchema = z
  .object({
    data: z.array(z.object({ id: z.string(), name: z.string() }).loose()),
    has_more: z.boolean(),
    last_id: z.string().nullable().optional(),
  })
  .loose();

/**
 * Map every account id to its display name, following the list's `last_id`
 * cursor. Archived accounts are included because their spend still bills.
 */
async function accountNames(input: {
  readonly url: string;
  readonly cursorParam: "after" | "after_id";
  readonly headers: Record<string, string>;
  readonly provider: "OpenAI" | "Anthropic";
  readonly fetcher: BillingFetch;
  readonly cancellationSignal: AbortSignal | undefined;
}): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  let after: string | undefined;
  do {
    const url = new URL(input.url);
    url.searchParams.set("limit", "100");
    url.searchParams.set("include_archived", "true");
    if (after !== undefined) url.searchParams.set(input.cursorParam, after);
    const page = AccountListSchema.parse(
      await getJson({
        url,
        headers: input.headers,
        fetcher: input.fetcher,
        cancellationSignal: input.cancellationSignal,
        provider: input.provider,
      }),
    );
    for (const account of page.data) names.set(account.id, account.name);
    after = page.has_more ? (page.last_id ?? undefined) : undefined;
  } while (after !== undefined);
  return names;
}

/**
 * The next page cursor, or undefined when the listing is complete. A page that
 * claims more results without a cursor would loop or silently truncate, so it
 * fails instead.
 */
function nextCursor(
  provider: "OpenAI" | "Anthropic",
  hasMore: boolean,
  cursor: string | null | undefined,
): string | undefined {
  if (!hasMore) return undefined;
  if (cursor === null || cursor === undefined) {
    throw new Error(`${provider} returned has_more without a next_page cursor`);
  }
  return cursor;
}

type AccountTotals = Map<string, { today: number; week: number }>;

function addCost(
  totals: AccountTotals,
  account: string,
  usd: number,
  isToday: boolean,
): void {
  const current = totals.get(account) ?? { today: 0, week: 0 };
  current.week += usd;
  if (isToday) current.today += usd;
  totals.set(account, current);
}

function openAiUrl(
  path: string,
  params: Record<string, string | readonly string[]>,
  cursor: string | undefined,
): URL {
  const url = new URL(`https://api.openai.com/v1/organization/${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string") url.searchParams.set(name, value);
    else for (const item of value) url.searchParams.append(name, item);
  }
  if (cursor !== undefined) url.searchParams.set("page", cursor);
  return url;
}

async function openAiPages<RESULT extends z.ZodType>(input: {
  readonly path: string;
  readonly params: Record<string, string | readonly string[]>;
  readonly schema: RESULT;
  readonly adminKey: string;
  readonly fetcher: BillingFetch;
  readonly cancellationSignal: AbortSignal | undefined;
}): Promise<{ startTime: number; result: z.infer<RESULT> }[]> {
  const rows: { startTime: number; result: z.infer<RESULT> }[] = [];
  const PageSchema = OpenAiPageSchema(input.schema);
  let cursor: string | undefined;
  do {
    const page = PageSchema.parse(
      await getJson({
        url: openAiUrl(input.path, input.params, cursor),
        headers: { authorization: `Bearer ${input.adminKey}` },
        fetcher: input.fetcher,
        cancellationSignal: input.cancellationSignal,
        provider: "OpenAI",
      }),
    );
    rows.push(
      ...page.data.flatMap((bucket) =>
        bucket.results.map((result) => ({
          startTime: bucket.start_time,
          result,
        })),
      ),
    );
    cursor = nextCursor("OpenAI", page.has_more, page.next_page);
  } while (cursor !== undefined);
  return rows;
}

function openAiProjectNames(input: {
  readonly adminKey: string;
  readonly fetcher: BillingFetch;
  readonly cancellationSignal: AbortSignal | undefined;
}): Promise<ReadonlyMap<string, string>> {
  return accountNames({
    url: "https://api.openai.com/v1/organization/projects",
    cursorParam: "after",
    headers: { authorization: `Bearer ${input.adminKey}` },
    provider: "OpenAI",
    fetcher: input.fetcher,
    cancellationSignal: input.cancellationSignal,
  });
}

function accountName(
  names: ReadonlyMap<string, string>,
  id: string | null,
): string {
  if (id === null) return DEFAULT_ACCOUNT;
  // An id the listing did not return is still a real account; label it by id
  // rather than folding it into another one's spend.
  return names.get(id) ?? id;
}

export async function fetchOpenAiBilling(input: {
  readonly adminKey: string;
  readonly now: Date;
  readonly fetcher?: BillingFetch;
  readonly cancellationSignal?: AbortSignal;
}): Promise<{ costs: BilledAccountCost[]; tokens: BilledTokenRow[] }> {
  const fetcher = input.fetcher ?? fetch;
  const today = utcMidnightSeconds(input.now);
  const weekStart = today - 6 * DAY_SECONDS;
  const end = Math.floor(input.now.getTime() / 1000);
  const common = {
    adminKey: input.adminKey,
    fetcher,
    cancellationSignal: input.cancellationSignal,
  };
  const [names, costRows, usageRows] = await Promise.all([
    openAiProjectNames(common),
    openAiPages({
      ...common,
      path: "costs",
      params: {
        start_time: String(weekStart),
        end_time: String(end),
        bucket_width: "1d",
        limit: "7",
        group_by: ["project_id"],
      },
      schema: OpenAiCostResultSchema,
    }),
    openAiPages({
      ...common,
      path: "usage/completions",
      params: {
        start_time: String(today),
        end_time: String(end),
        bucket_width: "1d",
        limit: "1",
        group_by: ["project_id", "model", "service_tier"],
      },
      schema: OpenAiCompletionResultSchema,
    }),
  ]);

  const byAccount: AccountTotals = new Map();
  for (const { startTime, result } of costRows) {
    addCost(
      byAccount,
      accountName(names, result.project_id),
      result.amount.value,
      startTime >= today,
    );
  }

  const tokens: BilledTokenRow[] = [];
  for (const { result } of usageRows) {
    const account = accountName(names, result.project_id);
    for (const [type, count] of [
      ["input", result.input_tokens],
      ["output", result.output_tokens],
    ] as const) {
      tokens.push({
        provider: "openai",
        account,
        model: result.model,
        serviceTier: result.service_tier,
        type,
        tokens: count,
      });
    }
  }

  return {
    costs: [...byAccount].map(([account, totals]) => ({
      provider: "openai",
      account,
      todayUsd: totals.today,
      trailingSevenDaysUsd: totals.week,
    })),
    tokens,
  };
}

// ------------------------------------------------------------- Anthropic ----

const ANTHROPIC_VERSION = "2023-06-01";

const AnthropicCostPageSchema = z
  .object({
    data: z.array(
      z
        .object({
          starting_at: z.string(),
          results: z.array(
            z
              .object({
                // Decimal string in the lowest currency unit (cents).
                amount: z.string(),
                currency: z.string(),
                workspace_id: z.string().nullable().optional(),
              })
              .loose(),
          ),
        })
        .loose(),
    ),
    has_more: z.boolean(),
    next_page: z.string().nullable().optional(),
  })
  .loose();

function anthropicHeaders(adminKey: string): Record<string, string> {
  return { "x-api-key": adminKey, "anthropic-version": ANTHROPIC_VERSION };
}

function anthropicWorkspaceNames(input: {
  readonly adminKey: string;
  readonly fetcher: BillingFetch;
  readonly cancellationSignal: AbortSignal | undefined;
}): Promise<ReadonlyMap<string, string>> {
  return accountNames({
    url: "https://api.anthropic.com/v1/organizations/workspaces",
    cursorParam: "after_id",
    headers: anthropicHeaders(input.adminKey),
    provider: "Anthropic",
    fetcher: input.fetcher,
    cancellationSignal: input.cancellationSignal,
  });
}

function centsToUsd(amount: string): number {
  const cents = Number(amount);
  if (!Number.isFinite(cents)) {
    throw new TypeError(`Anthropic cost report returned a non-numeric amount`);
  }
  return cents / 100;
}

async function anthropicCostRows(input: {
  readonly adminKey: string;
  readonly weekStart: Date;
  readonly tomorrow: Date;
  readonly fetcher: BillingFetch;
  readonly cancellationSignal: AbortSignal | undefined;
}): Promise<
  { startingAt: string; workspaceId: string | null; amount: string }[]
> {
  const rows: {
    startingAt: string;
    workspaceId: string | null;
    amount: string;
  }[] = [];
  let page: string | undefined;
  do {
    const url = new URL(
      "https://api.anthropic.com/v1/organizations/cost_report",
    );
    url.searchParams.set("starting_at", input.weekStart.toISOString());
    // The cost report only buckets by day, so the window ends at the next UTC
    // midnight to include today's partial bucket.
    url.searchParams.set("ending_at", input.tomorrow.toISOString());
    url.searchParams.append("group_by[]", "workspace_id");
    if (page !== undefined) url.searchParams.set("page", page);
    const parsed = AnthropicCostPageSchema.parse(
      await getJson({
        url,
        headers: anthropicHeaders(input.adminKey),
        fetcher: input.fetcher,
        cancellationSignal: input.cancellationSignal,
        provider: "Anthropic",
      }),
    );
    rows.push(
      ...parsed.data.flatMap((bucket) =>
        bucket.results.map((result) => ({
          startingAt: bucket.starting_at,
          workspaceId: result.workspace_id ?? null,
          amount: result.amount,
        })),
      ),
    );
    page = nextCursor("Anthropic", parsed.has_more, parsed.next_page);
  } while (page !== undefined);
  return rows;
}

export async function fetchAnthropicBilling(input: {
  readonly adminKey: string;
  readonly now: Date;
  readonly fetcher?: BillingFetch;
  readonly cancellationSignal?: AbortSignal;
}): Promise<BilledAccountCost[]> {
  const fetcher = input.fetcher ?? fetch;
  const today = utcMidnightSeconds(input.now);
  const weekStart = new Date((today - 6 * DAY_SECONDS) * 1000);
  const tomorrow = new Date((today + DAY_SECONDS) * 1000);
  const common = {
    adminKey: input.adminKey,
    fetcher,
    cancellationSignal: input.cancellationSignal,
  };
  const [names, rows] = await Promise.all([
    anthropicWorkspaceNames(common),
    anthropicCostRows({ ...common, weekStart, tomorrow }),
  ]);

  const byAccount: AccountTotals = new Map();
  for (const row of rows) {
    addCost(
      byAccount,
      accountName(names, row.workspaceId),
      centsToUsd(row.amount),
      Math.floor(Date.parse(row.startingAt) / 1000) >= today,
    );
  }

  return [...byAccount].map(([account, totals]) => ({
    provider: "anthropic",
    account,
    todayUsd: totals.today,
    trailingSevenDaysUsd: totals.week,
  }));
}
