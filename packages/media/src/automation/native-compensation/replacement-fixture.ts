import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { nativeStorageFixture } from "#automation/native-recovery/test-fixture.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";

/** Actual upload, read-only preparation and explicit no-effect abandonment after native ownership. */
export async function abandonNativeReplacement(
  db: Database,
  cipher: CredentialCipher,
  setup: Awaited<ReturnType<typeof nativeStorageFixture>>,
) {
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: setup.asset.id },
  });
  const old = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: setup.subtitle.id },
  });
  const uploaded = await new PrismaAdminApplication(db, cipher).uploadSubtitle(
    setup.prior.actor,
    crypto.randomUUID(),
    {
      assetId: asset.id,
      expectedAssetVersion: asset.version,
      expectedChecksum: z.string().parse(asset.checksum),
      language: "en",
      filename: "replacement.srt",
      description: "Owner reviewed alternative caption candidate",
      contentBase64: Buffer.from(
        "1\n00:00:00,000 --> 00:00:01,000\nAlternative caption\n",
      ).toString("base64"),
      declaredEncoding: "utf8",
      confirmedMatchingVideo: true,
      forced: false,
      hearingImpaired: false,
      replacementFor: {
        oldSubtitleId: old.id,
        expectedOldVersion: old.version,
      },
    },
  );
  const candidateId = z.uuid().parse(uploaded.subtitleId);
  const candidate = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: candidateId },
  });
  const service = new PrismaSubtitleReplacements(db, () =>
    Promise.resolve({ runId: crypto.randomUUID(), status: "COMPLETED" }),
  );
  const command = await service.prepare(
    setup.prior.actor,
    crypto.randomUUID(),
    {
      oldSubtitleId: old.id,
      candidateSubtitleId: candidate.id,
      expectedOldVersion: old.version,
      expectedCandidateVersion: candidate.version,
    },
  );
  const replacementId = z.uuid().parse(command.subtitleReplacementId);
  const activities = createSubtitleReplacementActivities(setup.file.context);
  const prepared = await activities.prepareSubtitleReplacement({
    replacementId,
    operationId: z.uuid().parse(command.operationId),
  });
  if (prepared.state !== "ready")
    throw new Error(
      `Native replacement preparation protected: ${JSON.stringify(prepared)}`,
    );
  const reviewed = await db.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
  });
  const reconcile = await service.reconcile(
    setup.prior.actor,
    crypto.randomUUID(),
    replacementId,
    { expectedVersion: reviewed.version },
  );
  const result = await activities.reconcileSubtitleReplacement({
    replacementId,
    operationId: z.uuid().parse(reconcile.operationId),
  });
  if (result.state !== "rolled_back")
    throw new Error(
      `Native replacement abandonment protected: ${JSON.stringify(result)}`,
    );
  const receipt = await db.subtitleReplacementReceipt.findUniqueOrThrow({
    where: { replacementId },
  });
  if (receipt.outcome !== "abandoned")
    throw new Error("Native candidate did not settle without effects");
  return {
    receipt,
    candidate: await db.subtitleAsset.findUniqueOrThrow({
      where: { id: candidateId },
    }),
  };
}
