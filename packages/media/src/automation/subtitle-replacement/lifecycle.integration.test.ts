import { expect, test } from "vitest";
import { access, readFile } from "node:fs/promises";
import { z } from "zod";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { elapsedQuarantineClient } from "#automation/files/plex-binding/elapsed-quarantine.test-support.ts";
import { elapsedPublicationClient } from "#automation/files/plex-binding/elapsed-publication.test-support.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { replacementHarness } from "./test-fixture.ts";

const harness = replacementHarness();

async function installed() {
  const f = await harness.setup("unverified", mappedPublicationFixture, true);
  expect(
    await f.activities().applySubtitleReplacement(await f.approve()),
  ).toEqual({ state: "applied" });
  const paths = await f.paths();
  const activities = createMediaFileActivities(f.context);
  return { ...f, paths, files: activities };
}

async function upgrade(f: Awaited<ReturnType<typeof installed>>) {
  const transport = await retentionPlexContext(f.db, harness.network(), [
    f.media.id,
  ]);
  const publisher = createPublicationActivities({
    ...transport.context,
    plexBindingExecution: bindingTestExecution,
  });
  expect(
    await publisher.publishMediaToPlex(f.initialPublication.input),
  ).toEqual({ status: "available" });
  await publisher.finalizeMediaAcquisition(f.initialPublication.input);
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Inspector missing");
  f.context.inspect = async (filename) => {
    const probe = await inspect(filename);
    return {
      ...probe,
      streams: probe.streams.map((stream) =>
        stream.codec_type === "video"
          ? { ...stream, width: 3840, height: 1600 }
          : stream,
      ),
    };
  };
  const acquired = await f.acquisition("Replacement lifecycle upgraded video");
  expect(await f.files.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await f.files.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Upgrade plan missing");
  return { ...acquired, entry };
}

test("completed replacement survives actual video upgrade and rollback without moving its old archive", async () => {
  const f = await installed();
  const upgraded = await upgrade(f);
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
  await expect(access(f.filename)).rejects.toThrow();
  const rollback = { ...upgraded.input, operationId: crypto.randomUUID() };
  expect(await f.files.rollbackMediaPromotion(rollback)).toEqual({
    status: "rolled_back",
  });
  expect(await readFile(f.filename, "utf8")).toBe(f.newText);
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.candidateId },
  });
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(subtitleAccepted({ subtitle: candidate, asset, epoch: 0 })).toBe(true);
  expect(candidate.provenance).toEqual(f.candidate.provenance);
  expect(candidate.matchingEvidence).toEqual(f.candidate.matchingEvidence);
  f.advance(8 * 86_400_000);
  expect(await f.cleanup()).toEqual({ state: "cleaned" });
  expect(await readFile(f.filename, "utf8")).toBe(f.newText);
  await expect(access(f.paths.oldArchive)).rejects.toThrow();
});

test("verified video expiry removes only its current subtitle and leaves replacement archive to its own receipt", async () => {
  const f = await installed();
  const upgraded = await upgrade(f);
  const transport = await retentionPlexContext(f.db, harness.network(), [
    f.media.id,
  ]);
  const network = {
    ...transport.context,
    plexBindingExecution: bindingTestExecution,
  };
  const timing = await elapsedPublicationClient(f.db, upgraded.entry.assetId);
  expect(
    await createPublicationActivities({
      ...network,
      db: timing.db,
    }).publishMediaToPlex(upgraded.input),
  ).toEqual({ status: "available" });
  await timing.assertWritten();
  await createPublicationActivities(network).finalizeMediaAcquisition(
    upgraded.input,
  );
  const cleanup = await f.db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: f.asset.id,
        successorAssetId: upgraded.entry.assetId,
      },
    },
  });
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `upgrade-cleanup:${cleanup.id}` },
  });
  const input = { cleanupId: cleanup.id, operationId: operation.id };
  expect(
    await observeMediaUpgradeCleanup(network, input, bindingTestExecution()),
  ).toEqual({ status: "observed" });
  expect(await f.files.cleanupSupersededMediaFile(input)).toEqual({
    status: "purged",
  });
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.candidateId },
  });
  expect(candidate.state).toBe("purged");
  expect(candidate.provenance).toEqual(f.candidate.provenance);
  await expect(
    access(workerFilePath(f.context, z.string().parse(candidate.path))),
  ).rejects.toThrow();
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
  f.advance(8 * 86_400_000);
  expect(await f.cleanup()).toEqual({ state: "cleaned" });
  await expect(access(f.paths.oldArchive)).rejects.toThrow();
});

test("quarantine and purge consume the replacement checksum without changing quality or its independent archive", async () => {
  const f = await installed();
  const bound = await prepareBoundRetention(
    f,
    f.initialPublication,
    harness.network(),
  );
  const timing = await elapsedQuarantineClient(f.db, {
    ...bound.retention.input,
    mediaIds: [f.media.id],
  });
  f.context.db = timing.db;
  try {
    expect(await bound.quarantine()).toEqual({ status: "quarantined" });
  } finally {
    f.context.db = f.db;
  }
  const birth = await timing.assertCommitted();
  await expect(access(f.filename)).rejects.toThrow();
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
  await bound.observe(true);
  expect(await bound.refresh()).toMatchObject({ status: "purge" });
  const retention = bound.retention;
  expect(await f.files.purgeMediaFiles(retention.input)).toEqual({
    status: "purged",
  });
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.candidateId },
    }),
  ).toMatchObject({
    state: "purged",
    qualityStatus: "accepted",
    provenance: f.candidate.provenance,
  });
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
  expect(await timing.assertCommitted()).toEqual(birth);
  f.advance(8 * 86_400_000);
  expect(await f.cleanup()).toEqual({ state: "cleaned" });
});

test("missing authoritative checksum protects replacement video operations even when provenance contains one", async () => {
  const f = await installed();
  const bound = await prepareBoundRetention(
    f,
    f.initialPublication,
    harness.network(),
  );
  await f.db.subtitleAsset.update({
    where: { id: f.candidateId },
    data: {
      checksum: null,
      qualityStatus: "unverified",
      provenance: {
        ...z.record(z.string(), z.json()).parse(f.candidate.provenance),
        checksum: f.old.checksum,
      },
    },
  });
  const retention = bound.retention;
  expect(await f.files.quarantineMediaFiles(retention.input)).toMatchObject({
    status: "protected",
  });
  expect(await readFile(f.filename, "utf8")).toBe(f.newText);
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
});
