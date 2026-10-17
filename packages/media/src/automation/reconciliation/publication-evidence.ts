import type { Prisma } from "#generated/prisma/client.ts";
import { defaultIntent, assertDefaultEdition } from "#shared/editions/scope.ts";

export const publicationCoverageInclude = {
  asset: true,
  media: { include: { intents: { where: { edition: "default" } } } },
} satisfies Prisma.AssetCoverageInclude;
type Coverage = Prisma.AssetCoverageGetPayload<{
  include: typeof publicationCoverageInclude;
}>;
export function assertDefaultPublicationCoverage(
  coverages: readonly Coverage[],
): void {
  for (const coverage of coverages) {
    assertDefaultEdition(coverage.edition);
    assertDefaultEdition(coverage.asset.edition);
  }
}

export function publicationLineageResolved(coverage: Coverage): boolean {
  return (
    coverage.asset.editionRootId !== null &&
    coverage.asset.editionRootId ===
      defaultIntent(coverage.media.intents)?.editionRootId
  );
}

export function publicationGenerationMatches(
  coverage: Coverage,
  generations: Readonly<Record<string, number>>,
): boolean {
  const intent = defaultIntent(coverage.media.intents);
  return (
    intent?.desiredPresence === true &&
    intent.generation === generations[coverage.mediaId]
  );
}

export function samePublicationEvidence(
  current: Coverage,
  snapshot: Coverage,
): boolean {
  return (
    current.current &&
    current.edition === "default" &&
    current.asset.edition === "default" &&
    publicationLineageResolved(current) &&
    current.asset.state === "published" &&
    current.asset.version === snapshot.asset.version &&
    current.asset.editionRootId === snapshot.asset.editionRootId &&
    current.asset.checksum === snapshot.asset.checksum &&
    defaultIntent(current.media.intents)?.generation ===
      defaultIntent(snapshot.media.intents)?.generation
  );
}
