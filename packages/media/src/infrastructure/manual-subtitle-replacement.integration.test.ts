import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { writeFile, readFile, rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { PrismaAdminApplication } from "./admin-service.ts";
import type { ManualSubtitle } from "#shared/admin.ts";
import { PrismaSubtitleReplacements } from "./subtitle-replacement/service.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const path of directories)
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const db = harness.database();
  const file = await mappedPublicationFixture(db);
  directories.push(file.directory);
  const published = await preparePhysicalPublication(file);
  const bound = await prepareBoundRetention(file, published, harness.context());
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: published.entry.assetId },
  });
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  await db.mediaRequest.update({
    where: { id: file.request.id },
    data: { subtitleLanguages: ["en"] },
  });
  const oldText = "1\n00:00:01,000 --> 00:00:03,000\nOriginal dialogue.\n";
  const path = subtitleDestination({
    videoPath: asset.path,
    language: "en",
    forced: false,
    hearingImpaired: false,
    format: "srt",
  });
  await writeFile(workerFilePath(file.context, path), oldText);
  const old = await db.subtitleAsset.create({
    data: {
      assetId: asset.id,
      language: "en",
      providerId: "legacy",
      state: "installed",
      qualityStatus: "unverified",
      storageKind: "sidecar",
      ownershipEpoch: 0,
      videoChecksum: asset.checksum,
      videoVersion: asset.version,
      path,
      checksum: createHash("sha256").update(oldText).digest("hex"),
      forced: false,
      hearingImpaired: false,
      provenance: {
        format: "srt",
        checksum: createHash("sha256").update(oldText).digest("hex"),
      },
      matchingEvidence: {},
    },
  });
  const input: ManualSubtitle = {
    assetId: asset.id,
    expectedAssetVersion: asset.version,
    expectedChecksum: published.entry.checksum,
    language: "en",
    filename: "replacement.srt",
    description: "Owner checked human translation against exact video",
    contentBase64: Buffer.from(
      "1\n00:00:01,000 --> 00:00:03,000\nCorrected dialogue.\n",
    ).toString("base64"),
    declaredEncoding: "utf8",
    confirmedMatchingVideo: true,
    forced: false,
    hearingImpaired: false,
    replacementFor: { oldSubtitleId: old.id, expectedOldVersion: old.version },
  };
  return {
    db,
    file,
    retention: bound.retention,
    asset,
    old,
    owner,
    input,
    oldText,
    admin: new PrismaAdminApplication(db, harness.cipher),
  };
}

test("manual replacement validates distinct bytes without changing the installed file or queuing installation", async () => {
  const f = await fixture();
  const before = await f.db.outboxCommand.count();
  const result = await f.admin.uploadSubtitle(
    f.owner,
    "manual-replacement",
    f.input,
  );
  expect(result.subtitleId).toBeDefined();
  if (result.subtitleId === undefined)
    throw new Error("Missing replacement candidate");
  expect(
    await f.admin.uploadSubtitle(f.owner, "manual-replacement", f.input),
  ).toEqual(result);
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: result.subtitleId },
  });
  expect(candidate).toMatchObject({
    state: "validated",
    qualityStatus: "accepted",
    ownershipEpoch: 0,
    videoVersion: f.asset.version,
    path: null,
  });
  expect(candidate.matchingEvidence).toMatchObject({
    replacementFor: {
      oldSubtitleId: f.old.id,
      expectedOldVersion: f.old.version,
    },
  });
  expect(await f.db.outboxCommand.count()).toBe(before);
  expect(
    await readFile(
      workerFilePath(f.file.context, f.old.path ?? "missing"),
      "utf8",
    ),
  ).toBe(f.oldText);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
  ).toEqual(f.old);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
});

test("manual replacement rejects stale, cross-epoch, same-byte and different-destination candidates", async () => {
  const f = await fixture();
  const count = await f.db.subtitleAsset.count();
  await expect(
    f.admin.uploadSubtitle(f.owner, crypto.randomUUID(), {
      ...f.input,
      replacementFor: { oldSubtitleId: f.old.id, expectedOldVersion: 99 },
    }),
  ).rejects.toMatchObject({ code: "replacement_target_changed" });
  await expect(
    f.admin.uploadSubtitle(f.owner, crypto.randomUUID(), {
      ...f.input,
      contentBase64: Buffer.from(f.oldText).toString("base64"),
    }),
  ).rejects.toMatchObject({ code: "replacement_same_bytes" });
  await expect(
    f.admin.uploadSubtitle(f.owner, crypto.randomUUID(), {
      ...f.input,
      forced: true,
    }),
  ).rejects.toMatchObject({ code: "replacement_path_changed" });
  await f.db.subtitleAsset.update({
    where: { id: f.old.id },
    data: { ownershipEpoch: -1 },
  });
  await expect(
    f.admin.uploadSubtitle(f.owner, crypto.randomUUID(), f.input),
  ).rejects.toMatchObject({ code: "replacement_target_changed" });
  expect(await f.db.subtitleAsset.count()).toBe(count);
  expect(
    await readFile(
      workerFilePath(f.file.context, f.old.path ?? "missing"),
      "utf8",
    ),
  ).toBe(f.oldText);
});

test("manual replacement fails closed when current demand or owner authorization disappears", async () => {
  const f = await fixture();
  await f.db.mediaRequest.update({
    where: { id: f.file.request.id },
    data: { subtitleLanguages: [] },
  });
  await expect(
    f.admin.uploadSubtitle(f.owner, crypto.randomUUID(), f.input),
  ).rejects.toMatchObject({ code: "replacement_target_unrequested" });
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { restricted: true },
  });
  await expect(
    f.admin.uploadSubtitle(f.owner, crypto.randomUUID(), f.input),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await f.db.subtitleAsset.count({ where: { assetId: f.asset.id } }),
  ).toBe(1);
});

test("a prepared manual replacement reserves the video against quarantine and another upload", async () => {
  const f = await fixture();
  const uploaded = await f.admin.uploadSubtitle(
    f.owner,
    crypto.randomUUID(),
    f.input,
  );
  if (uploaded.subtitleId === undefined) throw new Error("Missing candidate");
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: uploaded.subtitleId },
  });
  const service = new PrismaSubtitleReplacements(f.db, async () => ({
    runId: crypto.randomUUID(),
    status: "COMPLETED",
  }));
  const prepared = await service.prepare(f.owner, crypto.randomUUID(), {
    oldSubtitleId: f.old.id,
    candidateSubtitleId: candidate.id,
    expectedOldVersion: f.old.version,
    expectedCandidateVersion: candidate.version,
  });
  expect(prepared.subtitleReplacementId).toBeDefined();
  const retention = f.retention;
  const verified = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(verified).toEqual({ ...f.asset, plexPublishedAt: expect.any(Date) });
  expect(
    await createMediaFileActivities(f.file.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toEqual({ status: "protected", reason: "subtitle_replacement_unsettled" });
  await expect(
    f.admin.uploadSubtitle(f.owner, crypto.randomUUID(), f.input),
  ).rejects.toMatchObject({ code: "subtitle_replacement_unsettled" });
  expect(
    await readFile(
      workerFilePath(f.file.context, f.old.path ?? "missing"),
      "utf8",
    ),
  ).toBe(f.oldText);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(verified);
});
