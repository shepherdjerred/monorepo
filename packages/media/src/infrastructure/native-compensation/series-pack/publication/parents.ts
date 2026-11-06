import type { Prisma } from "#generated/prisma/client.ts";
import type {
  PlexPublicationParent,
  PlexBindingExpected,
} from "#shared/plex-binding/expected.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  assertSeriesPackNativePublicationPhaseCurrentV1,
  type SeriesPackNativePublicationPhaseV1,
} from "./phase.ts";

/** Actual completed receipt and current exact groups, under the already-held
 * new-only complete serving phase. No old descriptor parser or new query. */
export async function assertSeriesPackNativePlexParentV1(
  tx: Prisma.TransactionClient,
  parent: Extract<PlexPublicationParent, { kind: "compensation" }>,
  context: {
    expected: PlexBindingExpected;
    phase: SeriesPackNativePublicationPhaseV1;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { phase, expected, budget } = context;
  await assertSeriesPackNativePublicationPhaseCurrentV1(tx, phase, budget);
  if (
    identityHash(parent) !== identityHash(phase.parent) ||
    phase.record.completion === null
  )
    throw new PlexBindingProtection("ownership_changed");
  const generations = phase.authority.generations;
  if (
    phase.mediaIds.some(
      (id) =>
        expected.targets.find((target) => target.scope.mediaId === id)
          ?.generation !== generations[id],
    )
  )
    throw new PlexBindingProtection("scope_changed");
  for (const { after } of phase.record.completion.predecessorBindings) {
    const group = expected.newGroups.find((item) => item.assetId === after.id);
    if (
      group?.assetVersion !== after.version ||
      group.ownershipEpoch !== after.ownershipEpoch ||
      group.checksum !== after.checksum ||
      group.canonicalPath !== after.path ||
      identityHash(group.coverage) !==
        identityHash(
          after.coverage
            .filter((row) => row.current)
            .map(({ mediaId, edition }) => ({ mediaId, edition })),
        )
    )
      throw new PlexBindingProtection("ownership_changed");
  }
  return phase.record.completion.predecessorBindings.map(
    ({ after }) => after.id,
  );
}
