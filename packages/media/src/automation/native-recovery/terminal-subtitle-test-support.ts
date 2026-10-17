import path from "node:path";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect } from "vitest";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";
import { settleTerminalPublication } from "./terminal-test-support.ts";
import type { fileFixture } from "#automation/files/test-support.ts";

type Fixture = Awaited<ReturnType<typeof fileFixture>>;
type Published = Awaited<ReturnType<Fixture["published"]>>;

export function settleReplacedRollback(
  db: Database,
  cipher: CredentialCipher,
  cleanup = false,
) {
  return async (file: Fixture, original: Published) => {
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: original.entry.assetId },
    });
    const owner = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Caption owner",
        role: "owner",
      },
    });
    await db.mediaRequest.update({
      where: { id: file.request.id },
      data: { subtitleLanguages: ["en"] },
    });
    const filename = asset.path.replace(/\.[^.]+$/u, ".en.forced.srt");
    const content = "1\n00:00:01,000 --> 00:00:03,000\nOriginal captions.\n";
    await writeFile(filename, content);
    const subtitle = await db.subtitleAsset.create({
      data: {
        assetId: asset.id,
        language: "en",
        providerId: "legacy",
        state: "installed",
        qualityStatus: "accepted",
        storageKind: "sidecar",
        ownershipEpoch: 0,
        videoChecksum: asset.checksum,
        videoVersion: asset.version,
        path: filename,
        checksum: createHash("sha256").update(content).digest("hex"),
        forced: true,
        hearingImpaired: false,
        provenance: { fixture: "verified original captions" },
        matchingEvidence: {},
      },
    });
    const settled = await settleTerminalPublication(
      db,
      "cancelled",
      async () => {
        const current = await db.libraryAsset.findUniqueOrThrow({
          where: { id: asset.id },
        });
        const old = await db.subtitleAsset.findUniqueOrThrow({
          where: { id: subtitle.id },
        });
        const uploaded = await new PrismaAdminApplication(
          db,
          cipher,
        ).uploadSubtitle(owner, crypto.randomUUID(), {
          assetId: asset.id,
          expectedAssetVersion: current.version,
          expectedChecksum: z.string().parse(current.checksum),
          language: "en",
          filename: "replacement.srt",
          description: "Owner verified corrected captions",
          contentBase64: Buffer.from(
            "1\n00:00:01,000 --> 00:00:03,000\nCorrected captions.\n",
          ).toString("base64"),
          declaredEncoding: "utf8",
          confirmedMatchingVideo: true,
          forced: true,
          hearingImpaired: false,
          replacementFor: {
            oldSubtitleId: old.id,
            expectedOldVersion: old.version,
          },
        });
        const candidate = await db.subtitleAsset.findUniqueOrThrow({
          where: { id: z.uuid().parse(uploaded.subtitleId) },
        });
        const service = new PrismaSubtitleReplacements(db, () =>
          Promise.resolve({ runId: crypto.randomUUID(), status: "COMPLETED" }),
        );
        const prepared = await service.prepare(owner, crypto.randomUUID(), {
          oldSubtitleId: old.id,
          candidateSubtitleId: candidate.id,
          expectedOldVersion: old.version,
          expectedCandidateVersion: candidate.version,
        });
        const activities = createSubtitleReplacementActivities(file.context);
        const replacementId = z.uuid().parse(prepared.subtitleReplacementId);
        expect(
          await activities.prepareSubtitleReplacement({
            replacementId,
            operationId: z.uuid().parse(prepared.operationId),
          }),
        ).toEqual({ state: "ready" });
        const row = await db.subtitleReplacement.findUniqueOrThrow({
          where: { id: replacementId },
          include: { review: true },
        });
        const approved = await service.apply(
          owner,
          crypto.randomUUID(),
          row.id,
          {
            expectedVersion: row.version,
            observationHash: z.string().parse(row.review?.observationHash),
            acknowledgeReplacement: true,
          },
        );
        expect(
          await activities.applySubtitleReplacement({
            replacementId,
            operationId: z.uuid().parse(approved.operationId),
          }),
        ).toEqual({ state: "applied" });
        expect(
          await db.subtitleReplacementReceipt.findUniqueOrThrow({
            where: { replacementId },
          }),
        ).toMatchObject({ outcome: "installed" });
        if (cleanup) {
          file.advance(8 * 86_400_000);
          const operation = await db.operation.create({
            data: {
              kind: "cleanup_subtitle_replacement",
              targetId: replacementId,
              payload: { replacementId },
            },
          });
          expect(
            await activities.cleanupSubtitleReplacement({
              replacementId,
              operationId: operation.id,
            }),
          ).toEqual({ state: "cleaned" });
        }
      },
    )(file, original);
    // Match the production canonical mounts; the immutable receipts and real journals retain
    // their original exact temporary paths and are checked through the trusted test mapping.
    for (const row of await db.subtitleAsset.findMany({
      where: { assetId: asset.id, path: { not: null } },
    })) {
      const oldPath = z.string().parse(row.path);
      const control = path.relative(file.roots.control, oldPath);
      const canonical = control.startsWith("..")
        ? path.join("/data/movies", path.relative(file.roots.library, oldPath))
        : path.join("/data/movies/.media-control", control);
      await db.subtitleAsset.update({
        where: { id: row.id },
        data: { path: canonical },
      });
    }
    return settled;
  };
}
