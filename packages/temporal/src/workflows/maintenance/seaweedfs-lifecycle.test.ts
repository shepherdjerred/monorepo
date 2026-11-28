import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  classifyLifecycleRules,
  sweepRuleChunk,
} from "#activities/maintenance/seaweedfs-lifecycle/core.ts";
import { FakeLifecycleS3 } from "#activities/maintenance/seaweedfs-lifecycle/test-fixtures.ts";
import {
  type LifecycleInventory,
  type LifecycleMode,
  type LifecyclePolicyView,
  type LifecycleRunReport,
  type SweepRuleInput,
} from "#shared/seaweedfs-lifecycle/types.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;

function policy(
  overrides: Partial<LifecyclePolicyView> = {},
): LifecyclePolicyView {
  return {
    mode: "report",
    maxDeletes: 20_000,
    buckets: "*",
    provenance: { mode: "default", maxDeletes: "default", buckets: "default" },
    ...overrides,
  };
}

/** Two buckets, each with an expired `old/` rule: five expired, one fresh. */
function fixture() {
  const s3 = new FakeLifecycleS3();
  for (const bucket of ["alpha", "beta"]) {
    for (let n = 0; n < 5; n += 1) {
      s3.putAged(bucket, `old/f-${String(n)}`, 40, 10);
    }
    s3.putAged(bucket, "old/fresh", 1, 10);
    s3.putAged(bucket, "keep/forever", 400, 10);
    s3.lifecycles.set(bucket, [
      {
        ID: "expire-old",
        Status: "Enabled",
        Filter: { Prefix: "old/" },
        Expiration: { Days: 30 },
      },
    ]);
  }
  s3.lifecycles.set("gamma", [
    {
      ID: "tagged",
      Status: "Enabled",
      Filter: { Tag: { Key: "k", Value: "v" } },
      Expiration: { Days: 1 },
    },
  ]);
  s3.putAged("gamma", "anything", 400, 10);
  s3.objects.set("delta", new Map());
  s3.lifecycles.set("delta", undefined);
  return s3;
}

let environment: TestWorkflowEnvironment | undefined;

function stubActivities(
  options: RunOptions,
  captured: {
    published: LifecycleRunReport[];
    requestedModes: LifecycleMode[];
  },
) {
  return {
    readSeaweedfsLifecycleInventory: async (): Promise<LifecycleInventory> => {
      const names = await options.s3.listBuckets();
      const buckets = [];
      const withoutLifecycle = [];
      for (const bucket of names.toSorted()) {
        const rules = await options.s3.getLifecycleRules(bucket);
        if (rules === undefined) withoutLifecycle.push(bucket);
        else buckets.push(classifyLifecycleRules(bucket, rules));
      }
      return { policy: options.policy, buckets, withoutLifecycle };
    },
    sweepSeaweedfsLifecycleRule: async (input: SweepRuleInput) => {
      // Age fixtures against the Workflow's clock, which the test server owns.
      options.s3.nowMs = input.nowMs;
      captured.requestedModes.push(input.mode);
      if (input.bucket === options.failBucket) {
        throw ApplicationFailure.nonRetryable("S3 is down", "S3Down");
      }
      if (input.bucket === options.failAfterDeleting?.bucket) {
        // Delete some objects, then fail without reporting them, as a chunk
        // does when a later listing call exhausts its retries.
        await sweepRuleChunk(
          { ...input, deleteBudget: options.failAfterDeleting.count },
          { client: options.s3 },
        );
        throw ApplicationFailure.nonRetryable("listing failed", "S3Down");
      }
      return sweepRuleChunk(input, {
        client: options.s3,
        maxPages: options.maxPages,
      });
    },
    publishSeaweedfsLifecycleReport: (report: LifecycleRunReport) => {
      captured.published.push(report);
    },
  };
}

type RunOptions = {
  s3: FakeLifecycleS3;
  policy: LifecyclePolicyView;
  input?: { dryRun?: boolean };
  maxPages?: number;
  failBucket?: string;
  failAfterDeleting?: { bucket: string; count: number };
};

async function run(options: RunOptions) {
  if (environment === undefined) throw new Error("environment missing");
  const published: LifecycleRunReport[] = [];
  const requestedModes: LifecycleMode[] = [];
  const captured = { published, requestedModes };
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.INFRA,
    activities: stubActivities(options, captured),
  });
  const workflowId = `seaweedfs-lifecycle-${crypto.randomUUID()}`;
  const report: LifecycleRunReport = await activityWorker.runUntil(
    workflowWorker.runUntil(
      environment.client.workflow.execute("runSeaweedfsLifecycleEnforcer", {
        workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: options.input === undefined ? [] : [options.input],
      }),
    ),
  );
  const history = await environment.client.workflow
    .getHandle(workflowId)
    .fetchHistory();
  await Worker.runReplayHistory({ workflowsPath }, history);
  return { report, ...captured };
}

describe("runSeaweedfsLifecycleEnforcer", () => {
  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);
  afterAll(async () => {
    await environment?.teardown();
  });

  test("report mode deletes nothing and reports every bucket's candidates", async () => {
    const s3 = fixture();
    const { report, published, requestedModes } = await run({
      s3,
      policy: policy(),
    });
    expect(s3.deleteCalls).toEqual([]);
    expect(new Set(requestedModes)).toEqual(new Set(["report"]));
    expect(report.buckets.map((bucket) => bucket.bucket)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(report.withoutLifecycle).toEqual(["delta"]);
    expect(report.buckets[0]?.rules[0]).toMatchObject({
      ruleId: "expire-old",
      prefix: "old/",
      days: 30,
      mode: "report",
      status: "complete",
      candidates: 5,
      candidateBytes: 50,
      deleted: 0,
    });
    expect(report.buckets[2]).toMatchObject({
      rules: [],
      unsupported: [{ id: "tagged" }],
    });
    expect(report.totals).toMatchObject({
      candidates: 10,
      deleted: 0,
      unsupportedRules: 1,
      failedBuckets: 0,
    });
    expect(published).toEqual([report]);
  }, 60_000);

  test("delete mode deletes expired objects under each rule's prefix only", async () => {
    const s3 = fixture();
    const { report } = await run({ s3, policy: policy({ mode: "delete" }) });
    for (const bucket of ["alpha", "beta"]) {
      expect(s3.keys(bucket)).toEqual(["keep/forever", "old/fresh"]);
    }
    expect(s3.keys("gamma")).toEqual(["anything"]);
    expect(report.totals).toMatchObject({ candidates: 10, deleted: 10 });
    expect(report.buckets[0]?.rules[0]).toMatchObject({
      mode: "delete",
      deleted: 5,
      deletedBytes: 50,
    });
  }, 60_000);

  test("the bucket allowlist limits deletes and still reports the rest", async () => {
    const s3 = fixture();
    const { report } = await run({
      s3,
      policy: policy({ mode: "delete", buckets: ["beta"] }),
    });
    expect(s3.keys("alpha")).toHaveLength(7);
    expect(s3.keys("beta")).toEqual(["keep/forever", "old/fresh"]);
    expect(report.buckets.map((bucket) => bucket.deletesAllowed)).toEqual([
      false,
      true,
      false,
    ]);
    expect(report.buckets[0]?.rules[0]).toMatchObject({
      mode: "report",
      candidates: 5,
      deleted: 0,
    });
  }, 60_000);

  test("the per-run cap spans buckets and later rules fall back to reporting", async () => {
    const s3 = fixture();
    const { report } = await run({
      s3,
      policy: policy({ mode: "delete", maxDeletes: 7 }),
    });
    expect(report.totals.deleted).toBe(7);
    expect(s3.keys("alpha")).toEqual(["keep/forever", "old/fresh"]);
    expect(s3.keys("beta")).toHaveLength(5);
    expect(report.buckets[1]?.rules[0]).toMatchObject({
      mode: "delete",
      status: "cap-reached",
      deleted: 2,
    });
    expect(report.buckets[1]?.rules[0]?.note).toContain("cap");
  }, 60_000);

  test("a later rule after the cap runs as a report with an explanation", async () => {
    const s3 = fixture();
    const { report, requestedModes } = await run({
      s3,
      policy: policy({ mode: "delete", maxDeletes: 5 }),
    });
    expect(report.totals.deleted).toBe(5);
    expect(requestedModes.at(-1)).toBe("report");
    expect(report.buckets[1]?.rules[0]).toMatchObject({
      mode: "report",
      candidates: 5,
      deleted: 0,
    });
    expect(report.buckets[1]?.rules[0]?.note).toContain("cap");
  }, 60_000);

  test("the dryRun input forces report mode whatever the flag says", async () => {
    const s3 = fixture();
    const { report } = await run({
      s3,
      policy: policy({ mode: "delete" }),
      input: { dryRun: true },
    });
    expect(s3.deleteCalls).toEqual([]);
    expect(report.dryRun).toBe(true);
    expect(report.buckets.every((bucket) => !bucket.deletesAllowed)).toBe(true);
    expect(report.totals.candidates).toBe(10);
  }, 60_000);

  test("continues a rule across Activity chunks until the listing ends", async () => {
    const s3 = fixture();
    s3.pageSize = 2;
    const { report, requestedModes } = await run({
      s3,
      policy: policy({ mode: "delete" }),
      maxPages: 1,
    });
    expect(report.totals).toMatchObject({ candidates: 10, deleted: 10 });
    expect(s3.keys("alpha")).toEqual(["keep/forever", "old/fresh"]);
    // One page per Activity: more sweep Activities than the two rules.
    expect(requestedModes.length).toBeGreaterThanOrEqual(6);
  }, 60_000);

  test("a chunk that deletes and then fails stops all later deletes in the run", async () => {
    const s3 = fixture();
    const { report, requestedModes } = await run({
      s3,
      policy: policy({ mode: "delete", maxDeletes: 1000 }),
      failAfterDeleting: { bucket: "alpha", count: 3 },
    });
    // alpha lost three objects the run could not count; beta must not delete.
    expect(s3.keys("alpha")).toHaveLength(4);
    expect(s3.keys("beta")).toHaveLength(7);
    expect(report.buckets[0]).toMatchObject({
      bucket: "alpha",
      error: "listing failed",
    });
    expect(report.buckets[1]?.rules[0]).toMatchObject({
      mode: "report",
      candidates: 5,
      deleted: 0,
    });
    expect(report.buckets[1]?.rules[0]?.note).toContain("deletes stopped");
    expect(requestedModes.at(-1)).toBe("report");
    expect(report.totals.failedBuckets).toBe(1);
  }, 60_000);

  test("a failing bucket is recorded and the other buckets still run", async () => {
    const s3 = fixture();
    const { report, published } = await run({
      s3,
      policy: policy(),
      failBucket: "alpha",
    });
    expect(report.buckets[0]).toMatchObject({
      bucket: "alpha",
      error: "S3 is down",
    });
    expect(report.buckets[0]?.rules[0]?.status).toBe("failed");
    expect(s3.keys("alpha")).toHaveLength(7);
    expect(report.buckets[1]?.rules[0]).toMatchObject({
      status: "complete",
      candidates: 5,
    });
    expect(report.totals.failedBuckets).toBe(1);
    expect(published).toHaveLength(1);
  }, 60_000);
});
