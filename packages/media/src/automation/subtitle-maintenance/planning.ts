import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  subtitleAccepted,
  type SubtitleTarget,
} from "#domain/subtitle-quality.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  currentSubtitleUpgradeScoreV1,
  subtitleSearchDueV1,
} from "#domain/subtitle-maintenance/policy.ts";
import { targetKey } from "#automation/subtitles/authority.ts";
import {
  SubtitleMaintenanceJobV1Schema,
  type SubtitleMaintenanceModeV1,
  type SubtitleMaintenanceJobV1,
} from "#shared/subtitle-maintenance/activities.ts";
import type { maintenanceWorkV1, maintenanceScopeV1 } from "./work.ts";

export function nativeSubtitleMaintenanceInputV1(
  job: SubtitleMaintenanceJobV1,
) {
  const { movieScope, ...input } = job;
  return movieScope === undefined
    ? input
    : { ...input, schemaVersion: 4 as const, scope: movieScope };
}

type PlanInput = {
  work: Awaited<ReturnType<typeof maintenanceWorkV1>>;
  resolved: Awaited<ReturnType<typeof maintenanceScopeV1>>;
  target: SubtitleTarget;
  mode: SubtitleMaintenanceModeV1;
  epoch: number;
  now: Date;
};
function currentCaptions(input: PlanInput) {
  return input.work.asset.subtitles.filter((subtitle) =>
    subtitleAccepted({
      subtitle,
      asset: input.work.asset,
      epoch: input.epoch,
      target: input.target,
    }),
  );
}
function upgradeCaption(input: PlanInput) {
  return input.mode === "upgrade"
    ? currentCaptions(input)
        .filter(
          (subtitle) =>
            subtitle.storageKind === "sidecar" && subtitle.checksum !== null,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    : undefined;
}
async function unresolvedDownload(
  tx: Prisma.TransactionClient,
  previous: { id: string; status: string; result: unknown } | null,
  assetId: string,
) {
  if (previous === null) return false;
  if (previous.status === "reconciling") return true;
  if (
    !z.object({ subtitleDownload: z.unknown() }).safeParse(previous.result)
      .success
  )
    return false;
  return (
    (await tx.subtitleAsset.count({
      where: {
        assetId,
        qualityStatus: "rejected",
        matchingEvidence: { path: ["operationId"], equals: previous.id },
      },
    })) === 0
  );
}
function maintenanceKey(
  input: PlanInput,
  old: ReturnType<typeof upgradeCaption>,
) {
  const { work, mode, target } = input;
  return snapshotHash({
    assetId: work.asset.id,
    version: work.asset.version,
    checksum: work.asset.checksum,
    epoch: input.epoch,
    authority: work.authority,
    target: targetKey(target),
    mode,
    oldId: old?.id ?? null,
    oldVersion: old?.version ?? null,
  });
}
function maintenanceJob(
  input: PlanInput,
  old: ReturnType<typeof upgradeCaption>,
  score: ReturnType<typeof currentSubtitleUpgradeScoreV1>,
) {
  return SubtitleMaintenanceJobV1Schema.parse({
    operationId: crypto.randomUUID(),
    assetId: input.work.asset.id,
    ...input.target,
    recoveryEpoch: input.epoch,
    targetAuthority: input.work.authority,
    ...(input.resolved.movieScope === undefined
      ? {}
      : { movieScope: input.resolved.movieScope }),
    ...(old === undefined || score === null
      ? {}
      : {
          upgradeV1: {
            oldSubtitleId: old.id,
            oldVersion: old.version,
            oldChecksum: old.checksum,
            minimumScore: score,
          },
        }),
  });
}
export async function planSubtitleTargetV1(
  tx: Prisma.TransactionClient,
  input: PlanInput,
) {
  const { work, mode, now, target } = input;
  if (mode === "wanted" && currentCaptions(input).length > 0) return null;
  const old = upgradeCaption(input);
  const score =
    old === undefined ? null : currentSubtitleUpgradeScoreV1({ ...old, now });
  if (mode === "upgrade" && (old === undefined || score === null)) return null;
  const key = maintenanceKey(input, old);
  const historyWhere = {
    kind: "subtitle_maintenance_search",
    payload: { path: ["key"], equals: key },
  };
  const [first, last] = await Promise.all([
    tx.applicationEvent.findFirst({
      where: historyWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.applicationEvent.findFirst({
      where: historyWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const previous =
    last === null
      ? null
      : await tx.operation.findUniqueOrThrow({
          where: {
            id: z.object({ operationId: z.uuid() }).parse(last.payload)
              .operationId,
          },
        });
  if (previous !== null && ["queued", "running"].includes(previous.status))
    return SubtitleMaintenanceJobV1Schema.parse(
      z.object({ job: SubtitleMaintenanceJobV1Schema }).parse(previous.payload)
        .job,
    );
  if (await unresolvedDownload(tx, previous, work.asset.id)) return null;
  if (
    !subtitleSearchDueV1({
      mode,
      now,
      firstAttempt: first?.createdAt ?? null,
      lastAttempt: last?.createdAt ?? null,
    })
  )
    return null;
  const job = maintenanceJob(input, old, score);
  const operationId = job.operationId;
  const kind =
    job.movieScope === undefined
      ? "acquire_subtitles"
      : "acquire_movie_subtitles_v4";
  await tx.operation.create({
    data: {
      id: operationId,
      kind,
      targetId: job.assetId,
      idempotencyKey: `subtitle-maintenance-v1:${key}:${previous?.id ?? "initial"}`,
      payload: z
        .record(z.string(), z.json())
        .parse({ ...nativeSubtitleMaintenanceInputV1(job), kind, job }),
      createdAt: now,
    },
  });
  await tx.applicationEvent.create({
    data: {
      kind: "subtitle_maintenance_search",
      payload: {
        schemaVersion: 1,
        key,
        mode,
        operationId,
        assetId: job.assetId,
        target: targetKey(target),
      },
      createdAt: now,
    },
  });
  return job;
}
