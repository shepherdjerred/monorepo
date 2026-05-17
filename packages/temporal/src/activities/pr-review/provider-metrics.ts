import { z } from "zod/v4";
import {
  aiProviderErrorsTotal,
  aiProviderIssueActive,
} from "#observability/metrics.ts";

const ProviderIssueSchema = z.object({
  app: z.literal("temporal"),
  provider: z.enum(["anthropic", "openai"]),
  kind: z.string().min(1),
  source: z.string().min(1),
});

export type ProviderIssue = z.infer<typeof ProviderIssueSchema>;

function labels(issue: ProviderIssue): {
  app: "temporal";
  provider: "anthropic" | "openai";
  kind: string;
  source: string;
} {
  return {
    app: issue.app,
    provider: issue.provider,
    kind: issue.kind,
    source: issue.source,
  };
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
