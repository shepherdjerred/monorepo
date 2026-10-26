import { z } from "zod";
import { expect } from "vitest";
import type { nativeQuarantineFixture } from "#automation/native-quarantine/test-fixture.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";
import type { CredentialCipher } from "#application/security.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";

/** Actual mapped file consumers keep canonical DB paths and worker journal paths distinct. */
export async function replaceRecoveredSidecar(
  f: Awaited<ReturnType<typeof nativeQuarantineFixture>>,
  cipher: CredentialCipher,
) {
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  const subtitles = await f.db.subtitleAsset.findMany({
    where: { assetId: asset.id, state: "installed" },
  });
  const old = subtitles.find((row) => row.id === f.subtitle.id);
  if (old === undefined) throw new Error("Original sidecar missing");
  const uploaded = await new PrismaAdminApplication(
    f.db,
    cipher,
  ).uploadSubtitle(f.prior.actor, crypto.randomUUID(), {
    assetId: asset.id,
    expectedAssetVersion: asset.version,
    expectedChecksum: z.string().parse(asset.checksum),
    language: z.enum(["en", "zh-Hans"]).parse(old.language),
    filename: "recovered.srt",
    description: "Verified corrected captions",
    contentBase64: Buffer.from(
      "1\n00:00:00,000 --> 00:00:01,000\nCorrected recovered captions\n",
    ).toString("base64"),
    declaredEncoding: "utf8",
    confirmedMatchingVideo: true,
    forced: z.boolean().parse(old.forced),
    hearingImpaired: z.boolean().parse(old.hearingImpaired),
    replacementFor: { oldSubtitleId: old.id, expectedOldVersion: old.version },
  });
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(uploaded.subtitleId) },
  });
  const service = new PrismaSubtitleReplacements(f.db, () =>
    Promise.resolve({ runId: crypto.randomUUID(), status: "COMPLETED" }),
  );
  const command = await service.prepare(f.prior.actor, crypto.randomUUID(), {
    oldSubtitleId: old.id,
    candidateSubtitleId: candidate.id,
    expectedOldVersion: old.version,
    expectedCandidateVersion: candidate.version,
  });
  const replacementId = z.uuid().parse(command.subtitleReplacementId);
  const activities = createSubtitleReplacementActivities(f.context.files);
  expect(
    await activities.prepareSubtitleReplacement({
      replacementId,
      operationId: z.uuid().parse(command.operationId),
    }),
  ).toEqual({ state: "ready" });
  const row = await f.db.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { review: true },
  });
  const approved = await service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    replacementId,
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
  return replacementId;
}

export async function addRecoveredSidecar(
  f: Awaited<ReturnType<typeof nativeQuarantineFixture>>,
  cipher: CredentialCipher,
) {
  await grantTestRequesterAccess(
    f.db,
    f.file.user.id,
    f.observerContext.expectedServerMachineId,
  );
  await new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: f.observerContext.expectedServerMachineId,
  }).createRequest(f.file.user, crypto.randomUUID(), {
    mediaId: f.file.media.id,
    subtitleLanguages: ["en"],
    includeSpecials: false,
  });
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  const uploaded = await new PrismaAdminApplication(
    f.db,
    cipher,
  ).uploadSubtitle(f.prior.actor, crypto.randomUUID(), {
    assetId: asset.id,
    expectedAssetVersion: asset.version,
    expectedChecksum: z.string().parse(asset.checksum),
    language: "en",
    filename: "additional.srt",
    description: "Owner verified English forced captions",
    contentBase64: Buffer.from(
      "1\n00:00:00,000 --> 00:00:01,000\nAdditional forced English captions\n",
    ).toString("base64"),
    declaredEncoding: "utf8",
    confirmedMatchingVideo: true,
    forced: true,
    hearingImpaired: false,
  });
  const operationId = z.uuid().parse(uploaded.operationId);
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const { subtitleId } = z
    .object({ subtitleId: z.uuid() })
    .parse(operation.payload);
  await createMediaFileActivities(f.context.files).installMediaSubtitles({
    subtitleId,
    operationId,
  });
  return {
    subtitleId,
    operationId,
    subtitle: await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: subtitleId },
    }),
  };
}
