import type { Counter, Gauge } from "prom-client";
import { PROVIDER_ISSUE_KINDS } from "#src/alerts/provider-metrics.ts";

type ProviderIssueLabel = "app" | "provider" | "kind" | "source";

export function seedProviderIssueMetrics(metrics: {
  errorsTotal: Counter<ProviderIssueLabel>;
  issueActive: Gauge<ProviderIssueLabel>;
}): void {
  for (const kind of PROVIDER_ISSUE_KINDS) {
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
