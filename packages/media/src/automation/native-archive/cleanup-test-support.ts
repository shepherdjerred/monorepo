import { z } from "zod";
import { rm } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { observeArchiveCleanup } from "./fixtures/observe.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { nativeArchiveFixture } from "./test-fixture.ts";
import { createNativeArchiveFileActivities } from "./activities.ts";

export async function readyArchiveCleanup(
  db: Database,
  cipher: CredentialCipher,
  options: { publicationAgeDays?: number; observe?: boolean } = {},
) {
  const f = await nativeArchiveFixture(db, cipher, {
    chain: 2,
    publicationAgeDays: options.publicationAgeDays ?? 8,
    withArchiveSubtitles: true,
  });
  try {
    await f.prepare();
    await f.apply();
    await db.recoveryHold.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { releasedAt: new Date(), releasedById: f.prior.actor.id },
    });
    await db.mediaIntent.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { automationEpoch: f.runtime.recoveryEpoch, desiredPresence: true },
    });
    const row = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
      where: { originalCleanupId: f.first.id },
    });
    const operationId = await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: row.id,
        expectedVersion: row.version,
      }),
    );
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(operationId) },
    });
    const input = CleanupNativeArchiveInputSchema.parse(operation.payload);
    const observeCleanup = () =>
      observeArchiveCleanup(f.observerContext, input);
    if (options.observe !== false) await observeCleanup();
    return {
      ...f,
      db,
      continuation: row,
      input,
      observeCleanup,
      activities: createNativeArchiveFileActivities(f.context, f.execution),
    };
  } catch (error) {
    await rm(f.file.directory, { recursive: true, force: true });
    throw error;
  }
}
