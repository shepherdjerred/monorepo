import { z } from "zod/v4";

/** S3 `DeleteObjects` accepts at most 1000 keys per request. */
export const LIFECYCLE_DELETE_BATCH = 1000;
/** Keys listed per `ListObjectsV2` page. */
export const LIFECYCLE_PAGE_SIZE = 1000;
/** Candidate keys kept per rule so an operator can eyeball what would go. */
export const LIFECYCLE_SAMPLE_KEYS = 10;
/** Listing pages one sweep Activity scans before the Workflow continues it. */
export const LIFECYCLE_CHUNK_PAGES = 400;
/** Wall-clock budget of one sweep Activity, so it never pins the infra queue. */
export const LIFECYCLE_CHUNK_MILLIS = 8 * 60_000;
/** Per-key delete failures after which a rule stops. */
export const LIFECYCLE_MAX_DELETE_ERRORS = 100;
/** Failure samples kept per rule. */
export const LIFECYCLE_ERROR_SAMPLES = 5;

export const MILLIS_PER_DAY = 86_400_000;

export const LifecycleModeSchema = z.enum(["report", "delete"]);
export type LifecycleMode = z.infer<typeof LifecycleModeSchema>;

export const LifecycleInputSchema = z.object({
  /** Force report mode for this run whatever the mode flag says. */
  dryRun: z.boolean().default(false),
});
export type LifecycleInput = z.input<typeof LifecycleInputSchema>;

/** One Enabled rule with `Expiration.Days` over a key prefix. */
export type EnforceableRule = {
  id: string;
  /** Empty means every object in the bucket. */
  prefix: string;
  days: number;
};

/** A rule this sweep cannot enforce faithfully, reported and never applied. */
export type UnsupportedRule = { id: string; reason: string };

export type BucketLifecycle = {
  bucket: string;
  rules: EnforceableRule[];
  unsupported: UnsupportedRule[];
  /** Rules with a Status other than Enabled. */
  disabledRules: number;
};

export type LifecyclePolicyView = {
  /** The configured mode, before the per-run `dryRun` override. */
  mode: LifecycleMode;
  maxDeletes: number;
  buckets: readonly string[] | "*";
  provenance: { mode: string; maxDeletes: string; buckets: string };
};

export type LifecycleInventory = {
  policy: LifecyclePolicyView;
  buckets: BucketLifecycle[];
  /** Buckets with no lifecycle configuration; never touched. */
  withoutLifecycle: string[];
};

export const RuleAccumulatorSchema = z.object({
  scanned: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  candidateBytes: z.number().nonnegative(),
  oldestModifiedMs: z.number().nullable(),
  newestModifiedMs: z.number().nullable(),
  sampleKeys: z.array(z.string()),
  deleted: z.number().int().nonnegative(),
  deletedBytes: z.number().nonnegative(),
  deleteErrors: z.number().int().nonnegative(),
  errorSamples: z.array(z.string()),
});
export type RuleAccumulator = z.infer<typeof RuleAccumulatorSchema>;

export function emptyAccumulator(): RuleAccumulator {
  return {
    scanned: 0,
    candidates: 0,
    candidateBytes: 0,
    oldestModifiedMs: null,
    newestModifiedMs: null,
    sampleKeys: [],
    deleted: 0,
    deletedBytes: 0,
    deleteErrors: 0,
    errorSamples: [],
  };
}

export type SweepStatus = "running" | "complete" | "cap-reached" | "aborted";

export type SweepRuleInput = {
  bucket: string;
  rule: EnforceableRule;
  /** Epoch milliseconds the whole run measures age against. */
  nowMs: number;
  /** The mode the Workflow asks for; the Activity may only downgrade it. */
  mode: LifecycleMode;
  /** Objects this chunk may still delete in the run. */
  deleteBudget: number;
  /** Listing continuation; absent for the first chunk of a rule. */
  token?: string | undefined;
  accumulator: RuleAccumulator;
};

export type SweepRuleResult = {
  /** The continuation for the next chunk; undefined once the listing ended. */
  token: string | undefined;
  accumulator: RuleAccumulator;
  status: SweepStatus;
  /** The mode this chunk actually ran in. */
  mode: LifecycleMode;
  deletedThisChunk: number;
  /** Why a requested delete ran as a report, when it did. */
  downgradeReason?: string | undefined;
};

export type RuleReport = {
  ruleId: string;
  prefix: string;
  days: number;
  /** The mode this rule's sweep ran in. */
  mode: LifecycleMode;
  status: "complete" | "cap-reached" | "aborted" | "failed";
  note?: string | undefined;
  scanned: number;
  candidates: number;
  candidateBytes: number;
  oldestCandidateAgeDays: number | null;
  newestCandidateAgeDays: number | null;
  sampleKeys: string[];
  deleted: number;
  deletedBytes: number;
  deleteErrors: number;
  errorSamples: string[];
};

export type BucketReport = {
  bucket: string;
  /** Whether this bucket was eligible for deletes this run. */
  deletesAllowed: boolean;
  rules: RuleReport[];
  unsupported: UnsupportedRule[];
  disabledRules: number;
  error?: string | undefined;
};

export type LifecycleRunReport = {
  startedAt: string;
  /** The configured mode; `dryRun` input forces report whatever it says. */
  configuredMode: LifecycleMode;
  dryRun: boolean;
  maxDeletes: number;
  allowlist: readonly string[] | "*";
  provenance: { mode: string; maxDeletes: string; buckets: string };
  buckets: BucketReport[];
  withoutLifecycle: string[];
  totals: {
    candidates: number;
    candidateBytes: number;
    deleted: number;
    deletedBytes: number;
    unsupportedRules: number;
    failedBuckets: number;
  };
};
