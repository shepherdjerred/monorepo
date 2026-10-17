import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import { findPriorNativeBinding } from "#infrastructure/native-archive/prior-binding.ts";
import { findCurrentCompensationReceipts } from "#infrastructure/native-compensation/receipts.ts";
import type { PublicationAuthorityReference } from "#shared/publication-proof/references.ts";
import { resolvePublicationTransitionAuthority } from "./authority.ts";
import { publicationArchiveSnapshot } from "./projection.ts";
import { loadPublicationIntent } from "./store.ts";
import type { PublicationAuthorityReadBudget } from "./read-budget.ts";

/** Ordinary acquisitions need no historical native grant; only actual matching receipts are linked. */
export async function findPublicationOriginalGrant(
  tx: Prisma.TransactionClient,
  input: {
    asset: PublicationAssetSnapshot;
    libraryKind: "movies" | "tv";
  },
  budget?: PublicationAuthorityReadBudget,
): Promise<PublicationAuthorityReference | null> {
  const nativeCount = await tx.nativeRecoveryReceipt.count({
    where: {
      recoveryEpoch: input.asset.ownershipEpoch,
      selection: {
        path: ["bindings"],
        array_contains: [
          { assetId: input.asset.id, assetVersion: input.asset.version },
        ],
      },
    },
  });
  if (nativeCount > 0) {
    const native = await findPriorNativeBinding(
      tx,
      publicationArchiveSnapshot(input.asset, input.libraryKind),
      input.asset.ownershipEpoch,
      budget,
    );
    if (native !== null) return native;
  }
  const compensation = await findCurrentCompensationReceipts(
    tx,
    { assetIds: [input.asset.id], recoveryEpoch: input.asset.ownershipEpoch },
    budget,
  );
  if (compensation.length > 1)
    throw new Error("Publication compensation grant is ambiguous");
  const completed = compensation[0];
  if (completed !== undefined) return completed;
  const transitions = await tx.mediaPublicationTransition.findMany({
    where: {
      birthEpoch: input.asset.ownershipEpoch,
      OR: [
        {
          outcome: {
            path: ["entries"],
            array_contains: [
              {
                successor: { id: input.asset.id, version: input.asset.version },
              },
            ],
          },
        },
        {
          outcome: {
            path: ["entries"],
            array_contains: [
              {
                predecessor: {
                  id: input.asset.id,
                  version: input.asset.version,
                },
              },
            ],
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget?.take ?? 101,
  });
  budget?.consume(transitions.length);
  if (transitions.length > 100)
    throw new Error("Publication transition lookup exceeds bound");
  const candidates = transitions.filter((row) => row.outcome !== null);
  if (candidates.length > 1)
    throw new Error("Publication transition grant is ambiguous");
  const transition = candidates[0];
  if (transition === undefined) return null;
  const parent = await loadPublicationIntent(tx, transition.attemptId, budget);
  if (parent === null)
    throw new Error("Publication transition intent disappeared");
  const entry = parent.intent.entries.find(
    (item) =>
      item.entry.assetId === input.asset.id ||
      item.entry.previousAssetId === input.asset.id,
  );
  if (entry === undefined)
    throw new Error("Publication transition predecessor association changed");
  if (entry.originalGrant === null) return null;
  const authority = await resolvePublicationTransitionAuthority(
    tx,
    { transitionId: transition.id, assetId: input.asset.id },
    budget,
  );
  const { originalGrant: _originalGrant, ...reference } = authority;
  return reference;
}
