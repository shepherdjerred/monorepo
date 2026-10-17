import type { Prisma } from "#generated/prisma/client.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { queueOperation } from "#automation/store.ts";
import { currentSubtitleWork, targetKey } from "./authority.ts";

/** Transactional enqueue only; network/files remain behind their final authority gates. */
export async function queueCurrentSubtitleTargets(
  tx: Prisma.TransactionClient,
  input: { assetId: string; epoch: number },
): Promise<number> {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    runtime.recoveryEpoch !== input.epoch ||
    runtime.mode !== "active" ||
    !runtime.ownershipConfirmed
  )
    return 0;
  const work = await currentSubtitleWork(tx, input.assetId, input.epoch);
  if (work.protectedReasons.length > 0) {
    await tx.applicationEvent.upsert({
      where: { dedupeKey: `subtitle-protected:${work.authority}` },
      create: {
        dedupeKey: `subtitle-protected:${work.authority}`,
        mediaId: work.asset.coverage[0]?.mediaId ?? null,
        kind: "subtitle_target_protected",
        payload: {
          assetId: input.assetId,
          recoveryEpoch: input.epoch,
          reasons: work.protectedReasons,
        },
      },
      update: {},
    });
    return 0;
  }
  let queued = 0;
  for (const target of work.targets) {
    if (
      work.asset.subtitles.some((subtitle) =>
        subtitleAccepted({
          subtitle,
          asset: work.asset,
          epoch: input.epoch,
          target,
        }),
      )
    )
      continue;
    const key = `subtitle:${input.assetId}:${targetKey(target)}:${work.authority}`;
    if (
      (await tx.operation.findUnique({ where: { idempotencyKey: key } })) !==
      null
    )
      continue;
    await queueOperation(tx, {
      key,
      kind: "acquire_subtitles",
      targetId: input.assetId,
      payload: {
        assetId: input.assetId,
        ...target,
        targetAuthority: work.authority,
      },
    });
    queued++;
  }
  return queued;
}

export async function queueMediaSubtitleTargets(
  tx: Prisma.TransactionClient,
  mediaId: string,
): Promise<void> {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId, current: true },
  });
  for (const item of coverage)
    await queueCurrentSubtitleTargets(tx, {
      assetId: item.assetId,
      epoch: runtime.recoveryEpoch,
    });
}
