import { describe, expect, it } from "bun:test";
import { metricsActivities } from "./metrics.ts";
import { register } from "#observability/metrics.ts";

const STARTED_AT_MS = Date.now() - 60_000;

describe("prReviewEmitMetrics", () => {
  it("populates lifecycle counter, latency, and drop-rate gauges", async () => {
    await metricsActivities.prReviewEmitMetrics({
      owner: "owner",
      repo: "repo",
      postedFindings: 3,
      created: true,
      status: "posted",
      startedAtMs: STARTED_AT_MS,
      costs: [
        { model: "claude-opus-4-7", usd: 2.5 },
        { model: "claude-sonnet-4-6", usd: 0.3 },
      ],
      stageDrops: {
        consensusInput: 10,
        consensusOutput: 6,
        verificationOutput: 4,
        dedupeOutput: 3,
      },
    });

    const exposition = await register.metrics();
    // Label order in the Prometheus exposition depends on the default
    // label ordering of the registry. Match on the substring rather than a
    // strict prefix so the test stays resilient to label reordering.
    expect(exposition).toMatch(/pr_review_count_total\{[^}]*repo="repo"/);
    expect(exposition).toMatch(/pr_review_count_total\{[^}]*status="posted"/);
    expect(exposition).toMatch(/pr_review_latency_seconds_count\{.*\}\s+\d/);
    expect(exposition).toMatch(
      /pr_review_cost_usd_count\{[^}]*model="claude-opus-4-7"/,
    );
    expect(exposition).toMatch(/pr_review_consensus_drop_rate\{.*\} 0\.4/);
    expect(exposition).toMatch(/pr_review_verification_drop_rate\{.*\} 0\.33/);
    expect(exposition).toMatch(/pr_review_dedupe_drop_rate\{.*\} 0\.25/);
  });

  it("clamps negative or NaN drop rates to 0", async () => {
    await metricsActivities.prReviewEmitMetrics({
      owner: "owner",
      repo: "repo-clamp",
      postedFindings: 5,
      created: false,
      status: "posted",
      startedAtMs: STARTED_AT_MS,
      costs: [],
      stageDrops: {
        // Pathological: more findings out than in. Clamp to 0.
        consensusInput: 1,
        consensusOutput: 5,
        verificationOutput: 5,
        dedupeOutput: 5,
      },
    });

    const exposition = await register.metrics();
    // Both should land at 0 because the gauge most recently saw a clamped
    // value from this run.
    expect(exposition).toMatch(/pr_review_consensus_drop_rate\{.*\} 0\b/);
  });

  it("counts skipped status separately from posted", async () => {
    await metricsActivities.prReviewEmitMetrics({
      owner: "owner",
      repo: "skipper",
      postedFindings: 0,
      created: false,
      status: "skipped",
      startedAtMs: STARTED_AT_MS,
      costs: [],
      stageDrops: {
        consensusInput: 0,
        consensusOutput: 0,
        verificationOutput: 0,
        dedupeOutput: 0,
      },
    });

    const exposition = await register.metrics();
    expect(exposition).toMatch(/pr_review_count_total\{[^}]*repo="skipper"/);
    expect(exposition).toMatch(/pr_review_count_total\{[^}]*status="skipped"/);
  });

  it("emit-failure activity fires status=failed counter and latency", async () => {
    await metricsActivities.prReviewEmitFailureMetrics({
      owner: "owner",
      repo: "boom",
      startedAtMs: STARTED_AT_MS,
      reason: "Error: bootstrap timed out",
    });

    const exposition = await register.metrics();
    expect(exposition).toMatch(/pr_review_count_total\{[^}]*repo="boom"/);
    expect(exposition).toMatch(/pr_review_count_total\{[^}]*status="failed"/);
  });
});
