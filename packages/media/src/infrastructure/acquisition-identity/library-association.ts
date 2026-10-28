import type { MediaItem, Prisma } from "#generated/prisma/client.ts";
import type { LibraryHandoffReceipt } from "#infrastructure/handoff/library-receipt.ts";
import {
  protectLibraryManagement,
  type LibraryManagementInvocation,
} from "./library-policy.ts";
import { PlexAssociationSchema } from "#shared/plex-binding/contract.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import type { LibrarySeriesManagement } from "#shared/acquisition/library-management.ts";

/** The original imported file anchors show identity, including acquisitions of later catalog episodes. */
export async function librarySourceAssociation(
  tx: Prisma.TransactionClient,
  state: {
    approval: LibraryHandoffReceipt;
    root: MediaItem;
    expected?: Exclude<LibrarySeriesManagement, { schemaVersion: 3 }>;
  },
  invocation: LibraryManagementInvocation,
) {
  const { approval, root, expected } = state;
  const access = invocation.access;
  const files = approval.selection.scope.files.filter(
    (file) => file.libraryKind === "tv",
  );
  const rows = await tx.plexAssociationEvidence.findMany({
    where:
      expected === undefined
        ? {
            assetId: { in: files.map((file) => file.assetId) },
            serverMachineId: access.serverMachineId,
            edition: "default",
            evidence: { path: ["editionRootId"], equals: root.id },
          }
        : { id: expected.association.evidenceId },
    orderBy: { id: "asc" },
    take: 1,
  });
  invocation.budget.consume(rows.length);
  const row = rows[0];
  if (row === undefined) protectLibraryManagement();
  const evidence = parsePlexRecord(
    PlexAssociationSchema,
    row.evidence,
    row.associationHash,
  );
  if (
    evidence.kind !== "episode" ||
    evidence.editionRootId !== root.id ||
    evidence.scope.edition !== "default" ||
    evidence.access.serverMachineId !== access.serverMachineId ||
    evidence.access.sectionId !== access.sectionId ||
    !files.some(
      (file) =>
        file.assetId === row.assetId &&
        file.mediaIds.includes(evidence.scope.mediaId),
    ) ||
    root.tmdbId === null ||
    !evidence.hierarchy.show.guids.includes(`tmdb://${String(root.tmdbId)}`)
  )
    protectLibraryManagement();
  return { evidenceId: row.id, associationHash: row.associationHash };
}
