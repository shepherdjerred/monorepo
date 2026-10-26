import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { assertDefaultEdition } from "#shared/editions/scope.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { queueCurrentSubtitleTargets } from "#automation/subtitles/queue.ts";
import {
  prepareFinalizationBinding,
  lockFinalizationBinding,
} from "./finalization-binding.ts";

export async function finalize(
  context: MediaAutomationContext,
  attemptId: string,
): Promise<void> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  assertDefaultEdition(attempt.edition);
  const binding = await prepareFinalizationBinding(context, attempt.mediaIds);
  await serializable(context.db, async (tx) => {
    await lockFinalizationBinding(tx, binding);
    if (
      !(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)) ||
      !(await recordsAuthorized(tx, {
        epoch: attempt.recoveryEpoch,
        mediaIds: attempt.mediaIds,
      }))
    )
      throw new Error("Finalization ownership authority changed");
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed ||
      runtime.recoveryEpoch !== attempt.recoveryEpoch
    )
      throw new Error("Finalization recovery epoch changed");
    const media = await tx.mediaItem.findMany({
      where: { id: { in: attempt.mediaIds } },
    });
    if (media.some((item) => item.availability !== "available"))
      throw new Error("Cannot finalize media not verified in Plex");
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: attempt.id, edition: "default" },
    });
    if (attempt.torrentId !== null)
      await queueOperation(tx, {
        key: `seed:${attempt.torrentId}`,
        kind: "maintain_torrent",
        targetId: attempt.torrentId,
        payload: { torrentId: attempt.torrentId },
      });
    const coverages = await tx.assetCoverage.findMany({
      where: {
        mediaId: { in: attempt.mediaIds },
        current: true,
        edition: "default",
      },
    });
    for (const assetId of new Set(coverages.map((item) => item.assetId)))
      await queueCurrentSubtitleTargets(tx, {
        assetId,
        epoch: attempt.recoveryEpoch,
      });
    binding.freshness.assertActive();
  });
}
