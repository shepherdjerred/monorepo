import { z } from "zod";
import type { readyArchiveCleanup } from "#automation/native-archive/cleanup-test-support.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import type { CredentialCipher } from "#application/security.ts";

export async function reserveArchiveCurrentSubtitle(
  f: Awaited<ReturnType<typeof readyArchiveCleanup>>,
  cipher: CredentialCipher,
) {
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.published.entry.assetId },
  });
  const old = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.subtitle.id },
  });
  const upload = await new PrismaAdminApplication(f.db, cipher).uploadSubtitle(
    f.prior.actor,
    crypto.randomUUID(),
    {
      assetId: asset.id,
      expectedAssetVersion: asset.version,
      expectedChecksum: z.string().parse(asset.checksum),
      language: "en",
      filename: "replacement.srt",
      description: "Reviewed corrected human captions",
      contentBase64: Buffer.from(
        "1\n00:00:01,000 --> 00:00:03,000\nCorrected archive playback dialogue.\n",
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
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(upload.subtitleId) },
  });
  return await new PrismaSubtitleReplacements(f.db, () =>
    Promise.reject(new Error("Unexpected workflow lookup before preparation")),
  ).prepare(f.prior.actor, crypto.randomUUID(), {
    oldSubtitleId: old.id,
    candidateSubtitleId: candidate.id,
    expectedOldVersion: old.version,
    expectedCandidateVersion: candidate.version,
  });
}
