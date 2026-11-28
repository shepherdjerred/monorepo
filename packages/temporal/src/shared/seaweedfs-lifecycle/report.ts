import {
  MILLIS_PER_DAY,
  type BucketReport,
  type EnforceableRule,
  type LifecycleMode,
  type LifecyclePolicyView,
  type LifecycleRunReport,
  type RuleAccumulator,
  type RuleReport,
} from "#shared/seaweedfs-lifecycle/types.ts";

/** Whether the allowlist permits deleting from a bucket. */
export function deletesAllowedFor(
  policy: Pick<LifecyclePolicyView, "mode" | "buckets">,
  bucket: string,
  dryRun: boolean,
): boolean {
  return (
    !dryRun &&
    policy.mode === "delete" &&
    (policy.buckets === "*" || policy.buckets.includes(bucket))
  );
}

function ageDays(modifiedMs: number | null, nowMs: number): number | null {
  return modifiedMs === null
    ? null
    : Math.round(((nowMs - modifiedMs) / MILLIS_PER_DAY) * 10) / 10;
}

export function ruleReport(input: {
  rule: EnforceableRule;
  accumulator: RuleAccumulator;
  mode: LifecycleMode;
  status: RuleReport["status"];
  note?: string | undefined;
  nowMs: number;
}): RuleReport {
  const { accumulator, nowMs } = input;
  return {
    ruleId: input.rule.id,
    prefix: input.rule.prefix,
    days: input.rule.days,
    mode: input.mode,
    status: input.status,
    note: input.note,
    scanned: accumulator.scanned,
    candidates: accumulator.candidates,
    candidateBytes: accumulator.candidateBytes,
    // The oldest candidate has the oldest LastModified, hence the largest age.
    oldestCandidateAgeDays: ageDays(accumulator.oldestModifiedMs, nowMs),
    newestCandidateAgeDays: ageDays(accumulator.newestModifiedMs, nowMs),
    sampleKeys: accumulator.sampleKeys,
    deleted: accumulator.deleted,
    deletedBytes: accumulator.deletedBytes,
    deleteErrors: accumulator.deleteErrors,
    errorSamples: accumulator.errorSamples,
  };
}

export function summarizeRun(input: {
  startedAt: Date;
  policy: LifecyclePolicyView;
  dryRun: boolean;
  buckets: BucketReport[];
  withoutLifecycle: string[];
}): LifecycleRunReport {
  const rules = input.buckets.flatMap((bucket) => bucket.rules);
  return {
    startedAt: input.startedAt.toISOString(),
    configuredMode: input.policy.mode,
    dryRun: input.dryRun,
    maxDeletes: input.policy.maxDeletes,
    allowlist: input.policy.buckets,
    provenance: input.policy.provenance,
    buckets: input.buckets,
    withoutLifecycle: input.withoutLifecycle,
    totals: {
      candidates: rules.reduce((sum, rule) => sum + rule.candidates, 0),
      candidateBytes: rules.reduce((sum, rule) => sum + rule.candidateBytes, 0),
      deleted: rules.reduce((sum, rule) => sum + rule.deleted, 0),
      deletedBytes: rules.reduce((sum, rule) => sum + rule.deletedBytes, 0),
      unsupportedRules: input.buckets.reduce(
        (sum, bucket) => sum + bucket.unsupported.length,
        0,
      ),
      failedBuckets: input.buckets.filter(
        (bucket) => bucket.error !== undefined,
      ).length,
    },
  };
}
