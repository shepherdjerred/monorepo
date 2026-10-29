import { z } from "zod";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import {
  LibraryPlexBindingInputV1Schema,
  type LibraryPlexBindingInputV1,
} from "#shared/plex-binding/activities.ts";
import { LibraryPlexReceiptV1Schema } from "#shared/plex-binding/library.ts";
import {
  PlexAssociationSchema,
  plexScopeKey,
} from "#shared/plex-binding/contract.ts";
import { loadLibraryAssetParentV1 } from "#infrastructure/handoff/library-asset.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { libraryPlexPhysicalGroup } from "./authority.ts";
import { readLibraryCanonicalBirth } from "./canonical.ts";
import { assertLibraryPlexObservation } from "./observation.ts";

export function libraryPlexCommand(command: Operation) {
  return {
    kind: command.kind,
    targetId: command.targetId,
    userId: command.userId,
    payloadHash: identityHash(command.payload),
  };
}

export async function loadLibraryPlexRequest(
  tx: Prisma.TransactionClient,
  input: LibraryPlexBindingInputV1,
  budget: PublicationAuthorityReadBudget,
) {
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  assertCommand(command, input);
  const parent = await loadLibraryAssetParentV1(tx, input, budget);
  if (
    parent.asset.ownershipEpoch !== input.recoveryEpoch ||
    command.userId !== parent.actorId
  )
    throw new Error("Library Plex request belongs to another ownership epoch");
  const birth = await readLibraryCanonicalBirth(tx, parent, budget);
  return { command, parent, birth };
}
export type LibraryPlexRequest = Awaited<
  ReturnType<typeof loadLibraryPlexRequest>
>;

function assertCommand(command: Operation, input: LibraryPlexBindingInputV1) {
  const payload = LibraryPlexBindingInputV1Schema.parse(command.payload);
  if (
    command.kind !== input.kind ||
    command.targetId !== input.assetId ||
    identityHash(payload) !== identityHash(input)
  )
    throw new Error("Library Plex request command changed");
}

/** Original source and association rows prove ACK; current pointers, flags and runtime are irrelevant. */
export async function readLibraryPlexCompletion(
  tx: Prisma.TransactionClient,
  input: LibraryPlexBindingInputV1,
  request: LibraryPlexRequest,
  budget: PublicationAuthorityReadBudget,
) {
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  assertCommand(command, input);
  const raw = z
    .object({ libraryPlexReceiptV1: z.unknown().optional() })
    .nullable()
    .parse(command.result)?.libraryPlexReceiptV1;
  if (raw === undefined) return null;
  const envelope = z
    .strictObject({ receipt: z.json(), receiptHash: z.string() })
    .parse(raw);
  const receipt = parsePlexRecord(
    LibraryPlexReceiptV1Schema,
    envelope.receipt,
    envelope.receiptHash,
  );
  if (
    identityHash(receipt.input) !== identityHash(input) ||
    identityHash(receipt.command) !==
      identityHash(libraryPlexCommand(command)) ||
    identityHash(libraryPlexCommand(request.command)) !==
      identityHash(libraryPlexCommand(command)) ||
    identityHash(receipt.expected.parents[0].reference) !==
      identityHash(request.parent.reference) ||
    identityHash(receipt.expected.newGroups[0]) !==
      identityHash(libraryPlexPhysicalGroup(request.parent))
  )
    throw new Error(
      "Library Plex completion lost its original command or physical parent",
    );
  const associations = assertLibraryPlexObservation(
    receipt.expected,
    receipt.observation,
    Date.parse(receipt.sdk.expiresAt),
  );
  const evidence = await tx.plexAssociationEvidence.findMany({
    where: {
      id: { in: receipt.bindings.map((binding) => binding.evidenceId) },
    },
    take: budget.take,
  });
  budget.consume(evidence.length);
  if (evidence.length !== receipt.bindings.length)
    throw new Error("Library Plex completion association is missing");
  for (const binding of receipt.bindings) {
    const row = evidence.find((item) => item.id === binding.evidenceId);
    const association = associations.find(
      (item) => plexScopeKey(item.scope) === plexScopeKey(binding.scope),
    );
    if (row === undefined || association === undefined)
      throw new Error("Library Plex completion scope is missing");
    const stored = parsePlexRecord(
      PlexAssociationSchema,
      row.evidence,
      row.associationHash,
    );
    if (
      identityHash(stored) !== identityHash(association) ||
      row.associationHash !== binding.associationHash ||
      row.mediaId !== binding.scope.mediaId ||
      row.edition !== binding.scope.edition ||
      row.assetId !== input.assetId ||
      row.serverMachineId !== association.access.serverMachineId
    )
      throw new Error("Library Plex completion immutable association changed");
  }
  return receipt;
}
