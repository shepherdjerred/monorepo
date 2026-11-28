import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { createActivityObservability } from "#activities/activity-observability.ts";
import { withActivityHeartbeat } from "#activities/activity-heartbeat.ts";
import { seaweedfsLifecycleEnforcerConfig } from "#config/seaweedfs-lifecycle-enforcer.ts";
import {
  seaweedfsLifecycleBucketFailed,
  seaweedfsLifecycleCandidateBytes,
  seaweedfsLifecycleCandidates,
  seaweedfsLifecycleDeleted,
  seaweedfsLifecycleLastRunTimestamp,
} from "#observability/metrics-seaweedfs-lifecycle.ts";
import {
  RuleAccumulatorSchema,
  type BucketLifecycle,
  type LifecycleInventory,
  type LifecycleRunReport,
  type SweepRuleInput,
  type SweepRuleResult,
} from "#shared/seaweedfs-lifecycle/types.ts";
import { deletesAllowedFor } from "#shared/seaweedfs-lifecycle/report.ts";
import { createLifecycleS3 } from "./client.ts";
import {
  classifyLifecycleRules,
  sweepRuleChunk,
  type LifecycleS3,
} from "./core.ts";

const COMPONENT = "seaweedfs-lifecycle";
const { jsonLog } = createActivityObservability(
  COMPONENT,
  "seaweedfsLifecycle",
);

const SweepProgressSchema = z.object({
  stage: z.literal("sweep"),
  bucket: z.string(),
  ruleId: z.string(),
  startToken: z.string().optional(),
  result: z
    .object({
      token: z.string().optional(),
      accumulator: RuleAccumulatorSchema,
      status: z.enum(["running", "complete", "cap-reached", "aborted"]),
      mode: z.enum(["report", "delete"]),
      deletedThisChunk: z.number().int().nonnegative(),
      downgradeReason: z.string().optional(),
    })
    .nullable(),
});
type SweepProgress = z.infer<typeof SweepProgressSchema>;

/**
 * A retry of the same chunk resumes from its last heartbeat. The listing
 * position and counts travel together, so objects deleted by the failed
 * attempt are neither re-counted nor lost from the report.
 */
function resumeFrom(input: SweepRuleInput): SweepRuleResult | undefined {
  const parsed = SweepProgressSchema.safeParse(
    Context.current().info.heartbeatDetails,
  );
  if (
    !parsed.success ||
    parsed.data.result === null ||
    parsed.data.bucket !== input.bucket ||
    parsed.data.ruleId !== input.rule.id ||
    parsed.data.startToken !== input.token
  ) {
    return undefined;
  }
  // JSON heartbeats drop undefined fields; restore them explicitly.
  const { result } = parsed.data;
  return {
    token: result.token,
    accumulator: result.accumulator,
    status: result.status,
    mode: result.mode,
    deletedThisChunk: result.deletedThisChunk,
    downgradeReason: result.downgradeReason,
  };
}

export async function sweepRule(
  input: SweepRuleInput,
  client: LifecycleS3,
): Promise<SweepRuleResult> {
  const resumed = resumeFrom(input);
  if (resumed !== undefined && resumed.status !== "running") return resumed;
  const base: SweepRuleInput =
    resumed === undefined
      ? input
      : {
          ...input,
          token: resumed.token,
          accumulator: resumed.accumulator,
          mode: resumed.mode,
          deleteBudget: input.deleteBudget - resumed.deletedThisChunk,
        };
  const initial: SweepProgress = {
    stage: "sweep",
    bucket: input.bucket,
    ruleId: input.rule.id,
    startToken: input.token,
    result: resumed ?? null,
  };
  const result = await withActivityHeartbeat(
    Context.current(),
    (hooks) =>
      sweepRuleChunk(base, {
        client,
        signal: hooks.signal,
        onDeleted: (count) => {
          seaweedfsLifecycleDeleted.inc(
            { bucket: input.bucket, rule: input.rule.id },
            count,
          );
        },
        onCheckpoint: (checkpoint) => {
          hooks.onProgress({
            ...initial,
            result: {
              ...checkpoint,
              deletedThisChunk:
                checkpoint.deletedThisChunk + (resumed?.deletedThisChunk ?? 0),
            },
          });
        },
        deleteHalted: async () => {
          // Re-read the flags before every delete request so setting the mode
          // back to report stops deletion within one page.
          const policy = await seaweedfsLifecycleEnforcerConfig();
          return deletesAllowedFor(policy, input.bucket, false)
            ? undefined
            : "the mode flag left delete or the bucket left the allowlist";
        },
      }),
    initial,
    true,
  );
  return {
    ...result,
    deletedThisChunk:
      result.deletedThisChunk + (resumed?.deletedThisChunk ?? 0),
    downgradeReason: result.downgradeReason ?? resumed?.downgradeReason,
  };
}

async function readInventory(client: LifecycleS3): Promise<{
  buckets: BucketLifecycle[];
  withoutLifecycle: string[];
}> {
  const buckets: BucketLifecycle[] = [];
  const withoutLifecycle: string[] = [];
  const names = await client.listBuckets();
  for (const bucket of names.toSorted()) {
    const rules = await client.getLifecycleRules(bucket);
    if (rules === undefined) withoutLifecycle.push(bucket);
    else buckets.push(classifyLifecycleRules(bucket, rules));
  }
  return { buckets, withoutLifecycle };
}

export type SeaweedfsLifecycleActivities = typeof seaweedfsLifecycleActivities;

export const seaweedfsLifecycleActivities = {
  /**
   * Resolve the mode flags and read every bucket's live lifecycle
   * configuration, which is the source of truth for what to enforce.
   */
  async readSeaweedfsLifecycleInventory(): Promise<LifecycleInventory> {
    const policy = await seaweedfsLifecycleEnforcerConfig();
    const inventory = await readInventory(createLifecycleS3());
    jsonLog("info", "SeaweedFS lifecycle inventory", {
      mode: policy.mode,
      buckets: inventory.buckets.map((bucket) => ({
        bucket: bucket.bucket,
        rules: bucket.rules.length,
        unsupported: bucket.unsupported,
      })),
      withoutLifecycle: inventory.withoutLifecycle.length,
    });
    return { policy, ...inventory };
  },

  /**
   * Scan one rule's prefix for a bounded chunk of listing pages and, in
   * delete mode, delete what has expired. The Workflow continues it with the
   * returned token until the listing ends.
   */
  async sweepSeaweedfsLifecycleRule(
    input: SweepRuleInput,
  ): Promise<SweepRuleResult> {
    return sweepRule(input, createLifecycleS3());
  },

  /** Export the run's gauges and log the whole report as structured JSON. */
  publishSeaweedfsLifecycleReport(report: LifecycleRunReport): Promise<void> {
    seaweedfsLifecycleCandidates.reset();
    seaweedfsLifecycleCandidateBytes.reset();
    seaweedfsLifecycleBucketFailed.reset();
    for (const bucket of report.buckets) {
      seaweedfsLifecycleBucketFailed.set(
        { bucket: bucket.bucket },
        bucket.error === undefined ? 0 : 1,
      );
      for (const rule of bucket.rules) {
        const labels = { bucket: bucket.bucket, rule: rule.ruleId };
        seaweedfsLifecycleCandidates.set(labels, rule.candidates);
        seaweedfsLifecycleCandidateBytes.set(labels, rule.candidateBytes);
      }
    }
    const deleting = report.buckets.some((bucket) =>
      bucket.rules.some((rule) => rule.mode === "delete"),
    );
    seaweedfsLifecycleLastRunTimestamp.set(
      { mode: deleting ? "delete" : "report" },
      Date.now() / 1000,
    );
    jsonLog("info", "SeaweedFS lifecycle sweep report", {
      report,
      mode: deleting ? "delete" : "report",
    });
    return Promise.resolve();
  },
};
