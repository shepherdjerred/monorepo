import {
  compareRankedRenovateUpdates,
  isRenovateUpdateEligible,
  type RenovateDisposition,
  type RenovateRankingSnapshot,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import {
  MAIN_BRANCH,
  type BundlePullRequest,
  type RenovateGitHub,
  type hasWoodpeckerReceipt,
} from "./publication.ts";
import type {
  DispatchRecord,
  Publication,
  createRenovateStore,
} from "./store.ts";

const PUBLISH_SETTLEMENT_MS = 5 * 60 * 1000;
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export function recordDisposition(
  record: DispatchRecord,
  id: string,
  next: Omit<RenovateDisposition, "updatedAt">,
  now: number,
): void {
  const current = record.value.dispositions[id];
  if (
    current?.status === next.status &&
    current.reason === next.reason &&
    current.prUrl === next.prUrl &&
    current.revisedEffort === next.revisedEffort
  )
    return;
  record.value.dispositions[id] = {
    ...next,
    updatedAt: new Date(now).toISOString(),
  };
}

export function observePullRequest(
  record: DispatchRecord,
  publication: Publication,
  pr: BundlePullRequest,
  now: number,
): void {
  publication.prNumber = pr.number;
  publication.state = pr.state;
  if (publication.observedHeadSha !== pr.headSha) {
    publication.woodpeckerSeen = false;
    publication.observedHeadSha = pr.headSha;
  }
  const status = pr.state === "open" ? "published" : pr.state;
  const reason =
    pr.state === "open"
      ? pr.headSha === publication.headSha
        ? "Verified bundle is open for review."
        : "PR head changed after the bundle was verified."
      : pr.state === "merged"
        ? "Bundle merged."
        : "Bundle was closed without merging.";
  for (const { id } of publication.candidates)
    recordDisposition(record, id, { status, reason, prUrl: pr.url }, now);
}

export function isActivePublication(publication: Publication): boolean {
  return publication.state !== "closed" && publication.state !== "merged";
}

function deferPublication(
  record: DispatchRecord,
  publication: Publication,
  reason: string,
  now: number,
): void {
  record.value.publications = Object.fromEntries(
    Object.entries(record.value.publications).filter(
      ([branch]) => branch !== publication.branch,
    ),
  );
  for (const { id } of publication.candidates)
    recordDisposition(record, id, { status: "queued", reason }, now);
}

type ReconcileContext = {
  record: DispatchRecord;
  github: RenovateGitHub;
  canPublish: () => Promise<boolean>;
  stillEligible: (publication: Publication) => boolean;
  hasReceipt: typeof hasWoodpeckerReceipt;
  now: number;
  save: () => Promise<void>;
};

async function recoverPublication(
  ctx: ReconcileContext,
  publication: Publication,
) {
  const { record, github, now } = ctx;
  if (now - Date.parse(publication.plannedAt) < PUBLISH_SETTLEMENT_MS)
    return { state: "waiting" as const };
  const remoteSha = await github.branchHead(publication.branch);
  if (remoteSha === undefined) {
    deferPublication(
      record,
      publication,
      "Previous publication did not reach GitHub. Ready to retry.",
      now,
    );
    return { state: "dropped" as const };
  }
  if (remoteSha !== publication.headSha)
    throw new Error(
      `Dependency bundle ref ${publication.branch} no longer matches its journaled commit`,
    );
  if ((await github.branchHead(MAIN_BRANCH)) !== publication.baseSha) {
    deferPublication(
      record,
      publication,
      "Main changed before PR creation. Reverification is needed.",
      now,
    );
    return { state: "dropped" as const };
  }
  const paths = await github.openWorkPaths();
  if (publication.files.some((path) => paths.has(path))) {
    for (const { id } of publication.candidates) {
      recordDisposition(
        record,
        id,
        {
          status: "queued",
          reason: "An open PR overlaps the prepared dependency branch.",
        },
        now,
      );
    }
    return { state: "reserved" as const };
  }
  if (!ctx.stillEligible(publication)) return { state: "reserved" as const };
  if (!(await ctx.canPublish())) return { state: "waiting" as const };
  // Claim the recovery before creating the PR. Another worker must use readback.
  publication.plannedAt = new Date(now).toISOString();
  await ctx.save();
  return {
    state: "recovered" as const,
    pr: await github.createRecoveredPullRequest(publication),
  };
}

export async function reconcilePublications(
  ctx: ReconcileContext,
): Promise<boolean> {
  let awaitingReceipt = false;
  for (const publication of Object.values(ctx.record.value.publications).filter(
    (candidate) => isActivePublication(candidate),
  )) {
    let pr = await ctx.github.findPullRequest(publication);
    if (pr === undefined) {
      const recovery = await recoverPublication(ctx, publication);
      if (recovery.state !== "recovered") {
        awaitingReceipt ||= recovery.state === "waiting";
        continue;
      }
      pr = recovery.pr;
    }
    observePullRequest(ctx.record, publication, pr, ctx.now);
    if (pr.state === "open" && !publication.woodpeckerSeen) {
      publication.woodpeckerSeen = await ctx.hasReceipt(pr.number, pr.headSha);
      awaitingReceipt ||= !publication.woodpeckerSeen;
    }
  }
  return awaitingReceipt;
}

function blocksCurrentScan(
  previous: RenovateDisposition | undefined,
  scannedAt: string,
): boolean {
  if (previous === undefined) return false;
  const terminal =
    previous.revisedEffort === "l" ||
    previous.status === "published" ||
    previous.status === "closed" ||
    previous.status === "landed";
  return (
    terminal ||
    ((previous.status === "merged" || previous.status === "blocked") &&
      previous.updatedAt >= scannedAt)
  );
}

export function candidatesForDispatch(
  snapshot: RenovateRankingSnapshot,
  record: DispatchRecord,
  now: number,
) {
  const reserved = new Set(
    Object.values(record.value.publications)
      .filter(({ state }) => state === undefined)
      .flatMap(({ candidates }) => candidates.map(({ id }) => id)),
  );
  return snapshot.candidates
    .filter(
      (candidate) =>
        !reserved.has(candidate.id) &&
        isRenovateUpdateEligible(candidate, now) &&
        !blocksCurrentScan(
          record.value.dispositions[candidate.id],
          snapshot.scannedAt,
        ),
    )
    .sort(compareRankedRenovateUpdates);
}

export function pruneDispatch(
  record: DispatchRecord,
  snapshot: RenovateRankingSnapshot,
  now: number,
): void {
  const retained = new Set(snapshot.candidates.map(({ id }) => id));
  record.value.publications = Object.fromEntries(
    Object.entries(record.value.publications).filter(
      ([, publication]) =>
        isActivePublication(publication) ||
        publication.candidates.some(
          ({ id }) =>
            retained.has(id) ||
            Date.parse(
              record.value.dispositions[id]?.updatedAt ?? publication.plannedAt,
            ) >=
              now - RETAIN_MS,
        ),
    ),
  );
  for (const publication of Object.values(record.value.publications)) {
    for (const { id } of publication.candidates) retained.add(id);
  }
  record.value.dispositions = Object.fromEntries(
    Object.entries(record.value.dispositions).filter(([id]) =>
      retained.has(id),
    ),
  );
}

export function createDispatchSave(
  store: ReturnType<typeof createRenovateStore>,
  record: DispatchRecord,
  preview: boolean,
) {
  let stored = JSON.stringify(record.value);
  return async () => {
    const serialized = JSON.stringify(record.value);
    if (serialized === stored || preview) return;
    const saved = await store.writeDispatch(record);
    if (saved.etag === undefined)
      throw new Error("Renovate dispatch save has no ETag");
    record.etag = saved.etag;
    stored = serialized;
  };
}
