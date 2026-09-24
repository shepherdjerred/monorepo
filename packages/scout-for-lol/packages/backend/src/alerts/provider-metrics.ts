import { z } from "zod";
import {
  aiProviderErrorsTotal,
  aiProviderIssueActive,
} from "#src/metrics/index.ts";
import {
  PROVIDER_ISSUE_KINDS,
  SCOUT_LLM_PROVIDERS,
} from "#src/alerts/provider-issue-kinds.ts";

const ProviderSchema = z.enum(SCOUT_LLM_PROVIDERS);
export type ScoutLlmProvider = z.infer<typeof ProviderSchema>;
const ProviderIssueKindSchema = z.enum(PROVIDER_ISSUE_KINDS);

export type ProviderIssueKind = z.infer<typeof ProviderIssueKindSchema>;

const ProviderIssueSchema = z.object({
  provider: ProviderSchema,
  kind: ProviderIssueKindSchema,
  app: z.literal("scout-for-lol"),
  source: z.string().min(1),
});

export type ProviderIssue = z.infer<typeof ProviderIssueSchema>;

const ProviderErrorSchema = z.looseObject({
  name: z.string().optional(),
  message: z.string().optional(),
  status: z.number().optional(),
  statusCode: z.number().optional(),
  code: z.string().optional(),
  type: z.string().optional(),
  error: z
    .looseObject({
      code: z.string().optional(),
      type: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});
type ProviderError = z.infer<typeof ProviderErrorSchema>;

function labels(issue: ProviderIssue): {
  app: "scout-for-lol";
  provider: ScoutLlmProvider;
  kind: ProviderIssueKind;
  source: string;
} {
  return {
    app: issue.app,
    provider: issue.provider,
    kind: issue.kind,
    source: issue.source,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBudgetExceededIssue(
  providerError: ProviderError | undefined,
  lowerMessage: string,
): boolean {
  return (
    providerError?.name === "LlmBudgetExceeded" ||
    lowerMessage.includes("llmbudgetexceeded") ||
    lowerMessage.includes("token budget exceeded")
  );
}

function isContextLimitIssue(status: number | undefined, lowerMessage: string) {
  return (
    status === 400 &&
    (lowerMessage.includes("input tokens exceed") ||
      lowerMessage.includes("configured limit") ||
      lowerMessage.includes("context length") ||
      lowerMessage.includes("context token limit") ||
      lowerMessage.includes("input token limit"))
  );
}

function isQuotaIssue(status: number | undefined, lowerMessage: string) {
  return (
    status === 402 ||
    lowerMessage.includes("insufficient credits") ||
    lowerMessage.includes("credit balance") ||
    ((status === 403 || lowerMessage.includes("403")) &&
      lowerMessage.includes("weekly") &&
      (lowerMessage.includes("limit") || lowerMessage.includes("quota"))) ||
    ((status === 429 || lowerMessage.includes("429")) &&
      (lowerMessage.includes("quota") ||
        lowerMessage.includes("billing") ||
        lowerMessage.includes("insufficient_quota")))
  );
}

function isRateLimitIssue(status: number | undefined, lowerMessage: string) {
  return (
    status === 429 ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("rate_limit") ||
    lowerMessage.includes("429")
  );
}

export function recordProviderIssue(input: ProviderIssue): void {
  const issue = ProviderIssueSchema.parse(input);
  const issueLabels = labels(issue);
  aiProviderErrorsTotal.inc(issueLabels);
  aiProviderIssueActive.set(issueLabels, 1);
}

/**
 * Clear an issue for every provider. A success does not say which provider a
 * stale failure came from, and the model behind a source can change between
 * the failure and the recovery.
 */
export function resolveProviderIssue(
  input: Omit<ProviderIssue, "provider">,
): void {
  for (const provider of SCOUT_LLM_PROVIDERS) {
    const issue = ProviderIssueSchema.parse({ ...input, provider });
    aiProviderIssueActive.set(labels(issue), 0);
  }
}

const RequestUrlSchema = z.looseObject({ url: z.string() });
const NestedErrorSchema = z.looseObject({
  cause: z.unknown().optional(),
  lastError: z.unknown().optional(),
  errors: z.array(z.unknown()).optional(),
});

function providerForHost(url: string): ScoutLlmProvider | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (host.endsWith("openai.com")) return "openai";
  if (host.endsWith("anthropic.com")) return "anthropic";
  return host.endsWith("googleapis.com") ? "google" : undefined;
}

/**
 * The provider behind a failed call, read from the request URL the AI SDK
 * attaches to its API errors. Walks retry wrappers and causes, since a
 * transport failure usually arrives wrapped at least once.
 */
export function providerForError(error: unknown): ScoutLlmProvider {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const withUrl = RequestUrlSchema.safeParse(current);
    if (withUrl.success) {
      const provider = providerForHost(withUrl.data.url);
      if (provider !== undefined) return provider;
    }
    const nested = NestedErrorSchema.safeParse(current);
    if (nested.success) {
      pending.push(
        nested.data.cause,
        nested.data.lastError,
        ...(nested.data.errors ?? []),
      );
    }
  }
  return "unknown";
}

export function classifyLlmProviderIssue(
  error: unknown,
): ProviderIssueKind | null {
  const parsed = ProviderErrorSchema.safeParse(error);
  const providerError = parsed.success ? parsed.data : undefined;
  const status = providerError?.status ?? providerError?.statusCode;
  const nestedError = providerError?.error;
  const lowerMessage = [
    errorMessage(error),
    providerError?.message,
    providerError?.code,
    providerError?.type,
    nestedError?.code,
    nestedError?.type,
    nestedError?.message,
  ]
    .filter((value) => value !== undefined)
    .join(" ")
    .toLowerCase();

  if (isBudgetExceededIssue(providerError, lowerMessage)) {
    return "budget_exceeded";
  }

  if (isContextLimitIssue(status, lowerMessage)) {
    return "context_limit";
  }

  if (isQuotaIssue(status, lowerMessage)) {
    return "quota";
  }

  return isRateLimitIssue(status, lowerMessage) ? "rate_limit" : null;
}
