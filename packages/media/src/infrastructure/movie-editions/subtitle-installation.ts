import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeSubtitleSnapshot } from "#shared/native-subtitles.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { readMovieSubtitleReceiptV4 } from "./subtitle-receipt.ts";

/** Native lineage follows the actual movie caption installation, with the caller's existing allowance. */
export async function installedMovieSubtitleOperationV4(
  tx: Prisma.TransactionClient,
  original: NativeSubtitleSnapshot,
  scope: MovieEditionScope,
  budget: PublicationAuthorityReadBudget,
) {
  const marker = z
    .object({
      movieInstallationV4: z.strictObject({
        schemaVersion: z.literal(4),
        operationId: z.uuid(),
      }),
    })
    .parse(original.matchingEvidence).movieInstallationV4;
  const receipt = await readMovieSubtitleReceiptV4(
    tx,
    {
      schemaVersion: 4,
      operationId: marker.operationId,
      scope,
      assetId: original.assetId,
      subtitleId: original.id,
    },
    budget,
  );
  if (
    receipt === null ||
    identityHash(nativeJson(receipt.after)) !==
      identityHash(nativeJson(original))
  )
    throw new Error(
      "Native movie caption differs from its actual installation",
    );
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: marker.operationId },
  });
  budget.consume(1);
  return [
    {
      id: command.id,
      payload: command.payload,
      movieSubtitleReceiptV4: receipt,
    },
  ];
}
