import { expect } from "vitest";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { elapsedPublicationClient } from "#automation/files/plex-binding/elapsed-publication.test-support.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";

type Fixture = Awaited<ReturnType<typeof fileFixture>>;
type Published = Awaited<ReturnType<Fixture["published"]>>;

export function settleTerminalPublication(
  db: Database,
  kind: "purged" | "cancelled",
  options: {
    context: MediaAutomationContext;
    afterRollback?: (file: Fixture, original: Published) => Promise<void>;
  },
) {
  return async (file: Fixture, original: Published): Promise<Published> => {
    const originalTransport = await retentionPlexContext(
      db,
      options.context,
      original.attempt.mediaIds,
    );
    const originalPublisher = createPublicationActivities(
      originalTransport.context,
    );
    expect(await originalPublisher.publishMediaToPlex(original.input)).toEqual({
      status: "available",
      reason: null,
    });
    await originalPublisher.finalizeMediaAcquisition(original.input);
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
    const transport = await retentionPlexContext(
      db,
      options.context,
      attempt.mediaIds,
    );
    const timing =
      kind === "purged"
        ? await elapsedPublicationClient(db, entry.assetId)
        : null;
    const publisher = createPublicationActivities({
      ...transport.context,
      db: timing?.db ?? db,
    });
    expect(await publisher.publishMediaToPlex(acquired.input)).toEqual({
      status: "available",
      reason: null,
    });
    await timing?.assertWritten();
    const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
      where: {
        assetId_successorAssetId: {
          assetId: original.entry.assetId,
          successorAssetId: entry.assetId,
        },
      },
    });
    if (kind === "purged") {
      await createPublicationActivities(
        transport.context,
      ).finalizeMediaAcquisition(acquired.input);
      const operation = await db.operation.findUniqueOrThrow({
        where: { idempotencyKey: `upgrade-cleanup:${cleanup.id}` },
      });
      const input = { cleanupId: cleanup.id, operationId: operation.id };
      expect(
        await observeMediaUpgradeCleanup(
          transport.context,
          input,
          bindingTestExecution(),
        ),
      ).toEqual({ status: "observed" });
      expect(await activities.cleanupSupersededMediaFile(input)).toEqual({
        status: "purged",
      });
    } else {
      expect(await activities.rollbackMediaPromotion(acquired.input)).toEqual({
        status: "rolled_back",
      });
      const rollbackTransport = await retentionPlexContext(
        db,
        options.context,
        attempt.mediaIds,
      );
      expect(
        await createPublicationActivities(
          rollbackTransport.context,
        ).publishRolledBackMedia(acquired.input),
      ).toEqual({
        status: "available",
        reason: null,
      });
      file.context.inspect = inspect;
      await options.afterRollback?.(file, original);
    }
    return kind === "purged" ? { ...acquired, entry } : original;
  };
}
