import { z } from "zod";
import {
  aiProviderErrorsTotal,
  aiProviderIssueActive,
} from "#src/metrics/index.ts";

const ProviderSchema = z.enum(["openai", "gemini"]);
const ProviderIssueKindSchema = z.enum(["quota", "rate_limit"]);

export type ProviderIssueKind = z.infer<typeof ProviderIssueKindSchema>;

const ProviderIssueSchema = z.object({
  provider: ProviderSchema,
  kind: ProviderIssueKindSchema,
  app: z.literal("scout-for-lol"),
  source: z.string().min(1),
});

export type ProviderIssue = z.infer<typeof ProviderIssueSchema>;

const ProviderErrorSchema = z.looseObject({
  status: z.number().optional(),
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

function labels(issue: ProviderIssue): {
  app: "scout-for-lol";
  provider: "openai" | "gemini";
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

export function recordProviderIssue(input: ProviderIssue): void {
  const issue = ProviderIssueSchema.parse(input);
  const issueLabels = labels(issue);
  aiProviderErrorsTotal.inc(issueLabels);
  aiProviderIssueActive.set(issueLabels, 1);
}

export function resolveProviderIssue(input: ProviderIssue): void {
  const issue = ProviderIssueSchema.parse(input);
  aiProviderIssueActive.set(labels(issue), 0);
}

export function classifyOpenAIProviderIssue(
  error: unknown,
): ProviderIssueKind | null {
  const parsed = ProviderErrorSchema.safeParse(error);
  const providerError = parsed.success ? parsed.data : undefined;
  const status = providerError?.status;
  const nestedError = providerError?.error;
  const lowerMessage = [
    errorMessage(error),
    providerError?.code,
    providerError?.type,
    nestedError?.code,
    nestedError?.type,
    nestedError?.message,
  ]
    .filter((value) => value !== undefined)
    .join(" ")
    .toLowerCase();

  if (
    (status === 429 || lowerMessage.includes("429")) &&
    (lowerMessage.includes("quota") ||
      lowerMessage.includes("billing") ||
      lowerMessage.includes("insufficient_quota"))
  ) {
    return "quota";
  }

  if (
    status === 429 ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("rate_limit") ||
    lowerMessage.includes("429")
  ) {
    return "rate_limit";
  }

  return null;
}
