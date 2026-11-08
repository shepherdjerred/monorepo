import { afterAll } from "vitest";
import { createHash } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import { createSubtitleReplacementActivities } from "./activities.ts";
import { replacementPaths } from "./files.ts";

export function replacementHarness() {
  const harness = automationTestHarness();
  const directories: string[] = [];
  afterAll(async () => {
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  });
  async function setup(
    quality: "accepted" | "unverified" | "rejected" = "unverified",
    fileFactory: typeof fileFixture = fileFixture,
    publicationPending = false,
  ) {
    const db = harness.database();
    const f = await fileFactory(db);
    directories.push(f.directory);
    const published = publicationPending
      ? await preparePhysicalPublication(f)
      : await f.published();
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
      where: { id: f.request.id },
      data: { subtitleLanguages: ["en"] },
    });
    const oldText = "1\n00:00:01,000 --> 00:00:03,000\nOriginal dialogue.\n";
    const newText = "1\n00:00:01,000 --> 00:00:03,000\nCorrected dialogue.\n";
    const filename = subtitleDestination({
      videoPath: asset.path,
      language: "en",
      forced: false,
      hearingImpaired: false,
      format: "srt",
    });
    const workerFilename = workerFilePath(f.context, filename);
    await writeFile(workerFilename, oldText);
    const checksum = createHash("sha256").update(oldText).digest("hex");
    const old = await db.subtitleAsset.create({
      data: {
        assetId: asset.id,
        language: "en",
        providerId: "legacy",
        state: "installed",
        qualityStatus: quality,
        storageKind: "sidecar",
        ownershipEpoch: 0,
        videoChecksum: asset.checksum,
        videoVersion: asset.version,
        path: filename,
        checksum,
        forced: false,
        hearingImpaired: false,
        provenance: { format: "srt", checksum, fixture: "preserve" },
        matchingEvidence: { originalQuality: quality },
      },
    });
    const uploaded = await new PrismaAdminApplication(
      db,
      harness.cipher,
    ).uploadSubtitle(owner, crypto.randomUUID(), {
      assetId: asset.id,
      expectedAssetVersion: asset.version,
      expectedChecksum: z.string().parse(asset.checksum),
      language: "en",
      filename: "replacement.srt",
      description: "Owner verified human captions",
      contentBase64: Buffer.from(newText).toString("base64"),
      declaredEncoding: "utf8",
      confirmedMatchingVideo: true,
      forced: false,
      hearingImpaired: false,
      replacementFor: {
        oldSubtitleId: old.id,
        expectedOldVersion: old.version,
      },
    });
    const candidateId = z.uuid().parse(uploaded.subtitleId);
    const candidate = await db.subtitleAsset.findUniqueOrThrow({
      where: { id: candidateId },
    });
    const service = new PrismaSubtitleReplacements(db, () =>
      Promise.resolve({ runId: crypto.randomUUID(), status: "COMPLETED" }),
    );
    const prepared = await service.prepare(owner, crypto.randomUUID(), {
      oldSubtitleId: old.id,
      candidateSubtitleId: candidateId,
      expectedOldVersion: old.version,
      expectedCandidateVersion: candidate.version,
    });
    const replacementId = z.uuid().parse(prepared.subtitleReplacementId);
    const activities = () => createSubtitleReplacementActivities(f.context);
    const prepareInput = {
      replacementId,
      operationId: z.uuid().parse(prepared.operationId),
    };
    const row = () =>
      db.subtitleReplacement.findUniqueOrThrow({
        where: { id: replacementId },
        include: { receipt: true, review: true },
      });
    async function approve() {
      const result =
        await activities().prepareSubtitleReplacement(prepareInput);
      if (result.state !== "ready") throw new Error(JSON.stringify(result));
      const reviewed = await row();
      const applied = await service.apply(
        owner,
        crypto.randomUUID(),
        replacementId,
        {
          expectedVersion: reviewed.version,
          observationHash: z.string().parse(reviewed.review?.observationHash),
          acknowledgeReplacement: true,
        },
      );
      return {
        replacementId,
        operationId: z.uuid().parse(applied.operationId),
      };
    }
    async function reconcile(actor = owner) {
      const current = await row();
      const command = await service.reconcile(
        actor,
        crypto.randomUUID(),
        replacementId,
        { expectedVersion: current.version },
      );
      return await activities().reconcileSubtitleReplacement({
        replacementId,
        operationId: z.uuid().parse(command.operationId),
      });
    }
    async function cleanup() {
      const operation = await db.operation.create({
        data: {
          kind: "cleanup_subtitle_replacement",
          targetId: replacementId,
          payload: { replacementId },
        },
      });
      return await activities().cleanupSubtitleReplacement({
        replacementId,
        operationId: operation.id,
      });
    }
    return {
      ...f,
      db,
      owner,
      asset,
      old,
      candidate,
      candidateId,
      oldText,
      newText,
      filename: workerFilename,
      initialPublication: published,
      service,
      replacementId,
      prepareInput,
      row,
      activities,
      approve,
      reconcile,
      cleanup,
      paths: async () => replacementPaths(f.context, await row()),
    };
  }
  return { setup, network: harness.context };
}
