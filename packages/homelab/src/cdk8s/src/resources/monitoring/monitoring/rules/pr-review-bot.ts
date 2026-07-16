import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * PrometheusRule groups for the SOTA pr-review bot
 * (`packages/docs/plans/2026-05-10_sota-pr-review-bot.md`, Phase 8).
 *
 * Severity routing (set globally in
 * `resources/argo-applications/prometheus.ts`):
 *   - severity=critical|warning → PagerDuty
 *   - severity=info             → null receiver (dashboard surface only)
 *
 * Metrics surface consumed (per team-lead "Path A" naming, 2026-05-10):
 *   Phase 2 (`packages/temporal/src/observability/metrics.ts`):
 *     - pr_review_posted_total{owner, repo, outcome=created|updated}  (Counter; posted-only)
 *     - pr_review_comments_per_pr                                     (Histogram)
 *   Phase 8 (`packages/temporal/src/observability/pr-review-metrics.ts`):
 *     - pr_review_count_total{repo, status=posted|skipped|failed}     (Counter; lifecycle)
 *     - pr_review_fpr_estimated                                       (Gauge)
 *     - pr_review_latency_seconds                                     (Histogram)
 *     - pr_review_cost_usd{model}                                     (Histogram)
 *     - pr_review_consensus_drop_rate                                 (Gauge)
 *     - pr_review_verification_drop_rate                              (Gauge)
 *     - pr_review_dedupe_drop_rate                                    (Gauge)
 */
export function getPrReviewBotRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "pr-review-bot-quality",
      rules: [
        {
          alert: "PrReviewBotHighFalsePositiveRate",
          annotations: {
            description: escapePrometheusTemplate(
              "pr-review-bot estimated false-positive rate is {{ $value | humanizePercentage }} over the last hour (threshold 15%). High FPR erodes author trust — investigate hallucination or verification regressions.",
            ),
            summary: "pr-review-bot FPR > 15%",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max without(pod, instance, container, endpoint) (pr_review_fpr_estimated) > 0.15",
          ),
          for: "1h",
          // critical → PagerDuty
          labels: { severity: "critical" },
        },
        {
          alert: "PrReviewBotCostBudgetExceeded",
          annotations: {
            description: escapePrometheusTemplate(
              "pr-review-bot p50 cost per PR over the last 24h is ${{ $value }} (threshold $5). Investigate prompt/model regressions or runaway specialist passes.",
            ),
            summary: "pr-review-bot cost/PR > $5 (24h sustained)",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.5, sum without(pod, instance, container, endpoint, model) (rate(pr_review_cost_usd_bucket[24h]))) > 5",
          ),
          for: "24h",
          // warning → PagerDuty (warning-severity ticket, not critical page)
          labels: { severity: "warning" },
        },
        {
          alert: "PrReviewBotHighLatency",
          annotations: {
            description: escapePrometheusTemplate(
              "pr-review-bot p95 latency over the trailing 30 minutes is {{ $value }}s (threshold 480s = 8 min). Slow reviews land after authors have moved on; check Anthropic API health and specialist parallelism.",
            ),
            summary: "pr-review-bot p95 latency > 8min",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.95, sum without(pod, instance, container, endpoint) (rate(pr_review_latency_seconds_bucket[30m]))) > 480",
          ),
          for: "15m",
          // critical → PagerDuty
          labels: { severity: "critical" },
        },
      ],
    },
    {
      name: "pr-review-bot-throughput",
      rules: [
        {
          alert: "PrReviewBotNoActivity",
          annotations: {
            description: escapePrometheusTemplate(
              "pr-review-bot has not posted, skipped, or failed any PR in the last 6 hours. Either traffic is unusually low or the webhook ingress is silent. Check the GitHub webhook delivery dashboard.",
            ),
            summary: "pr-review-bot silent for 6h",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum without(pod, instance, container, endpoint, repo, status) (increase(pr_review_count_total[6h])) == 0",
          ),
          for: "6h",
          // info — surfaces in dashboard, never pages
          labels: { severity: "info" },
        },
        {
          alert: "PrReviewBotHighFailureRate",
          annotations: {
            description: escapePrometheusTemplate(
              "pr-review-bot failure rate is {{ $value | humanizePercentage }} over the last hour. Check Sentry for activity-level errors.",
            ),
            summary: "pr-review-bot failure rate > 25%",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(
              sum without(pod, instance, container, endpoint, repo) (rate(pr_review_count_total{status="failed"}[1h]))
              /
              sum without(pod, instance, container, endpoint, repo, status) (rate(pr_review_count_total[1h]))
            ) > 0.25`,
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
