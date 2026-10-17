import { expect } from "vitest";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { UpgradeCleanupPlanSchema } from "#automation/files/upgrade-cleanup-plan.ts";

type Fixture = Awaited<ReturnType<typeof fileFixture>>;
type Published = Awaited<ReturnType<Fixture["published"]>>;

export function settleTerminalPublication(
  db: Database,
  kind: "purged" | "cancelled",
  afterRollback?: (file: Fixture, original: Published) => Promise<void>,
) {
  return async (file: Fixture, original: Published): Promise<Published> => {
    await db.acquisitionAttempt.update({
      where: { id: original.attempt.id },
      data: { state: "completed" },
    });
    const inspect = file.context.inspect;
    if (inspect === undefined) throw new Error("Fixture inspector missing");
    file.context.inspect = async (name) => {
      const probe = await inspect(name);
      return {
        ...probe,
        streams: probe.streams.map((stream) =>
          stream.codec_type === "video"
            ? { ...stream, width: 3840, height: 1600 }
            : stream,
        ),
      };
    };
    const acquired = await file.acquisition(
      "Actual upgraded video contents for native recovery",
    );
    const activities = createMediaFileActivities(file.context);
    expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
      status: "staged",
    });
    expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
      status: "published",
    });
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    const entry = FilePlanSchema.parse(attempt.filePlan)[0];
    if (entry === undefined) throw new Error("Upgraded fixture plan missing");
    await db.$transaction(async (tx) => {
      await recordVerifiedPublication(tx, [entry.assetId], 0);
      await tx.mediaItem.update({
        where: { id: file.media.id },
        data: { availability: "available" },
      });
    });
    const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
      where: {
        assetId_successorAssetId: {
          assetId: original.entry.assetId,
          successorAssetId: entry.assetId,
        },
      },
    });
    if (kind === "purged") {
      await db.acquisitionAttempt.update({
        where: { id: attempt.id },
        data: { state: "completed" },
      });
      await db.acquisitionReservation.deleteMany({
        where: { attemptId: attempt.id },
      });
      file.advance(8 * 86_400_000);
      expect(
        await activities.cleanupSupersededMediaFile({
          cleanupId: cleanup.id,
          operationId: crypto.randomUUID(),
        }),
      ).toEqual({ status: "purged" });
    } else {
      expect(await activities.rollbackMediaPromotion(acquired.input)).toEqual({
        status: "rolled_back",
      });
      // The separate Plex readback normally releases this reservation. The fixture's GET
      // adapter below proves the restored file before any native authority is granted.
      await db.acquisitionReservation.deleteMany({
        where: { attemptId: attempt.id },
      });
      file.context.inspect = inspect;
      await afterRollback?.(file, original);
    }
    await canonicalizeHistory(
      db,
      file,
      [original.entry.assetId, entry.assetId],
      cleanup.id,
    );
    return kind === "purged" ? { ...acquired, entry } : original;
  };
}

async function canonicalizeHistory(
  db: Database,
  file: Fixture,
  assetIds: string[],
  cleanupId: string,
) {
  // Production stores canonical mount names. Real effects use disposable local mounts here;
  // only DB mount names change, while exact original filesystem journals remain untouched.
  const canonical = (name: string) =>
    name
      .replace(file.roots.control, "/data/movies/.media-control")
      .replace(file.roots.library, "/data/movies");
  for (const id of assetIds) {
    const asset = await db.libraryAsset.findUniqueOrThrow({ where: { id } });
    await db.libraryAsset.update({
      where: { id },
      data: { path: canonical(asset.path) },
    });
  }
  const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
    where: { id: cleanupId },
  });
  if (cleanup.manifest !== null) {
    const plan = UpgradeCleanupPlanSchema.parse(cleanup.manifest);
    await db.upgradeCleanup.update({
      where: { id: cleanupId },
      data: {
        manifest: z.record(z.string(), z.json()).parse({
          ...plan,
          files: plan.files.map((item) => ({
            ...item,
            path: canonical(item.path),
          })),
        }),
      },
    });
  }
}
