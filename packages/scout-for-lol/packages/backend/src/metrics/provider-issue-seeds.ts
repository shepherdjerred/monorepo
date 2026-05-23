import type { Counter, Gauge } from "prom-client";

type ProviderIssueLabel = "app" | "provider" | "kind" | "source";

export function seedProviderIssueMetrics(metrics: {
  errorsTotal: Counter<ProviderIssueLabel>;
  issueActive: Gauge<ProviderIssueLabel>;
}): void {
  for (const kind of ["quota", "rate_limit"] as const) {
    const labels = {
      app: "scout-for-lol",
      provider: "openai",
      kind,
      source: "match_review",
    };
    metrics.errorsTotal.inc(labels, 0);
    metrics.issueActive.set(labels, 0);
  }
}
