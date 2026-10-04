import { z } from "zod/v4";
import {
  RETENTION_BATCH_LIMIT,
  RetentionReceiptSchema,
  retentionEligible,
  type RetentionApplyInput,
  type RetentionCandidate,
  type RetentionCursor,
  type RetentionPlanInput,
  type RetentionReceipt,
  type RetentionRepo,
} from "#shared/woodpecker-retention.ts";
import type { RetentionClient } from "./woodpecker-retention-client.ts";
import { detailIsTerminal } from "./woodpecker-retention-client.ts";

export type RetentionProgress = { stage: string; receipts: RetentionReceipt[] };
export function retentionProgressFromHeartbeat(
  details: unknown,
): RetentionProgress {
  return details === undefined
    ? { stage: "retention", receipts: [] }
    : z
        .object({
          stage: z.string(),
          receipts: z.array(RetentionReceiptSchema),
        })
        .parse(details);
}
export type RetentionHooks = {
  signal: AbortSignal;
  onProgress: (progress: RetentionProgress) => void;
};

export async function planRetentionBatch(
  input: RetentionPlanInput,
  client: RetentionClient,
  hooks: RetentionHooks,
) {
  const candidates: RetentionCandidate[] = [];
  const repo = input.repos[input.cursor.repoIndex];
  if (repo === undefined)
    return {
      candidates,
      cursor: null,
      protectAllMain: false,
      scanned: 0,
      protectionReasons: new Array<string>(),
    };
  hooks.signal.throwIfAborted();
  const pipelines = await client.page(repo, input.cursor.page, input.cutoff);
  const refs = pipelines.length === 0 ? null : await client.references(repo);
  const offset = input.cursor.offset ?? 0;
  const scannedPipelines = pipelines.slice(
    offset,
    offset + Math.min(input.remaining, RETENTION_BATCH_LIMIT),
  );
  for (const pipeline of scannedPipelines) {
    hooks.signal.throwIfAborted();
    if (refs === null || !retentionEligible(repo, pipeline, input.cutoff, refs))
      continue;
    if (!detailIsTerminal(await client.detail(repo, pipeline.number))) continue;
    const logEntries = await client.logEntries(repo, pipeline.number);
    if (logEntries > 0) candidates.push({ repo, pipeline, logEntries });
    hooks.onProgress({ stage: "inventory", receipts: [] });
    if (candidates.length >= Math.min(input.remaining, RETENTION_BATCH_LIMIT))
      break;
  }
  const cursor: RetentionCursor =
    offset + scannedPipelines.length < pipelines.length
      ? { ...input.cursor, offset: offset + scannedPipelines.length }
      : pipelines.length < RETENTION_BATCH_LIMIT
        ? { repoIndex: input.cursor.repoIndex + 1, page: 1 }
        : { repoIndex: input.cursor.repoIndex, page: input.cursor.page + 1 };
  return {
    candidates,
    cursor: cursor.repoIndex < input.repos.length ? cursor : null,
    protectAllMain: refs?.protectAllMain ?? false,
    scanned: scannedPipelines.length,
    protectionReasons: refs?.protectionReasons ?? [],
  };
}

export async function applyRetentionBatch(
  input: RetentionApplyInput & { previous?: unknown },
  client: RetentionClient,
  hooks: RetentionHooks,
  enabled: () => Promise<boolean>,
) {
  if (input.candidates.length > RETENTION_BATCH_LIMIT)
    throw new Error("Retention batch exceeds 100 pipelines");
  const receipts = z.array(RetentionReceiptSchema).parse(input.previous ?? []);
  if (
    receipts.length > input.candidates.length ||
    receipts.some(
      (receipt, index) =>
        JSON.stringify(receipt.candidate) !==
        JSON.stringify(input.candidates[index]),
    )
  )
    throw new Error("Retention resume receipt does not match exact candidates");
  for (const candidate of input.candidates.slice(receipts.length)) {
    hooks.signal.throwIfAborted();
    const outcome = input.dryRun
      ? "dry-run"
      : await applyCandidate(candidate, input.cutoff, client, {
          hooks,
          enabled,
        });
    receipts.push({ candidate, outcome });
    hooks.onProgress({ stage: "retention", receipts: [...receipts] });
  }
  return receipts;
}

async function applyCandidate(
  candidate: RetentionCandidate,
  cutoff: number,
  client: RetentionClient,
  context: { hooks: RetentionHooks; enabled: () => Promise<boolean> },
): Promise<RetentionReceipt["outcome"]> {
  if (!sameRepo(await client.repo(candidate.repo.id), candidate.repo))
    return "changed";
  const detail = await client.detail(candidate.repo, candidate.pipeline.number);
  const refs = await client.references(candidate.repo);
  if (
    !detailIsTerminal(detail) ||
    !retentionEligible(candidate.repo, detail, cutoff, refs)
  )
    return "protected";
  if (
    ["commit", "created", "finished", "status", "branch", "ref"].some(
      (key) =>
        Reflect.get(detail, key) !== Reflect.get(candidate.pipeline, key),
    )
  )
    return "changed";
  if ((await client.logEntries(candidate.repo, detail.number)) === 0)
    return "already-empty";
  if (!(await context.enabled())) return "disabled";
  // Revalidate the external identity/reference guards immediately before the write.
  const freshDetail = await client.detail(candidate.repo, detail.number);
  const freshRefs = await client.references(candidate.repo);
  const freshRepo = await client.repo(candidate.repo.id);
  context.hooks.signal.throwIfAborted();
  if (
    !sameRepo(freshRepo, candidate.repo) ||
    !detailIsTerminal(freshDetail) ||
    JSON.stringify(freshDetail) !== JSON.stringify(detail) ||
    !retentionEligible(candidate.repo, freshDetail, cutoff, freshRefs)
  )
    return "changed";
  if (!(await context.enabled())) return "disabled";
  context.hooks.signal.throwIfAborted();
  await client.deleteLogs(candidate.repo, detail.number);
  return "deleted";
}

function sameRepo(actual: RetentionRepo, reviewed: RetentionRepo): boolean {
  return (
    actual.id === reviewed.id &&
    actual.full_name === reviewed.full_name &&
    actual.default_branch === reviewed.default_branch
  );
}
