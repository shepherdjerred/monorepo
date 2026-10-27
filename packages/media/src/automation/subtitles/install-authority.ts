import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  currentSubtitleWork,
  SubtitleWorkSchema,
  targetRequired,
} from "./authority.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { reusableEmbeddedSubtitle } from "./embedded.ts";

/** Caller holds media → effective requests → runtime → policy locks. */
export async function assertSubtitleTarget(
  tx: Prisma.TransactionClient,
  input: { operationId: string; subtitleId: string; epoch: number },
) {
  const subtitle = await tx.subtitleAsset.findUniqueOrThrow({
    where: { id: input.subtitleId },
  });
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const work = await currentSubtitleWork(tx, subtitle.assetId, input.epoch);
  if (
    !subtitleAccepted({
      subtitle,
      asset: work.asset,
      epoch: input.epoch,
      allowStaged: true,
    })
  )
    throw new FileGuardError("subtitle_quality_changed");
  const evidence = z
    .object({ targetAuthority: z.string().optional() })
    .parse(subtitle.matchingEvidence);
  if (
    subtitle.state !== "installed" &&
    evidence.targetAuthority !== undefined &&
    evidence.targetAuthority !== work.authority
  )
    throw new FileGuardError("subtitle_target_changed");
  if (operation.kind === "acquire_subtitles") {
    const target = SubtitleWorkSchema.extend({
      assetId: z.string(),
      recoveryEpoch: z.number().int(),
    }).parse(operation.payload);
    const required = {
      language: target.language,
      ...(target.forced === undefined ? {} : { forced: target.forced }),
      hearingImpaired: target.hearingImpaired ?? ("any" as const),
    };
    if (
      target.assetId !== subtitle.assetId ||
      target.recoveryEpoch !== input.epoch ||
      work.protectedReasons.length > 0 ||
      !targetRequired(work, required) ||
      (target.targetAuthority !== undefined &&
        target.targetAuthority !== work.authority) ||
      !subtitleAccepted({
        subtitle,
        asset: work.asset,
        epoch: input.epoch,
        target: required,
        allowStaged: true,
      })
    )
      throw new FileGuardError("subtitle_target_changed");
  }
  return work;
}

/** Bind new extractions to the actual queued target only when installation commits. */
export async function installedEmbeddedEvidence(
  tx: Prisma.TransactionClient,
  input: { operationId: string; subtitleId: string; epoch: number },
  work: Awaited<ReturnType<typeof currentSubtitleWork>>,
) {
  const subtitle = work.asset.subtitles.find(
    (row) => row.id === input.subtitleId,
  );
  if (subtitle === undefined) throw new FileGuardError("subtitle_obsolete");
  const original = z
    .record(z.string(), z.json())
    .parse(subtitle.matchingEvidence);
  if (!reusableEmbeddedSubtitle(subtitle, work.asset)) return original;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const { assetId, recoveryEpoch, targetAuthority, ...target } =
    SubtitleWorkSchema.extend({
      assetId: z.uuid(),
      recoveryEpoch: z.int(),
      targetAuthority: z.literal(work.authority),
    }).parse(operation.payload);
  if (
    operation.kind !== "acquire_subtitles" ||
    operation.targetId !== subtitle.assetId ||
    assetId !== subtitle.assetId ||
    recoveryEpoch !== input.epoch
  )
    throw new FileGuardError("subtitle_target_changed");
  return {
    ...original,
    targetAuthority,
    target,
  };
}
