import { expect, test } from "vitest";
import { access, readFile } from "node:fs/promises";
import { z } from "zod";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { replacementHarness } from "./test-fixture.ts";

const harness = replacementHarness();

async function installed() {
  const f = await harness.setup();
  expect(
    await f.activities().applySubtitleReplacement(await f.approve()),
  ).toEqual({ state: "applied" });
  const paths = await f.paths();
  const activities = createMediaFileActivities(f.context);
  return { ...f, paths, files: activities };
}

async function upgrade(f: Awaited<ReturnType<typeof installed>>) {
  await f.db.acquisitionAttempt.updateMany({
    where: { mediaIds: { has: f.media.id } },
    data: { state: "completed" },
  });
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
  await f.db.$transaction(async (tx) => {
    await tx.mediaItem.update({
      where: { id: f.media.id },
      data: { availability: "available" },
    });
    await recordVerifiedPublication(tx, [upgraded.entry.assetId], 0);
    await tx.acquisitionAttempt.update({
      where: { id: upgraded.attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: upgraded.attempt.id },
    });
  });
  const cleanup = await f.db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: f.asset.id,
        successorAssetId: upgraded.entry.assetId,
      },
    },
  });
  f.advance(8 * 86_400_000);
  expect(
    await f.files.cleanupSupersededMediaFile({
      cleanupId: cleanup.id,
      operationId: crypto.randomUUID(),
    }),
  ).toEqual({ status: "purged" });
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.candidateId },
  });
  expect(candidate.state).toBe("purged");
  expect(candidate.provenance).toEqual(f.candidate.provenance);
  await expect(access(z.string().parse(candidate.path))).rejects.toThrow();
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
  expect(await f.cleanup()).toEqual({ state: "cleaned" });
  await expect(access(f.paths.oldArchive)).rejects.toThrow();
});

test("quarantine and purge consume the replacement checksum without changing quality or its independent archive", async () => {
  const f = await installed();
  const retention = await f.retention();
  expect(await f.files.quarantineMediaFiles(retention.input)).toEqual({
    status: "quarantined",
  });
  await expect(access(f.filename)).rejects.toThrow();
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
  f.advance(8 * 86_400_000);
  const timestamp = z.date().parse(f.context.now?.());
  const evidence = z
    .record(z.string(), z.json())
    .parse(retention.decision.evidence);
  await f.db.retentionDecision.update({
    where: { id: retention.decision.id },
    data: { evidence: { ...evidence, authorizedAt: timestamp.toISOString() } },
  });
  await f.db.watchState.update({
    where: {
      userId_mediaId_edition: {
        edition: "default",
        userId: f.user.id,
        mediaId: f.media.id,
      },
    },
    data: { observedAt: timestamp },
  });
  await f.db.notificationDelivery.updateMany({
    where: { userId: f.user.id },
    data: { reconciledAt: timestamp },
  });
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
  expect(await f.cleanup()).toEqual({ state: "cleaned" });
});

test("missing authoritative checksum protects replacement video operations even when provenance contains one", async () => {
  const f = await installed();
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
  const retention = await f.retention();
  expect(await f.files.quarantineMediaFiles(retention.input)).toMatchObject({
    status: "protected",
  });
  expect(await readFile(f.filename, "utf8")).toBe(f.newText);
  expect(await readFile(f.paths.oldArchive, "utf8")).toBe(f.oldText);
});
