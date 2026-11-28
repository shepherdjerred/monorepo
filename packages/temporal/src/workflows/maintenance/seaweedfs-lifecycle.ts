import { isCancellation, log, proxyActivities } from "@temporalio/workflow";
import type { SeaweedfsLifecycleActivities } from "#activities/maintenance/seaweedfs-lifecycle/activities.ts";
import {
  deletesAllowedFor,
  ruleReport,
  summarizeRun,
} from "#shared/seaweedfs-lifecycle/report.ts";
import {
  emptyAccumulator,
  LifecycleInputSchema,
  type BucketLifecycle,
  type BucketReport,
  type EnforceableRule,
  type LifecycleInput,
  type LifecycleMode,
  type LifecyclePolicyView,
  type LifecycleRunReport,
  type RuleAccumulator,
  type RuleReport,
  type SweepRuleResult,
} from "#shared/seaweedfs-lifecycle/types.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { readSeaweedfsLifecycleInventory, publishSeaweedfsLifecycleReport } =
  proxyActivities<SeaweedfsLifecycleActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "5 minutes",
    heartbeatTimeout: "2 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30 seconds",
      maximumInterval: "2 minutes",
    },
  });

// One chunk is at most eight minutes of listing and deleting (the Activity
// stops itself), so the infra queue, which runs one Activity at a time, never
// stays pinned for the whole sweep. A retry resumes from its last heartbeat.
const { sweepSeaweedfsLifecycleRule } =
  proxyActivities<SeaweedfsLifecycleActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "20 minutes",
    heartbeatTimeout: "2 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30 seconds",
      backoffCoefficient: 2,
      maximumInterval: "5 minutes",
    },
  });

/** The innermost cause: an ActivityFailure's own message says nothing useful. */
function failureMessage(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error && current.cause instanceof Error) {
    current = current.cause;
  }
  return current instanceof Error ? current.message : String(current);
}

/** Run-wide state the rules of every bucket share. */
type RunState = {
  readonly policy: LifecyclePolicyView;
  readonly dryRun: boolean;
  readonly nowMs: number;
  /** Objects the run may still delete. */
  deleteBudget: number;
  /** Why deletes stopped for the rest of the run, once they did. */
  deletesHalted: string | undefined;
};

function initialRuleMode(
  state: RunState,
  deletesAllowed: boolean,
): { mode: LifecycleMode; note: string | undefined } {
  if (!deletesAllowed) return { mode: "report", note: undefined };
  if (state.deletesHalted !== undefined) {
    return {
      mode: "report",
      note: `deletes stopped earlier in this run: ${state.deletesHalted}`,
    };
  }
  if (state.deleteBudget <= 0) {
    return {
      mode: "report",
      note: "per-run delete cap exhausted earlier in this run",
    };
  }
  return { mode: "delete", note: undefined };
}

/** One rule's progress across its chunks. */
type RuleRun = {
  mode: LifecycleMode;
  note: string | undefined;
  status: RuleReport["status"];
  accumulator: RuleAccumulator;
  token: string | undefined;
};

/** Fold one finished chunk into the rule's progress and the run's budget. */
function absorbChunk(
  state: RunState,
  run: RuleRun,
  chunk: SweepRuleResult,
): void {
  run.accumulator = chunk.accumulator;
  run.token = chunk.token;
  state.deleteBudget -= chunk.deletedThisChunk;
  if (chunk.mode !== run.mode) {
    run.mode = chunk.mode;
    state.deletesHalted = chunk.downgradeReason ?? "downgraded";
    run.note = `deletes stopped: ${state.deletesHalted}`;
  }
  if (chunk.status === "cap-reached") {
    run.status = "cap-reached";
    state.deleteBudget = 0;
    run.note = `per-run delete cap of ${String(state.policy.maxDeletes)} reached; candidate counts are a lower bound`;
  } else if (chunk.status === "aborted") {
    run.status = "aborted";
    run.note = "too many delete errors; rule stopped";
  }
}

/** Sweep one rule chunk by chunk until its listing ends, a cap or an abort. */
async function sweepRule(
  state: RunState,
  bucket: string,
  rule: EnforceableRule,
  deletesAllowed: boolean,
): Promise<RuleReport> {
  const run: RuleRun = {
    ...initialRuleMode(state, deletesAllowed),
    status: "complete",
    accumulator: emptyAccumulator(),
    token: undefined,
  };
  for (;;) {
    let chunk: SweepRuleResult;
    try {
      chunk = await sweepSeaweedfsLifecycleRule({
        bucket,
        rule,
        nowMs: state.nowMs,
        mode: run.mode,
        deleteBudget: state.deleteBudget,
        token: run.token,
        accumulator: run.accumulator,
      });
    } catch (error: unknown) {
      if (isCancellation(error)) throw error;
      // Keep what earlier chunks found or deleted; the bucket is marked failed.
      run.status = "failed";
      run.note = failureMessage(error);
      if (run.mode === "delete") {
        // The failed chunk may have deleted objects the run cannot count, so
        // the cap can no longer be trusted: fail closed and report only for
        // the rest of the run rather than reconciling from heartbeats.
        state.deleteBudget = 0;
        state.deletesHalted = `a delete chunk failed in ${bucket}`;
      }
      break;
    }
    absorbChunk(state, run, chunk);
    if (chunk.status !== "running") break;
  }
  return ruleReport({ rule, nowMs: state.nowMs, ...run });
}

async function sweepBucket(
  state: RunState,
  lifecycle: BucketLifecycle,
): Promise<BucketReport> {
  const deletesAllowed = deletesAllowedFor(
    state.policy,
    lifecycle.bucket,
    state.dryRun,
  );
  const report: BucketReport = {
    bucket: lifecycle.bucket,
    deletesAllowed,
    rules: [],
    unsupported: lifecycle.unsupported,
    disabledRules: lifecycle.disabledRules,
  };
  for (const rule of lifecycle.rules) {
    const ruleResult = await sweepRule(
      state,
      lifecycle.bucket,
      rule,
      deletesAllowed,
    );
    report.rules.push(ruleResult);
    if (ruleResult.status === "failed") {
      // One failing bucket must not stop the others; its remaining rules wait
      // for tomorrow's run, and the report and metric say so.
      report.error = ruleResult.note ?? "sweep failed";
      break;
    }
  }
  return report;
}

/**
 * SeaweedFS stores S3 lifecycle `Expiration` rules but never enforces them, so
 * this daily sweep applies every Enabled prefix-and-days rule itself. It
 * deletes only when the `seaweedfs-lifecycle-enforcer-mode` flag is `delete`
 * and `dryRun` is not set; otherwise it reports what it would delete.
 */
export async function runSeaweedfsLifecycleEnforcer(
  rawInput: LifecycleInput = {},
): Promise<LifecycleRunReport> {
  const { dryRun } = LifecycleInputSchema.parse(rawInput);
  const startedAt = new Date();
  const inventory = await readSeaweedfsLifecycleInventory();
  const state: RunState = {
    policy: inventory.policy,
    dryRun,
    nowMs: startedAt.getTime(),
    deleteBudget: inventory.policy.maxDeletes,
    deletesHalted: undefined,
  };
  const buckets: BucketReport[] = [];
  for (const lifecycle of inventory.buckets) {
    buckets.push(await sweepBucket(state, lifecycle));
  }
  const result = summarizeRun({
    startedAt,
    policy: inventory.policy,
    dryRun,
    buckets,
    withoutLifecycle: inventory.withoutLifecycle,
  });
  await publishSeaweedfsLifecycleReport(result);
  log.info("SeaweedFS lifecycle sweep complete", {
    dryRun,
    configuredMode: inventory.policy.mode,
    ...result.totals,
  });
  return result;
}
