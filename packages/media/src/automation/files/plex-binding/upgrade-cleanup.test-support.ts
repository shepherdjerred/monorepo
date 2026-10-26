import { expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import nodePath from "node:path";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import {
  plexBindingFixture,
  bindingTestExecution,
} from "#automation/plex-binding/test-fixture.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { elapsedPublicationClient } from "./elapsed-publication.test-support.ts";
import { storedWorkerPath } from "#automation/files/paths/locations.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";

export async function upgradeCleanupFixture(
  db: Database,
  baseContext: MediaAutomationContext,
  options: {
    elapsed?: boolean;
    observe?: boolean;
    directoryCreated: (directory: string) => void;
  },
) {
  const elapsed = options.elapsed ?? true;
  const base = await plexBindingFixture(db, baseContext, {
    publicationPending: true,
  });
  const f = base.files;
  options.directoryCreated(f.directory);
  const original = base.published;
  const originalPublisher = createPublicationActivities(base.context);
  expect(await originalPublisher.publishMediaToPlex(original.input)).toEqual({
    status: "available",
    reason: null,
  });
  await originalPublisher.finalizeMediaAcquisition(original.input);
  const subtitlePath = nodePath.join(
    f.roots.library,
    `${original.entry.libraryPath}.en.srt`,
  );
  const subtitle = "1\n00:00:01,000 --> 00:00:03,000\nFixture caption\n";
  await writeFile(subtitlePath, subtitle);
  await db.subtitleAsset.create({
    data: {
      assetId: original.entry.assetId,
      language: "en",
      state: "installed",
      ownershipEpoch: 0,
      storageKind: "sidecar",
      qualityStatus: "unverified",
      checksum: createHash("sha256").update(subtitle).digest("hex"),
      videoChecksum: original.entry.checksum,
      videoVersion: 0,
      providerId: "fixture",
      path: storedWorkerPath(f.context, "movies", subtitlePath),
      matchingEvidence: {},
      provenance: {
        checksum: createHash("sha256").update(subtitle).digest("hex"),
      },
    },
  });
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Inspector missing");
  f.context.inspect = async (path) => {
    const probe = await inspect(path);
    return {
      ...probe,
      streams: probe.streams.map((stream) =>
        stream.codec_type === "video"
          ? { ...stream, width: 3840, height: 1600 }
          : stream,
      ),
    };
  };
  const acquired = await f.acquisition("Verified upgraded video contents");
  const activities = createMediaFileActivities(f.context);
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
  if (entry === undefined) throw new Error("Plan missing");
  expect(
    await db.upgradeCleanup.count({
      where: { assetId: original.entry.assetId },
    }),
  ).toBe(0);
  const transport = await retentionPlexContext(
    db,
    baseContext,
    attempt.mediaIds,
  );
  const network = {
    ...transport.context,
    plexBindingExecution: bindingTestExecution,
  };
  const timing = elapsed
    ? await elapsedPublicationClient(db, entry.assetId)
    : null;
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: attempt.id },
  });
  expect(
    await createPublicationActivities({
      ...network,
      db: timing?.db ?? db,
    }).publishMediaToPlex(acquired.input),
  ).toEqual({ status: "available", reason: null });
  await timing?.assertWritten();
  await createPublicationActivities(network).finalizeMediaAcquisition(
    acquired.input,
  );
  const finalizedAttempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  expect(finalizedAttempt.filePlan).toEqual(attempt.filePlan);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: attempt.id },
    }),
  ).toEqual(transition);
  const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: original.entry.assetId,
        successorAssetId: entry.assetId,
      },
    },
  });
  const old = await db.libraryAsset.findUniqueOrThrow({
    where: { id: original.entry.assetId },
    include: { subtitles: true },
  });
  const operation = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `upgrade-cleanup:${cleanup.id}` },
  });
  const input = { cleanupId: cleanup.id, operationId: operation.id };
  if (elapsed && options.observe !== false)
    expect(
      await observeMediaUpgradeCleanup(network, input, bindingTestExecution()),
    ).toEqual({ status: "observed" });
  return {
    ...f,
    original,
    acquired,
    entry,
    old,
    cleanup,
    activities,
    input,
    network,
    transport,
    timing,
  };
}
