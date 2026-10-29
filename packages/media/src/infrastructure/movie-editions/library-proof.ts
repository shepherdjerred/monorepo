import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertPublicationSnapshotSuccessor } from "#infrastructure/publication-proof/authority.ts";
import { compensationSubtitleLineage } from "#infrastructure/native-compensation/subtitle-lineage.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { loadMovieLibraryParentV2 } from "./library-records.ts";

/** The asset marker routes a bounded lookup; only the real immutable receipt grants ownership. */
export async function findMovieLibraryReferenceV2(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; asset: MoviePublicationAssetV2 },
  budget: PublicationAuthorityReadBudget,
) {
  const marker = z
    .object({ libraryAdoptionV2: z.unknown().optional() })
    .parse(input.asset.properties).libraryAdoptionV2;
  if (marker === undefined) return null;
  const planId = z
    .object({ schemaVersion: z.literal(2), planId: z.uuid() })
    .parse(marker).planId;
  const row = await tx.mediaHandoffReceipt.findUnique({ where: { planId } });
  budget.consume(row === null ? 0 : 1);
  if (row === null)
    throw new Error("Initial movie owner has no committed receipt");
  const parent = await loadMovieLibraryParentV2(
    tx,
    { receiptId: row.id, assetId: input.asset.id },
    budget,
  );
  if (
    identityHash(nativeJson(parent.reference.scope)) !==
    identityHash(nativeJson(input.scope))
  )
    throw new Error("Initial movie parent belongs to another edition");
  assertPublicationSnapshotSuccessor(
    { ...parent.asset, subtitles: input.asset.subtitles },
    input.asset,
  );
  const lineage = await compensationSubtitleLineage(
    tx,
    { baseline: parent.asset, current: input.asset, libraryKind: "movies" },
    budget,
  );
  return {
    ...parent.reference,
    ...(lineage.lineage === undefined
      ? {}
      : { subtitleLineage: lineage.lineage }),
  };
}
