import { MockActivityEnvironment } from "@temporalio/testing";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { register } from "#observability/metrics.ts";
import {
  emptyAccumulator,
  type LifecycleRunReport,
  type SweepRuleInput,
} from "#shared/seaweedfs-lifecycle/types.ts";
import { ruleReport } from "#shared/seaweedfs-lifecycle/report.ts";
import type { SeaweedfsLifecyclePolicy } from "#config/seaweedfs-lifecycle-enforcer.ts";

const config = vi.hoisted(() =>
  vi.fn<() => Promise<SeaweedfsLifecyclePolicy>>(),
);
vi.mock("#config/seaweedfs-lifecycle-enforcer.ts", () => ({
  seaweedfsLifecycleEnforcerConfig: config,
}));
import { seaweedfsLifecycleActivities, sweepRule } from "./activities.ts";
import { daysAgo, FakeLifecycleS3, NOW_MS } from "./test-fixtures.ts";

const deletePolicy = (
  overrides: Partial<SeaweedfsLifecyclePolicy> = {},
): SeaweedfsLifecyclePolicy => ({
  mode: "delete",
  maxDeletes: 20_000,
  buckets: "*",
  provenance: { mode: "flag", maxDeletes: "default", buckets: "default" },
  ...overrides,
});

function input(overrides: Partial<SweepRuleInput> = {}): SweepRuleInput {
  return {
    bucket: "site",
    rule: { id: "expire-old", prefix: "_astro/", days: 90 },
    nowMs: NOW_MS,
    mode: "delete",
    deleteBudget: 1000,
    token: undefined,
    accumulator: emptyAccumulator(),
    ...overrides,
  };
}

function populate(s3: FakeLifecycleS3, count = 9): void {
  for (let n = 0; n < count; n += 1) {
    s3.put("site", `_astro/f-${String(n)}.js`, daysAgo(99), 10);
  }
  s3.put("site", "keep.html", daysAgo(500), 10);
}

beforeEach(() => {
  config.mockReset();
  config.mockResolvedValue(deletePolicy());
});

describe("sweepRule", () => {
  test("deletes expired objects in delete mode and heartbeats its progress", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    s3.pageSize = 3;
    const environment = new MockActivityEnvironment();
    const heartbeats: unknown[] = [];
    environment.on("heartbeat", (details: unknown) => heartbeats.push(details));
    const result = await environment.run(sweepRule, input(), s3);
    expect(result).toMatchObject({ status: "complete", deletedThisChunk: 9 });
    expect(s3.keys("site")).toEqual(["keep.html"]);
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(heartbeats.at(-1)).toMatchObject({
      stage: "sweep",
      bucket: "site",
      ruleId: "expire-old",
    });
  });

  test("a report-mode chunk never deletes and never reads the delete flags", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    const result = await new MockActivityEnvironment().run(
      sweepRule,
      input({ mode: "report" }),
      s3,
    );
    expect(result).toMatchObject({ mode: "report", deletedThisChunk: 0 });
    expect(result.accumulator.candidates).toBe(9);
    expect(s3.deleteCalls).toEqual([]);
    expect(config).not.toHaveBeenCalled();
  });

  test("flipping the mode flag back to report stops deletes before the next delete", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    config.mockResolvedValue(deletePolicy({ mode: "report" }));
    const result = await new MockActivityEnvironment().run(
      sweepRule,
      input(),
      s3,
    );
    expect(result).toMatchObject({
      mode: "report",
      deletedThisChunk: 0,
      downgradeReason:
        "the mode flag left delete or the bucket left the allowlist",
    });
    expect(result.accumulator.candidates).toBe(9);
    expect(s3.deleteCalls).toEqual([]);
  });

  test("removing the bucket from the allowlist stops deletes", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    config.mockResolvedValue(deletePolicy({ buckets: ["other-bucket"] }));
    const result = await new MockActivityEnvironment().run(
      sweepRule,
      input(),
      s3,
    );
    expect(result.mode).toBe("report");
    expect(s3.deleteCalls).toEqual([]);
  });

  test("a retry resumes from its last heartbeat instead of re-counting finished pages", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    s3.pageSize = 3;
    s3.failListOnCall = 3;
    const first = new MockActivityEnvironment();
    let lastHeartbeat: unknown;
    first.on("heartbeat", (details: unknown) => {
      lastHeartbeat = details;
    });
    await expect(first.run(sweepRule, input(), s3)).rejects.toThrow(
      "list failed",
    );
    // Temporal delivers the failed attempt's last heartbeat as decoded details.
    const retry = new MockActivityEnvironment({
      heartbeatDetails: structuredClone(lastHeartbeat),
    });
    const result = await retry.run(sweepRule, input(), s3);
    expect(result).toMatchObject({ status: "complete", deletedThisChunk: 9 });
    expect(result.accumulator).toMatchObject({
      candidates: 9,
      deleted: 9,
      scanned: 9,
    });
    expect(s3.keys("site")).toEqual(["keep.html"]);
    const deletedKeys = s3.deleteCalls.flatMap((call) => call.keys);
    expect(new Set(deletedKeys).size).toBe(9);
  });

  test("ignores heartbeat details left by a different chunk", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    const stale = {
      stage: "sweep",
      bucket: "site",
      ruleId: "some-other-rule",
      result: {
        accumulator: { ...emptyAccumulator(), deleted: 999, candidates: 999 },
        status: "complete",
        mode: "delete",
        deletedThisChunk: 999,
      },
    };
    const result = await new MockActivityEnvironment({
      heartbeatDetails: stale,
    }).run(sweepRule, input(), s3);
    expect(result.deletedThisChunk).toBe(9);
    expect(result.accumulator.candidates).toBe(9);
  });
});

describe("publishSeaweedfsLifecycleReport", () => {
  test("exports candidate gauges per bucket and rule and a last-run timestamp", async () => {
    const report: LifecycleRunReport = {
      startedAt: new Date(NOW_MS).toISOString(),
      configuredMode: "report",
      dryRun: false,
      maxDeletes: 20_000,
      allowlist: "*",
      provenance: {
        mode: "default",
        maxDeletes: "default",
        buckets: "default",
      },
      buckets: [
        {
          bucket: "ci-handoff",
          deletesAllowed: false,
          rules: [
            ruleReport({
              rule: { id: "expire-ci-handoff", prefix: "", days: 30 },
              accumulator: {
                ...emptyAccumulator(),
                candidates: 12,
                candidateBytes: 3456,
              },
              mode: "report",
              status: "complete",
              nowMs: NOW_MS,
            }),
          ],
          unsupported: [],
          disabledRules: 0,
        },
        {
          bucket: "sjer-red",
          deletesAllowed: false,
          rules: [],
          unsupported: [],
          disabledRules: 0,
          error: "list failed",
        },
      ],
      withoutLifecycle: [],
      totals: {
        candidates: 12,
        candidateBytes: 3456,
        deleted: 0,
        deletedBytes: 0,
        unsupportedRules: 0,
        failedBuckets: 1,
      },
    };
    await seaweedfsLifecycleActivities.publishSeaweedfsLifecycleReport(report);
    const metrics = await register.metrics();
    // The registry adds a default `component` label after the declared ones.
    expect(metrics).toMatch(
      /seaweedfs_lifecycle_candidates_total\{bucket="ci-handoff",rule="expire-ci-handoff",[^}]*\} 12\n/u,
    );
    expect(metrics).toMatch(
      /seaweedfs_lifecycle_candidate_bytes\{bucket="ci-handoff",rule="expire-ci-handoff",[^}]*\} 3456\n/u,
    );
    expect(metrics).toMatch(
      /seaweedfs_lifecycle_bucket_failed\{bucket="sjer-red",[^}]*\} 1\n/u,
    );
    expect(metrics).toMatch(
      /seaweedfs_lifecycle_last_run_timestamp_seconds\{mode="report",[^}]*\} \d/u,
    );
  });
});
