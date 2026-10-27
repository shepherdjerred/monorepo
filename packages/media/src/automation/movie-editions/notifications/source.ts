import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { MovieFilePlanV2Schema } from "#shared/movie-editions/file-plan-v2.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** The producer and consumer resolve the real completed publication, not a serialized availability claim. */
export async function readMovieNoticeSource(
  tx: Prisma.TransactionClient,
  input: MovieAttemptOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const receipt = await readMoviePlexReceiptV2(tx, input, budget);
  if (receipt === null)
    throw new Error("Movie notification has no committed Plex publication");
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  budget.consume(1);
  const plan = MovieFilePlanV2Schema.parse(attempt.filePlan);
  const group = receipt.expected.newGroups[0];
  if (group === undefined)
    throw new Error(
      "Movie notification publication omitted its physical owner",
    );
  return {
    receipt,
    group,
    publicationHash: identityHash(receipt),
    eventKind:
      plan.entries[0].previousAssetId === null
        ? ("media_available" as const)
        : ("media_upgraded" as const),
  };
}
