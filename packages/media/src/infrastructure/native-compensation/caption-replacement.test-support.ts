import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { compensatedCaptionFixture } from "./caption.test-support.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";

/** Actual reviewed replacement of a caption in the immutable compensation completion. */
export async function replaceCompensatedCaption(
  db: Database,
  network: MediaAutomationContext,
  fixture: Awaited<ReturnType<typeof compensatedCaptionFixture>>,
) {
  const { f } = fixture;
  for (const mediaId of f.published.entry.mediaIds)
    await new MediaRequestCommands(db, {
      keepDays: 7,
      serverMachineId: "server",
    }).createRequest(f.prior.actor, crypto.randomUUID(), {
      mediaId,
      subtitleLanguages: ["en"],
      includeSpecials: false,
    });
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  const old = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.subtitle.id },
  });
  const uploaded = await new PrismaAdminApplication(
    db,
    network.cipher,
  ).uploadSubtitle(f.prior.actor, crypto.randomUUID(), {
    assetId: asset.id,
    expectedAssetVersion: asset.version,
    expectedChecksum: z.string().parse(asset.checksum),
    language: "en",
    filename: "replacement.srt",
    description: "Reviewed replacement of compensated caption",
    contentBase64: Buffer.from(
      "1\n00:00:00,000 --> 00:00:01,000\nCorrected original dialogue\n",
    ).toString("base64"),
    declaredEncoding: "utf8",
    confirmedMatchingVideo: true,
    forced: false,
    hearingImpaired: false,
    replacementFor: { oldSubtitleId: old.id, expectedOldVersion: old.version },
  });
  const candidate = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(uploaded.subtitleId) },
  });
  const service = new PrismaSubtitleReplacements(db, () =>
    Promise.resolve({ runId: crypto.randomUUID(), status: "COMPLETED" }),
  );
  const command = await service.prepare(f.prior.actor, crypto.randomUUID(), {
    oldSubtitleId: old.id,
    candidateSubtitleId: candidate.id,
    expectedOldVersion: old.version,
    expectedCandidateVersion: candidate.version,
  });
  const replacementId = z.uuid().parse(command.subtitleReplacementId);
  const activities = createSubtitleReplacementActivities(f.file.context);
  const prepared = await activities.prepareSubtitleReplacement({
    replacementId,
    operationId: z.uuid().parse(command.operationId),
  });
  if (prepared.state !== "ready")
    throw new Error(
      `Actual replacement preparation protected: ${JSON.stringify(prepared)}`,
    );
  const review = await db.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { review: true },
  });
  const approved = await service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    replacementId,
    {
      expectedVersion: review.version,
      observationHash: z.string().parse(review.review?.observationHash),
      acknowledgeReplacement: true,
    },
  );
  const result = await activities.applySubtitleReplacement({
    replacementId,
    operationId: z.uuid().parse(approved.operationId),
  });
  if (result.state !== "applied")
    throw new Error(
      `Actual caption replacement protected: ${JSON.stringify(result)}`,
    );
  return db.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { receipt: true },
  });
}
