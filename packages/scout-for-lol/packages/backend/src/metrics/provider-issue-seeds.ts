import type { Counter, Gauge } from "prom-client";
import { PROVIDER_ISSUE_KINDS } from "#src/alerts/provider-issue-kinds.ts";

type ProviderIssueLabel = "app" | "provider" | "kind" | "source";

export function seedProviderIssueMetrics(metrics: {
  errorsTotal: Counter<ProviderIssueLabel>;
  issueActive: Gauge<ProviderIssueLabel>;
}): void {
  for (const provider of ["openrouter", "openai", "gemini"] as const) {
    for (const kind of PROVIDER_ISSUE_KINDS) {
      const labels = {
        app: "scout-for-lol",
        provider,
        kind,
        source: "match_review",
      };
      metrics.errorsTotal.inc(labels, 0);
      metrics.issueActive.set(labels, 0);
    }
  }
}
