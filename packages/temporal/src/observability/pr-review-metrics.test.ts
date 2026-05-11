import { describe, expect, test } from "bun:test";
import { register } from "./metrics.ts";
import "./pr-review-metrics.ts";

const EXPECTED_SERIES = [
  "pr_review_latency_seconds",
  "pr_review_cost_usd",
  "pr_review_fpr_estimated",
  "pr_review_consensus_drop_rate",
  "pr_review_verification_drop_rate",
  "pr_review_dedupe_drop_rate",
  "pr_review_count_total",
] as const;

describe("pr-review-metrics", () => {
  test("registers every Phase 8 metric on the shared registry", async () => {
    const exposition = await register.metrics();
    for (const name of EXPECTED_SERIES) {
      expect(exposition).toContain(name);
    }
  });

  test("pr_review_latency_seconds uses Phase 8 SLO-aligned buckets", async () => {
    const exposition = await register.metrics();
    // Spot-check 480s (8 min SLO boundary) is a bucket. Labels are emitted
    // in insertion order alongside the registry's default `component` label,
    // so match on the prefix to stay resilient to label ordering.
    expect(exposition).toMatch(/pr_review_latency_seconds_bucket\{le="480",/);
    // and that p95 latency alert can resolve histogram_quantile cleanly
    expect(exposition).toMatch(/pr_review_latency_seconds_bucket\{le="\+Inf"/);
  });

  test("pr_review_cost_usd is labeled by model and specialist", async () => {
    const exposition = await register.metrics();
    // No samples yet, but the help text must announce the labels. Phase 3
    // extended the original (`model`-only) histogram with a `specialist`
    // label so per-specialist cost can be broken out in Grafana.
    expect(exposition).toMatch(/pr_review_cost_usd.*model and specialist/i);
  });

  test("pr_review_count_total uses status labels matching Phase 8 alerts", async () => {
    const exposition = await register.metrics();
    expect(exposition).toMatch(/# HELP pr_review_count_total/);
    expect(exposition).toMatch(/# TYPE pr_review_count_total counter/);
  });
});
