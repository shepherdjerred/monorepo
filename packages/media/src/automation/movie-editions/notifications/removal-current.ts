import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieRemovalCompletionV4 } from "#shared/movie-editions/removal-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { readMovieRemovalSourceV4 } from "./removal-source.ts";

/** A historical removal is no authority to announce it after restore, replacement or a new generation. */
export async function currentMovieRemovalV4(
  tx: Prisma.TransactionClient,
  input: {
    completion: MovieRemovalCompletionV4;
    source: Awaited<ReturnType<typeof readMovieRemovalSourceV4>>;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { completion, source } = input;
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: completion.decisionId },
  });
  budget.consume(1);
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: completion.scope.mediaId,
        edition: completion.scope.edition,
      },
    },
  });
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: source.asset.id },
    include: { coverage: { take: 2 } },
  });
  budget.consume(1 + asset.coverage.length);
  const decisionVersion =
    source.receipt.decisions[0].quarantinedVersion +
    (completion.stage === "purged" ? 1 : 0);
  return (
    decision.state === completion.stage &&
    decision.version === decisionVersion &&
    target.editionRootId === completion.scope.rootMediaId &&
    target.generation === source.generation &&
    target.automationEpoch === source.recoveryEpoch &&
    target.availability ===
      (completion.stage === "quarantined" ? "quarantined" : "removed") &&
    physicalRemovalStageMatches(asset, input)
  );
}

function physicalRemovalStageMatches(
  asset: Prisma.LibraryAssetGetPayload<{ include: { coverage: true } }>,
  input: {
    completion: MovieRemovalCompletionV4;
    source: Awaited<ReturnType<typeof readMovieRemovalSourceV4>>;
  },
) {
  const { completion, source } = input;
  const group = source.receipt.groups[0];
  return (
    asset.state === completion.stage &&
    asset.version === source.asset.version &&
    asset.owned &&
    asset.ownershipEpoch === source.recoveryEpoch &&
    asset.edition === completion.scope.edition &&
    asset.editionRootId === completion.scope.rootMediaId &&
    asset.checksum === source.asset.checksum &&
    asset.path === group.canonicalPath &&
    asset.sizeBytes.toString() === group.sizeBytes &&
    asset.coverage.length === 1 &&
    asset.coverage[0]?.current === (completion.stage === "quarantined") &&
    asset.coverage[0].mediaId === completion.scope.mediaId &&
    asset.coverage[0].edition === completion.scope.edition
  );
}
