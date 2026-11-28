import {
  LIFECYCLE_CHUNK_MILLIS,
  LIFECYCLE_CHUNK_PAGES,
  LIFECYCLE_DELETE_BATCH,
  LIFECYCLE_ERROR_SAMPLES,
  LIFECYCLE_MAX_DELETE_ERRORS,
  LIFECYCLE_PAGE_SIZE,
  LIFECYCLE_SAMPLE_KEYS,
  MILLIS_PER_DAY,
  type BucketLifecycle,
  type EnforceableRule,
  type LifecycleMode,
  type RuleAccumulator,
  type SweepRuleInput,
  type SweepRuleResult,
  type UnsupportedRule,
} from "#shared/seaweedfs-lifecycle/types.ts";

/** The slice of an S3 lifecycle rule this sweep reads; structurally the SDK's. */
export type LifecycleRuleDocument = {
  ID?: string | undefined;
  Status?: string | undefined;
  /** Legacy rule prefix, used when the rule has no `Filter`. */
  Prefix?: string | undefined;
  Filter?:
    | {
        Prefix?: string | undefined;
        Tag?: unknown;
        And?: unknown;
        ObjectSizeGreaterThan?: unknown;
        ObjectSizeLessThan?: unknown;
      }
    | undefined;
  Expiration?:
    | {
        Days?: number | undefined;
        Date?: unknown;
        ExpiredObjectDeleteMarker?: unknown;
      }
    | undefined;
  Transitions?: readonly unknown[] | undefined;
  NoncurrentVersionTransitions?: readonly unknown[] | undefined;
  NoncurrentVersionExpiration?: unknown;
};

export type ListedObject = {
  key: string;
  size: number;
  lastModified: Date | undefined;
};

export type ListedPage = {
  objects: readonly ListedObject[];
  nextToken: string | undefined;
};

export type DeleteFailure = { key: string; code: string; message: string };

/** What the sweep needs from S3; the real adapter wraps the AWS SDK. */
export type LifecycleS3 = {
  listBuckets: () => Promise<string[]>;
  /** `undefined` when the bucket has no lifecycle configuration. */
  getLifecycleRules: (
    bucket: string,
  ) => Promise<readonly LifecycleRuleDocument[] | undefined>;
  listObjects: (input: {
    bucket: string;
    prefix: string;
    token: string | undefined;
    maxKeys: number;
  }) => Promise<ListedPage>;
  /** Returns only the keys S3 refused to delete. */
  deleteObjects: (input: {
    bucket: string;
    keys: readonly string[];
  }) => Promise<DeleteFailure[]>;
};

type Classified =
  | { kind: "disabled" }
  | { kind: "unsupported"; rule: UnsupportedRule }
  | { kind: "enforceable"; rule: EnforceableRule };

function filterReasons(rule: LifecycleRuleDocument): string[] {
  const filter = rule.Filter;
  if (filter === undefined) {
    return rule.Prefix === undefined ? ["no filter or prefix"] : [];
  }
  const reasons: string[] = [];
  const usesTags = filter.Tag !== undefined || filter.And !== undefined;
  const usesSize =
    filter.ObjectSizeGreaterThan !== undefined ||
    filter.ObjectSizeLessThan !== undefined;
  if (usesTags) reasons.push("filter uses tags or And");
  if (usesSize) reasons.push("filter uses object size");
  if (!usesTags && !usesSize && filter.Prefix === undefined) {
    reasons.push("empty filter");
  }
  return reasons;
}

function expirationReasons(rule: LifecycleRuleDocument): string[] {
  const expiration = rule.Expiration;
  if (expiration === undefined) return ["no Expiration"];
  const reasons: string[] = [];
  if (expiration.Date !== undefined) reasons.push("Expiration.Date");
  if (expiration.ExpiredObjectDeleteMarker !== undefined) {
    reasons.push("ExpiredObjectDeleteMarker");
  }
  if (
    reasons.length === 0 &&
    (expiration.Days === undefined || expiration.Days < 1)
  ) {
    reasons.push("no Expiration.Days");
  }
  return reasons;
}

function versionReasons(rule: LifecycleRuleDocument): string[] {
  const reasons: string[] = [];
  if ((rule.Transitions?.length ?? 0) > 0) reasons.push("transitions");
  if ((rule.NoncurrentVersionTransitions?.length ?? 0) > 0) {
    reasons.push("noncurrent version transitions");
  }
  if (rule.NoncurrentVersionExpiration !== undefined) {
    reasons.push("noncurrent version expiration");
  }
  return reasons;
}

function unsupportedReasons(rule: LifecycleRuleDocument): string[] {
  return [
    ...filterReasons(rule),
    ...expirationReasons(rule),
    ...versionReasons(rule),
  ];
}

function classifyRule(rule: LifecycleRuleDocument, index: number): Classified {
  if (rule.Status !== "Enabled") return { kind: "disabled" };
  const id = rule.ID ?? `rule-${String(index)}`;
  const reasons = unsupportedReasons(rule);
  const days = rule.Expiration?.Days;
  if (days === undefined || reasons.length > 0) {
    return {
      kind: "unsupported",
      rule: { id, reason: reasons.join("; ") || "no Expiration.Days" },
    };
  }
  return {
    kind: "enforceable",
    rule: { id, prefix: rule.Filter?.Prefix ?? rule.Prefix ?? "", days },
  };
}

/**
 * Split a bucket's lifecycle rules into the ones this sweep enforces and the
 * ones it only reports. An Enabled rule is enforceable only when it expires by
 * `Days` over a plain key prefix (empty meaning the whole bucket); anything
 * the sweep cannot reproduce exactly is skipped rather than approximated.
 */
export function classifyLifecycleRules(
  bucket: string,
  rules: readonly LifecycleRuleDocument[],
): BucketLifecycle {
  const result: BucketLifecycle = {
    bucket,
    rules: [],
    unsupported: [],
    disabledRules: 0,
  };
  for (const [index, rule] of rules.entries()) {
    const classified = classifyRule(rule, index);
    if (classified.kind === "disabled") result.disabledRules += 1;
    else if (classified.kind === "unsupported") {
      result.unsupported.push(classified.rule);
    } else result.rules.push(classified.rule);
  }
  return result;
}

/**
 * Whether an object has outlived a rule: strictly older than `days` whole
 * days at `nowMs`. An object written exactly `days` ago is kept.
 */
export function isExpired(
  lastModified: Date | undefined,
  days: number,
  nowMs: number,
): boolean {
  return (
    lastModified !== undefined &&
    lastModified.getTime() < nowMs - days * MILLIS_PER_DAY
  );
}

export type SweepHooks = {
  client: LifecycleS3;
  /**
   * Called after every page with the whole chunk state so far; a retry can
   * resume from it instead of re-scanning (and re-counting) finished pages.
   */
  onCheckpoint?: (checkpoint: SweepRuleResult) => void;
  /** Called after each delete request with the objects it removed. */
  onDeleted?: (count: number) => void;
  signal?: AbortSignal;
  clock?: () => number;
  maxPages?: number | undefined;
  chunkMillis?: number | undefined;
  /**
   * Re-reads the policy before every delete request. A string stops deletion
   * for the rest of the chunk and says why.
   */
  deleteHalted?: () => Promise<string | undefined>;
};

function recordCandidate(
  accumulator: RuleAccumulator,
  object: ListedObject,
): void {
  accumulator.candidates += 1;
  accumulator.candidateBytes += object.size;
  const modified = object.lastModified?.getTime();
  if (modified !== undefined) {
    accumulator.oldestModifiedMs = Math.min(
      accumulator.oldestModifiedMs ?? modified,
      modified,
    );
    accumulator.newestModifiedMs = Math.max(
      accumulator.newestModifiedMs ?? modified,
      modified,
    );
  }
  if (accumulator.sampleKeys.length < LIFECYCLE_SAMPLE_KEYS) {
    accumulator.sampleKeys.push(object.key);
  }
}

async function deleteSelected(
  input: { bucket: string; selected: readonly ListedObject[] },
  accumulator: RuleAccumulator,
  hooks: SweepHooks,
): Promise<number> {
  let deleted = 0;
  for (
    let offset = 0;
    offset < input.selected.length;
    offset += LIFECYCLE_DELETE_BATCH
  ) {
    hooks.signal?.throwIfAborted();
    const batch = input.selected.slice(offset, offset + LIFECYCLE_DELETE_BATCH);
    const failures = await hooks.client.deleteObjects({
      bucket: input.bucket,
      keys: batch.map((object) => object.key),
    });
    const failedKeys = new Set(failures.map((failure) => failure.key));
    const removed = batch.filter((object) => !failedKeys.has(object.key));
    accumulator.deleted += removed.length;
    accumulator.deletedBytes += removed.reduce(
      (sum, object) => sum + object.size,
      0,
    );
    accumulator.deleteErrors += failures.length;
    for (const failure of failures) {
      if (accumulator.errorSamples.length < LIFECYCLE_ERROR_SAMPLES) {
        accumulator.errorSamples.push(
          `${failure.key}: ${failure.code} ${failure.message}`.trim(),
        );
      }
    }
    deleted += removed.length;
    hooks.onDeleted?.(removed.length);
  }
  return deleted;
}

type ChunkState = {
  accumulator: RuleAccumulator;
  mode: LifecycleMode;
  status: SweepRuleResult["status"];
  deletedThisChunk: number;
  downgradeReason: string | undefined;
};

/** Record the page's expired objects; stops at the delete budget. */
function selectExpired(
  input: SweepRuleInput,
  listed: ListedPage,
  chunk: ChunkState,
): ListedObject[] {
  const selected: ListedObject[] = [];
  for (const object of listed.objects) {
    chunk.accumulator.scanned += 1;
    if (
      // The server must honour the prefix, but never delete on its word alone.
      !object.key.startsWith(input.rule.prefix) ||
      !isExpired(object.lastModified, input.rule.days, input.nowMs)
    ) {
      continue;
    }
    if (
      chunk.mode === "delete" &&
      chunk.deletedThisChunk + selected.length >= input.deleteBudget
    ) {
      chunk.status = "cap-reached";
      break;
    }
    recordCandidate(chunk.accumulator, object);
    if (chunk.mode === "delete") selected.push(object);
  }
  return selected;
}

/** Delete a page's selection unless the policy has since halted deletes. */
async function deletePage(
  input: SweepRuleInput,
  selected: readonly ListedObject[],
  chunk: ChunkState,
  hooks: SweepHooks,
): Promise<void> {
  if (chunk.mode !== "delete" || selected.length === 0) return;
  const halted = await hooks.deleteHalted?.();
  if (halted === undefined) {
    chunk.deletedThisChunk += await deleteSelected(
      { bucket: input.bucket, selected },
      chunk.accumulator,
      hooks,
    );
  } else {
    chunk.mode = "report";
    chunk.downgradeReason = halted;
  }
}

function toResult(
  chunk: ChunkState,
  token: string | undefined,
): SweepRuleResult {
  return {
    token: chunk.status === "running" ? token : undefined,
    accumulator: chunk.accumulator,
    status: chunk.status,
    mode: chunk.mode,
    deletedThisChunk: chunk.deletedThisChunk,
    downgradeReason: chunk.downgradeReason,
  };
}

/**
 * Scan one rule's prefix for up to a chunk of listing pages, recording every
 * object the rule has expired and, in delete mode, deleting it.
 *
 * Idempotent on retry: a chunk re-lists from its continuation token rather
 * than trusting any earlier page, and deleting an object twice is harmless.
 * Nothing outside `rule.prefix` is ever selected, even if the server returns
 * keys beyond the requested prefix.
 */
export async function sweepRuleChunk(
  input: SweepRuleInput,
  hooks: SweepHooks,
): Promise<SweepRuleResult> {
  const clock = hooks.clock ?? Date.now;
  const startedAt = clock();
  const maxPages = hooks.maxPages ?? LIFECYCLE_CHUNK_PAGES;
  const chunkMillis = hooks.chunkMillis ?? LIFECYCLE_CHUNK_MILLIS;
  const chunk: ChunkState = {
    accumulator: structuredClone(input.accumulator),
    mode: input.mode,
    status: "running",
    deletedThisChunk: 0,
    downgradeReason: undefined,
  };
  let token = input.token;

  for (let page = 0; page < maxPages; page += 1) {
    hooks.signal?.throwIfAborted();
    const listed = await hooks.client.listObjects({
      bucket: input.bucket,
      prefix: input.rule.prefix,
      token,
      maxKeys: LIFECYCLE_PAGE_SIZE,
    });
    await deletePage(input, selectExpired(input, listed, chunk), chunk, hooks);
    token = listed.nextToken;
    if (chunk.status === "running") {
      if (chunk.accumulator.deleteErrors >= LIFECYCLE_MAX_DELETE_ERRORS) {
        chunk.status = "aborted";
      } else if (token === undefined) {
        chunk.status = "complete";
      }
    }
    hooks.onCheckpoint?.(structuredClone(toResult(chunk, token)));
    if (chunk.status !== "running" || clock() - startedAt >= chunkMillis) break;
  }
  return toResult(chunk, token);
}
