import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieReplacementCaptionSourceV2 } from "#shared/movie-editions/notifications-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieReplacementReceiptV2 } from "#infrastructure/movie-editions/subtitle-replacement/records.ts";
import { PlexPhysicalGroupSchema } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Caption replacement has its own actual receipt; it never borrows an installation marker. */
export async function readMovieReplacementCaptionNoticeSourceV2(
  tx: Prisma.TransactionClient,
  source: MovieReplacementCaptionSourceV2,
  budget: PublicationAuthorityReadBudget,
) {
  const record = await readMovieReplacementReceiptV2(
    tx,
    source.replacementId,
    budget,
  );
  if (
    record === null ||
    record.row.receipt?.outcome !== "installed" ||
    record.row.assetId !== source.assetId ||
    record.row.candidateSubtitleId !== source.subtitleId ||
    identityHash(record.snapshot.scope) !== identityHash(source.scope)
  )
    throw new Error(
      "Movie replacement readiness lost its actual scoped caption receipt",
    );
  const asset = record.asset;
  if (
    asset.id !== record.snapshot.asset.id ||
    asset.version !== record.snapshot.asset.version ||
    asset.path !== record.snapshot.asset.path ||
    asset.checksum !== record.snapshot.asset.checksum ||
    identityHash(asset.scope) !== identityHash(source.scope)
  )
    throw new Error(
      "Movie replacement readiness changed its original physical video",
    );
  const coverage = asset.coverage.map(({ mediaId, edition }) => ({
    mediaId,
    edition,
  }));
  return {
    group: PlexPhysicalGroupSchema.parse({
      assetId: asset.id,
      assetVersion: asset.version,
      checksum: asset.checksum,
      sizeBytes: asset.sizeBytes,
      canonicalPath: asset.path,
      ownershipEpoch: asset.ownershipEpoch,
      canonicalRootId: asset.editionRootId,
      edition: asset.edition,
      coverage,
      coverageHash: identityHash(coverage),
    }),
    publicationHash: record.receiptHash,
    eventKind: "subtitles_ready" as const,
  };
}
