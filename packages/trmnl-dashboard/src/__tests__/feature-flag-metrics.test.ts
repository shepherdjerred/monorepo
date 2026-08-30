import { describe, expect, it } from "vitest";
import { createFeatureFlagMetrics } from "../feature-flag-metrics.ts";

describe("feature flag metrics", () => {
  it("exports evaluation, error, and snapshot-age signals", async () => {
    const metrics = createFeatureFlagMetrics();

    metrics.recorder.countEvaluation({
      flag: "pet-dashboard-enabled",
      reason: "STATIC",
      errorCode: undefined,
    });
    metrics.recorder.countError("refresh");
    metrics.recorder.observeSnapshotAge(42);

    await expect(metrics.render()).resolves.toContain(
      'feature_flag_evaluations_total{flag="pet-dashboard-enabled",reason="STATIC"} 1',
    );
    await expect(metrics.render()).resolves.toContain(
      'feature_flag_errors_total{operation="refresh"} 1',
    );
    await expect(metrics.render()).resolves.toContain(
      "feature_flag_snapshot_age_seconds 42",
    );
  });
});
